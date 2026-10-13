import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAppServer, type AppServer } from '../src/server/http';
import type { AtlasEvent, ClientConfig, SnapshotMessage } from '../src/shared/types';

let dir: string;
let app: AppServer | undefined;

const clientConfig: ClientConfig = {
  mode: 'live',
  home: { lat: 52, lon: 21, label: 'Home "sweet" <home>' },
  windowMinutes: 15,
  privacyForced: false,
  version: 'test',
};

const sample: AtlasEvent = { id: '1', t: 1, instance: 'a', client: 'tv', domain: 'example.com', qtype: 'A', cls: 'blocked' };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<meta name="atlas-config" content="__ATLAS_CONFIG__"><script src="./assets/app-abc.js"></script>');
  writeFileSync(join(dir, 'assets', 'app-abc.js'), 'console.log("atlas");'.repeat(50));
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(options: { demo?: boolean; maxStreamClients?: number } = {}): Promise<string> {
  const snapshot = (): SnapshotMessage => ({ now: 123, events: [sample], status: { instances: [], geoip: true } });
  app = createAppServer({
    staticDir: dir,
    clientConfig: options.demo ? { ...clientConfig, mode: 'demo' } : clientConfig,
    stream: options.demo ? undefined : { snapshot },
    health: () => ({ status: 'ok' }),
    maxStreamClients: options.maxStreamClients,
  });
  await new Promise<void>((resolve) => app!.server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

/** Reads an event stream until `frames` complete frames have arrived. */
function readStream(url: string, frames: number, onOpen?: () => void): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        const first = buffer === '';
        buffer += chunk;
        const parts = buffer.split('\n\n').filter(Boolean);
        if (first) onOpen?.();
        if (buffer.endsWith('\n\n') && parts.length >= frames) {
          req.destroy();
          resolve(parts);
        }
      });
    });
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
    });
  });
}

describe('http server', () => {
  it('answers /healthz', async () => {
    const base = await start();
    const res = await fetch(base + '/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('serves the page with the configuration injected and safely escaped', async () => {
    const base = await start();
    const res = await fetch(base + '/');
    const html = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(html).not.toContain('__ATLAS_CONFIG__');
    expect(html).toContain('&quot;mode&quot;:&quot;live&quot;');
    expect(html).not.toContain('<home>');
    const content = /content="([^"]*)"/.exec(html)![1]!;
    const decoded = content.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(JSON.parse(decoded)).toEqual(clientConfig);
  });

  it('sends a strict Content-Security-Policy on every answer (section 7)', async () => {
    const base = await start();
    for (const path of ['/', '/assets/app-abc.js', '/healthz', '/nope']) {
      const res = await fetch(base + path);
      const csp = res.headers.get('content-security-policy')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/https?:|\*|unsafe/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('caches hashed assets for good and compresses text', async () => {
    const base = await start();
    const res = await fetch(base + '/assets/app-abc.js', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(await res.text()).toContain('console.log("atlas");');
  });

  it('is read-only: no other methods, no paths outside the bundle', async () => {
    const base = await start();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect((await fetch(base + '/', { method })).status).toBe(405);
    }
    for (const path of ['/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/assets/../../etc/passwd', '/assets']) {
      const status = await new Promise<number>((resolve, reject) => {
        http.get(base + path, (res) => resolve(res.statusCode ?? 0)).on('error', reject);
      });
      expect(status).toBe(404);
    }
  });

  it('streams the current window first, then live events (F21)', async () => {
    const base = await start();
    const live: AtlasEvent = { ...sample, id: '2', cls: 'allowed' };
    const frames = await readStream(base + '/api/events', 3, () => {
      app!.broadcast('events', [live]);
      app!.broadcast('status', { instances: [{ name: 'a', state: 'error', message: 'down' }], geoip: true });
    });
    expect(frames[0]).toContain('event: snapshot');
    expect(JSON.parse(frames[0]!.split('data: ')[1]!)).toEqual({ now: 123, events: [sample], status: { instances: [], geoip: true } });
    expect(frames[1]).toBe(`event: events\ndata: ${JSON.stringify([live])}`);
    expect(frames[2]).toContain('event: status');
  });

  it('limits the number of open streams', async () => {
    const base = await start({ maxStreamClients: 1 });
    await new Promise<void>((resolve) => {
      void readStream(base + '/api/events', 99, resolve);
    });
    expect(app!.clientCount()).toBe(1);
    expect((await fetch(base + '/api/events')).status).toBe(503);
  });

  it('has no event stream at all in demo mode (F27)', async () => {
    const base = await start({ demo: true });
    expect((await fetch(base + '/api/events')).status).toBe(404);
    expect(await (await fetch(base + '/')).text()).toContain('&quot;mode&quot;:&quot;demo&quot;');
  });
});
