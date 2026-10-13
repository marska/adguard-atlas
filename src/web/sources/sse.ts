import type { AtlasEvent, ServerStatus, SnapshotMessage } from '../../shared/types';
import type { EventSourceAdapter } from './types';

/** F21: the server's event stream. The browser's EventSource reconnects by itself. */
export function createSseSource(url = 'api/events'): EventSourceAdapter {
  return {
    start(handlers) {
      const stream = new EventSource(url);
      handlers.onConnection('connecting');
      stream.addEventListener('open', () => handlers.onConnection('open'));
      stream.addEventListener('error', () => handlers.onConnection('lost'));
      stream.addEventListener('snapshot', (e) => {
        const msg = JSON.parse((e as MessageEvent<string>).data) as SnapshotMessage;
        handlers.onSnapshot(msg.events, msg.status, msg.now);
      });
      stream.addEventListener('events', (e) => {
        handlers.onEvents(JSON.parse((e as MessageEvent<string>).data) as AtlasEvent[]);
      });
      stream.addEventListener('status', (e) => {
        handlers.onStatus(JSON.parse((e as MessageEvent<string>).data) as ServerStatus);
      });
      return () => stream.close();
    },
  };
}
