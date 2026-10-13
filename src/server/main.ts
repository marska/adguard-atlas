import { resolve } from 'node:path';
import { APP_VERSION, type ClientConfig, type ServerStatus } from '../shared/types';
import { AdGuardClient, Poller } from './adguard';
import { ConfigError, loadConfig, type Config } from './config';
import { MmdbLocator } from './geoip';
import { createAppServer } from './http';
import { log, setLogLevel } from './log';
import { Pipeline } from './pipeline';
import { Masker } from './privacy';
import { EventWindow } from './window';

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  setLogLevel(config.logLevel);

  const staticDir = process.env.STATIC_DIR || resolve(__dirname, '../web');
  const clientConfig: ClientConfig = {
    mode: config.demo ? 'demo' : 'live',
    home: config.home,
    windowMinutes: config.windowMinutes,
    privacyForced: config.privacyMode,
    version: APP_VERSION,
  };
  const startedAt = Date.now();

  if (config.demo) {
    // F27: same front end, generator in the browser, no AdGuard Home contacted.
    const app = createAppServer({
      staticDir,
      clientConfig,
      health: () => ({ status: 'ok', mode: 'demo', version: APP_VERSION, uptimeSeconds: uptime(startedAt) }),
    });
    listen(app, config.port, 'demo mode: synthetic traffic generated in the browser, no AdGuard Home is contacted');
    return;
  }

  let geo: MmdbLocator | undefined;
  try {
    geo = await MmdbLocator.open(config.geoipDb);
    log.info(`GeoIP database: ${config.geoipDb} (${geo.databaseType})`);
  } catch (err) {
    log.error(
      `Cannot open the GeoIP database at ${config.geoipDb} (${(err as NodeJS.ErrnoException).code ?? 'invalid file'}): queries will be counted but nothing can be drawn on the map`,
    );
  }

  const window = new EventWindow(config.windowMinutes * 60_000);
  const pipeline = new Pipeline({
    geo,
    masker: config.privacyMode ? new Masker() : undefined,
    ignoreClients: config.ignoreClients,
    ignoreDomains: config.ignoreDomains,
  });

  const pollers: Poller[] = [];
  const status = (): ServerStatus => ({
    instances: pollers.map((p) => p.currentStatus),
    geoip: geo !== undefined,
  });

  const app = createAppServer({
    staticDir,
    clientConfig,
    stream: { snapshot: () => ({ now: Date.now(), events: window.snapshot(), status: status() }) },
    health: () => ({
      status: 'ok',
      mode: 'live',
      version: APP_VERSION,
      uptimeSeconds: uptime(startedAt),
      geoip: geo !== undefined,
      instances: pollers.map((p) => ({ name: p.currentStatus.name, state: p.currentStatus.state })),
    }),
  });

  for (const instance of config.instances) {
    const poller = new Poller(new AdGuardClient(instance), {
      name: instance.name,
      intervalMs: config.pollIntervalMs,
      onEntries: (entries) => {
        const events = pipeline.process(instance.name, entries);
        if (events.length === 0) return;
        window.push(events);
        app.broadcast('events', events);
        if (config.logLevel === 'debug') {
          for (const e of events) log.debug(`${e.instance} ${e.client} ${e.domain} ${e.cls}`);
        }
      },
      onStatus: (s) => {
        if (s.state === 'error') log.warn(`instance "${s.name}": ${s.message}`);
        else log.info(`instance "${s.name}": ${s.state}`);
        app.broadcast('status', status());
      },
    });
    pollers.push(poller);
  }

  listen(app, config.port, `polling ${pollers.length} AdGuard Home instance(s) every ${config.pollIntervalMs} ms`, () => {
    for (const p of pollers) p.stop();
  });
  for (const p of pollers) p.start();
}

function uptime(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

function listen(app: ReturnType<typeof createAppServer>, port: number, what: string, onStop?: () => void): void {
  app.server.on('error', (err) => {
    log.error(`cannot listen on port ${port}: ${err.message}`);
    process.exit(1);
  });
  app.server.listen(port, () => log.info(`AdGuard Atlas ${APP_VERSION} listening on :${port} — ${what}`));

  // Node is PID 1 in the container, so nothing handles signals for it.
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      log.info(`${signal} received, shutting down`);
      onStop?.();
      void app.close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
