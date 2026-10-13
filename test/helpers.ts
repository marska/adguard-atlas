import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RawEntry } from '../src/server/classify';
import { parseTimeNs } from '../src/server/classify';
import type { InstanceConfig } from '../src/server/config';

export function fixture(): { data: RawEntry[]; oldest: string } {
  return JSON.parse(readFileSync(new URL('./fixtures/querylog.json', import.meta.url), 'utf8'));
}

/** An entry `n` milliseconds after noon, in AdGuard Home's timestamp format. */
export function entry(n: number, overrides: Partial<RawEntry> = {}): RawEntry {
  const seconds = String(Math.floor(n / 1000)).padStart(2, '0');
  const millis = String(n % 1000).padStart(3, '0');
  return {
    answer: [{ type: 'A', value: '93.184.216.34', ttl: 60 }],
    client: '192.168.1.20',
    client_info: { name: 'tv' },
    question: { class: 'IN', name: `host-${n}.example.com`, type: 'A' },
    reason: 'NotFilteredNotFound',
    status: 'NOERROR',
    time: `2026-10-13T12:00:${seconds}.${millis}000001+02:00`,
    ...overrides,
  };
}

export interface SeenRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

export interface FakeAdGuard {
  instance: InstanceConfig;
  /** Newest first, as AdGuard Home returns it. */
  log: RawEntry[];
  requests: SeenRequest[];
  /** Force every answer to this status. */
  failWith: number | null;
  close: () => Promise<void>;
}

/**
 * A stand-in for AdGuard Home's `/control/querylog`: Basic auth, `limit`,
 * `older_than`, newest entries first. It records everything it is asked.
 */
export async function fakeAdGuard(user = 'atlas', password = 's3cret'): Promise<FakeAdGuard> {
  const state: Pick<FakeAdGuard, 'log' | 'requests' | 'failWith'> = { log: [], requests: [], failWith: null };
  const expected = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    state.requests.push({
      method: req.method ?? '',
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    });
    if (state.failWith !== null) {
      res.writeHead(state.failWith).end();
      return;
    }
    if (req.headers.authorization !== expected) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/control/querylog') {
      res.writeHead(404).end();
      return;
    }
    const limit = Number(url.searchParams.get('limit') ?? '500');
    const olderThan = parseTimeNs(url.searchParams.get('older_than'));
    const matching = state.log.filter((e) => olderThan === null || parseTimeNs(e.time)! < olderThan);
    const data = matching.slice(0, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data, oldest: data.length ? data[data.length - 1]!.time : '' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(state, {
    instance: { index: 1, name: 'fake', url: `http://127.0.0.1:${port}`, user, password, insecureTls: false },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
