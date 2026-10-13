import type { AtlasEvent, ServerStatus } from '../../shared/types';

export type ConnectionState = 'connecting' | 'open' | 'lost';

export interface SourceHandlers {
  /** The current window. May arrive again after a reconnect; it replaces everything. */
  onSnapshot: (events: AtlasEvent[], status: ServerStatus, sourceNow: number) => void;
  onEvents: (events: AtlasEvent[]) => void;
  onStatus: (status: ServerStatus) => void;
  onConnection: (state: ConnectionState) => void;
}

/**
 * F23. Where events come from. The server's stream and the in-browser generator
 * both implement this; nothing downstream knows which one it is talking to.
 */
export interface EventSourceAdapter {
  start(handlers: SourceHandlers): () => void;
}
