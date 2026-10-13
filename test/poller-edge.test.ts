import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdGuardClient, AdGuardError, Poller } from '../src/server/adguard';
import type { RawEntry } from '../src/server/classify';
import type { InstanceStatus } from '../src/shared/types';
import { entry, fakeAdGuard, type FakeAdGuard } from './helpers';

let fake: FakeAdGuard;
let extra: FakeAdGuard | undefined;

beforeEach(async () => {
  fake = await fakeAdGuard();
});
afterEach(async () => {
  await fake.close();
  await extra?.close();
  extra = undefined;
});

function watch(source: FakeAdGuard, options: { pageLimit?: number; maxPages?: number; password?: string; intervalMs?: number } = {}) {
  const received: RawEntry[] = [];
  const statuses: InstanceStatus[] = [];
  const client = new AdGuardClient({ ...source.instance, password: options.password ?? source.instance.password }, 2000);
  const poller = new Poller(client, {
    name: source.instance.name,
    intervalMs: options.intervalMs ?? 2000,
    pageLimit: options.pageLimit,
    maxPages: options.maxPages,
    onEntries: (e) => received.push(...e),
    onStatus: (s) => statuses.push(s),
  });
  return { poller, received, statuses };
}

describe('poller: restart and deduplication (F3)', () => {
  it('a restarted poller starts from "now" again instead of replaying the log', async () => {
    for (let i = 1; i <= 20; i++) fake.log.unshift(entry(i));
    const first = watch(fake);
    await first.poller.tick();
    fake.log.unshift(entry(100));
    await first.poller.tick();
    expect(first.received).toHaveLength(1);

    // The container restarts: a brand-new poller, the same log.
    const second = watch(fake);
    await second.poller.tick();
    expect(second.received).toEqual([]);
    fake.log.unshift(entry(200));
    await second.poller.tick();
    expect(second.received.map((e) => e.question!.name)).toEqual(['host-200.example.com']);
  });

  it('starting on an empty log still delivers everything that arrives afterwards', async () => {
    const { poller, received } = watch(fake);
    await poller.tick();
    for (let i = 1; i <= 5; i++) fake.log.unshift(entry(i));
    await poller.tick();
    expect(received).toHaveLength(5);
  });

  it('does not replay entries once the set of seen keys has been trimmed', async () => {
    const { poller, received } = watch(fake, { pageLimit: 500, maxPages: 10 });
    await poller.tick();
    // More than the 4000 keys it remembers, delivered over several polls.
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 1; i <= 1500; i++) fake.log.unshift(entry(batch * 1500 + i));
      await poller.tick();
    }
    expect(received).toHaveLength(4500);
    await poller.tick();
    await poller.tick();
    expect(received).toHaveLength(4500);
    expect(new Set(received.map((e) => e.question!.name)).size).toBe(4500);
  });

  it('ignores entries with an unreadable time instead of failing the poll', async () => {
    const { poller, received, statuses } = watch(fake);
    await poller.tick();
    fake.log.unshift(entry(1, { time: 'garbage' }), entry(2));
    await poller.tick();
    expect(received.map((e) => e.question!.name)).toEqual(['host-2.example.com']);
    expect(statuses.at(-1)!.state).toBe('ok');
  });

  it('authenticates with a password containing a colon and non-ASCII characters', async () => {
    const odd = await fakeAdGuard('użytkownik', 'pa:ss wörd/ł');
    extra = odd;
    const { poller, statuses } = watch(odd);
    await poller.tick();
    expect(statuses.map((s) => s.state)).toEqual(['ok']);
  });
});

describe('poller: backoff (F5)', () => {
  it('never retries sooner than the normal interval, however long that is', async () => {
    const { poller } = watch(fake, { password: 'wrong', intervalMs: 300_000 });
    expect(poller.nextDelay()).toBe(300_000);
    for (let i = 0; i < 3; i++) {
      await poller.tick();
      expect(poller.nextDelay()).toBeGreaterThanOrEqual(300_000);
    }
  });

  it('starts at twice the interval (at least 2 s), doubles, and stops at the cap', async () => {
    const { poller } = watch(fake, { password: 'wrong', intervalMs: 250 });
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await poller.tick();
      delays.push(poller.nextDelay());
    }
    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });

  it('reports a failing instance while the others keep delivering', async () => {
    extra = await fakeAdGuard();
    const good = watch(fake);
    const bad = watch(extra, { password: 'wrong' });
    await Promise.all([good.poller.tick(), bad.poller.tick()]);
    fake.log.unshift(entry(1));
    extra.log.unshift(entry(2));
    await Promise.all([good.poller.tick(), bad.poller.tick()]);
    expect(good.received).toHaveLength(1);
    expect(good.statuses.map((s) => s.state)).toEqual(['ok']);
    expect(bad.received).toEqual([]);
    expect(bad.statuses.map((s) => s.state)).toEqual(['error']);
    expect(bad.poller.currentStatus.message).toBe('Credentials rejected (HTTP 401)');
  });
});

describe('outbound traffic (section 7)', () => {
  it('does not follow a redirect to another host', async () => {
    let hits = 0;
    const elsewhere = http.createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[],"oldest":""}');
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}/control/querylog`;
    const redirector = http.createServer((_req, res) => res.writeHead(302, { Location: target }).end());
    await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
    try {
      const client = new AdGuardClient({ ...fake.instance, url });
      await expect(client.fetchQueryLog(10)).rejects.toMatchObject({ kind: 'http' });
      expect(hits).toBe(0);
    } finally {
      elsewhere.close();
      redirector.close();
    }
  });

  it('rejects an answer that is not JSON, or not an AdGuard Home log, without throwing out of the poller', async () => {
    const server = http.createServer((_req, res) => res.writeHead(200).end('<html>login</html>'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = new AdGuardClient({ ...fake.instance, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      const error = await client.fetchQueryLog(1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdGuardError);
      expect((error as AdGuardError).kind).toBe('bad_response');
    } finally {
      server.close();
    }
  });

  it('only the AdGuard client can open a connection: no other server module makes requests', () => {
    const dir = join(__dirname, '../src/server');
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
    expect(sources.length).toBeGreaterThan(5);
    for (const [file, text] of sources) {
      expect(text, `${file}: fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(text, `${file}: net client`).not.toMatch(/from 'node:(tls|dns|dgram|http2|child_process)'/);
      expect(text, `${file}: raw socket`).not.toMatch(/\b(createConnection|net\.connect|new Socket)\b/);
      // node:net is only used for address parsing (ip.ts).
      if (/from 'node:net'/.test(text)) expect(text, `${file}: node:net`).toMatch(/import \{ BlockList, isIP \} from 'node:net'/);
      if (file !== 'adguard.ts') {
        expect(text, `${file}: outbound request`).not.toMatch(/\b(https?)\.(request|get)\s*\(|\brequest\s*\(\s*\{/);
        expect(text, `${file}: https import`).not.toMatch(/from 'node:https'/);
      }
    }
    const client = sources.find(([f]) => f === 'adguard.ts')![1];
    expect(client).not.toMatch(/'(POST|PUT|PATCH|DELETE|HEAD)'/);
    expect((client.match(/\.request\(/g) ?? []).length).toBe(1);
  });

  it('the front end never opens a connection of its own except the event stream', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(dir, f.name));
        else if (/\.(tsx?|css|html)$/.test(f.name)) files.push(join(dir, f.name));
      }
    };
    walk(join(__dirname, '../src/web'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|@import\s+url|<link[^>]+href="https?:|<script[^>]+src="https?:/);
      expect(text.match(/new EventSource/g)?.length ?? 0, file).toBeLessThanOrEqual(file.endsWith('sse.ts') ? 1 : 0);
      // No CSS url() pointing at another origin, no bare absolute URL in an attribute that loads something.
      expect(text, file).not.toMatch(/url\(\s*['"]?https?:/);
    }
  });
});
