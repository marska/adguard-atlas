import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdGuardClient, Poller, QUERYLOG_METHOD, QUERYLOG_PATH } from '../src/server/adguard';
import type { RawEntry } from '../src/server/classify';
import type { InstanceStatus } from '../src/shared/types';
import { entry, fakeAdGuard, fixture, type FakeAdGuard } from './helpers';

let fake: FakeAdGuard;
let received: RawEntry[];
let statuses: InstanceStatus[];

function poller(overrides: { pageLimit?: number; maxPages?: number; password?: string } = {}): Poller {
  const client = new AdGuardClient({ ...fake.instance, password: overrides.password ?? fake.instance.password }, 2000);
  return new Poller(client, {
    name: 'fake',
    intervalMs: 2000,
    pageLimit: overrides.pageLimit,
    maxPages: overrides.maxPages,
    onEntries: (entries) => received.push(...entries),
    onStatus: (s) => statuses.push(s),
  });
}

const names = (entries: RawEntry[]) => entries.map((e) => e.question!.name);

beforeEach(async () => {
  fake = await fakeAdGuard();
  received = [];
  statuses = [];
});

afterEach(() => fake.close());

describe('polling AdGuard Home (F1, F3, F5)', () => {
  it('starts from "now": what is already in the log is not replayed', async () => {
    fake.log = fixture().data;
    const p = poller();
    await p.tick();
    expect(received).toEqual([]);
    expect(statuses.map((s) => s.state)).toEqual(['ok']);

    fake.log.unshift(entry(9000), entry(8500));
    await p.tick();
    expect(names(received)).toEqual(['host-8500.example.com', 'host-9000.example.com']);
  });

  it('never emits an entry twice', async () => {
    const p = poller();
    await p.tick();
    fake.log.unshift(entry(100));
    await p.tick();
    await p.tick();
    fake.log.unshift(entry(200));
    await p.tick();
    await p.tick();
    expect(names(received)).toEqual(['host-100.example.com', 'host-200.example.com']);
  });

  it('keeps entries that share a timestamp apart', async () => {
    const p = poller();
    await p.tick();
    const twin = entry(100, { question: { class: 'IN', name: 'twin.example.com', type: 'A' } });
    fake.log.unshift(entry(100));
    await p.tick();
    // A second entry with the very same timestamp shows up one poll later.
    fake.log.unshift(twin);
    await p.tick();
    expect(names(received)).toEqual(['host-100.example.com', 'twin.example.com']);
  });

  it('pages back with older_than when a burst is larger than one page', async () => {
    const p = poller({ pageLimit: 3 });
    await p.tick();
    for (let i = 1; i <= 8; i++) fake.log.unshift(entry(i * 10));
    fake.requests.length = 0;
    await p.tick();
    expect(names(received)).toEqual([10, 20, 30, 40, 50, 60, 70, 80].map((n) => `host-${n}.example.com`));
    expect(fake.requests.length).toBeGreaterThan(1);
    expect(fake.requests[1]!.query.get('older_than')).toBeTruthy();
  });

  it('gives up on the oldest part of an enormous burst instead of paging forever', async () => {
    const p = poller({ pageLimit: 2, maxPages: 2 });
    await p.tick();
    for (let i = 1; i <= 10; i++) fake.log.unshift(entry(i * 10));
    fake.requests.length = 0;
    await p.tick();
    expect(fake.requests).toHaveLength(2);
    expect(names(received)).toEqual([70, 80, 90, 100].map((n) => `host-${n}.example.com`));
    await p.tick();
    expect(received).toHaveLength(4);
  });

  it('sends Basic credentials and asks for JSON', async () => {
    await poller().tick();
    expect(fake.requests[0]!.authorization).toBe('Basic ' + Buffer.from('atlas:s3cret').toString('base64'));
    expect(fake.requests[0]!.query.get('limit')).toBe('200');
  });

  it('uses GET /control/querylog and nothing else (section 7)', async () => {
    expect(QUERYLOG_METHOD).toBe('GET');
    expect(QUERYLOG_PATH).toBe('/control/querylog');

    const p = poller({ pageLimit: 2 });
    await p.tick();
    for (let i = 1; i <= 7; i++) fake.log.unshift(entry(i));
    await p.tick();
    fake.failWith = 500;
    await p.tick();
    fake.failWith = null;
    await p.tick();

    expect(fake.requests.length).toBeGreaterThan(5);
    for (const request of fake.requests) {
      expect(request.method).toBe('GET');
      expect(request.path).toBe('/control/querylog');
      expect([...request.query.keys()].every((k) => k === 'limit' || k === 'older_than')).toBe(true);
    }
  });

  it('honours a base path in the URL', async () => {
    const client = new AdGuardClient({ ...fake.instance, url: fake.instance.url + '/adguard' });
    await client.fetchQueryLog(1).catch(() => undefined);
    expect(fake.requests[0]!.path).toBe('/adguard/control/querylog');
  });
});

describe('failures (F5, U9)', () => {
  it('reports rejected credentials in words and backs off', async () => {
    const p = poller({ password: 'wrong' });
    expect(p.nextDelay()).toBe(2000);
    await p.tick();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ state: 'error', message: 'Credentials rejected (HTTP 401)' });
    expect(p.nextDelay()).toBe(4000);
    await p.tick();
    expect(p.nextDelay()).toBe(8000);
    for (let i = 0; i < 12; i++) await p.tick();
    expect(p.nextDelay()).toBe(60_000);
    // The same failure is reported once, not on every retry.
    expect(statuses).toHaveLength(1);
  });

  it('recovers, and loses nothing that was logged while it could not poll', async () => {
    const p = poller();
    await p.tick();
    fake.failWith = 502;
    fake.log.unshift(entry(100));
    await p.tick();
    expect(statuses.at(-1)).toMatchObject({ state: 'error', message: 'Unexpected answer: HTTP 502' });
    fake.failWith = null;
    await p.tick();
    expect(statuses.at(-1)!.state).toBe('ok');
    expect(p.nextDelay()).toBe(2000);
    expect(names(received)).toEqual(['host-100.example.com']);
  });

  it('reports an unreachable instance without throwing', async () => {
    const client = new AdGuardClient({ ...fake.instance, url: 'http://127.0.0.1:1' }, 1000);
    const p = new Poller(client, { name: 'gone', intervalMs: 2000, onEntries: () => undefined, onStatus: (s) => statuses.push(s) });
    await p.tick();
    expect(statuses[0]).toMatchObject({ name: 'gone', state: 'error' });
    expect(statuses[0]!.message).toMatch(/^Unreachable/);
  });

  it('reports an answer that is not a query log', async () => {
    fake.failWith = null;
    const client = { fetchQueryLog: () => new AdGuardClient({ ...fake.instance, url: fake.instance.url + '/nope' }).fetchQueryLog(1) };
    const p = new Poller(client, { name: 'odd', intervalMs: 2000, onEntries: () => undefined, onStatus: (s) => statuses.push(s) });
    await p.tick();
    expect(statuses[0]).toMatchObject({ state: 'error', message: 'Unexpected answer: HTTP 404' });
  });
});
