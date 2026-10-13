import type { ServerStatus } from '../../shared/types';
import { DEMO_INSTANCES } from '../demo/data';
import { DemoGenerator } from '../demo/generator';
import type { EventSourceAdapter } from './types';

/** F23–F25: synthetic traffic made in the browser. No network, no DNS, no GeoIP. */
export function createDemoSource(windowMs: number, seed = Date.now()): EventSourceAdapter {
  return {
    start(handlers) {
      const now = Date.now();
      const generator = new DemoGenerator(seed, now - windowMs);
      const status: ServerStatus = {
        instances: DEMO_INSTANCES.map((name) => ({ name, state: 'ok', lastOk: now })),
        geoip: true,
      };
      handlers.onSnapshot(generator.advance(now), status, now);
      handlers.onConnection('open');
      const timer = setInterval(() => {
        const events = generator.advance(Date.now());
        if (events.length > 0) handlers.onEvents(events);
      }, 120);
      return () => clearInterval(timer);
    },
  };
}
