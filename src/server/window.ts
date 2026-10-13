import type { AtlasEvent } from '../shared/types';

/** Upper bound on what is kept, whatever the window: a noisy network must not eat the heap. */
export const MAX_WINDOW_EVENTS = 30_000;

/** The in-memory window (F11, F21). Nothing here ever touches the disk. */
export class EventWindow {
  private events: AtlasEvent[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly maxEvents = MAX_WINDOW_EVENTS,
  ) {}

  push(batch: AtlasEvent[], now = Date.now()): void {
    for (const e of batch) this.events.push(e);
    this.prune(now);
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    let drop = 0;
    while (drop < this.events.length && this.events[drop]!.t < cutoff) drop++;
    drop = Math.max(drop, this.events.length - this.maxEvents);
    if (drop > 0) this.events.splice(0, drop);
  }

  snapshot(now = Date.now()): AtlasEvent[] {
    this.prune(now);
    return this.events.slice();
  }

  get size(): number {
    return this.events.length;
  }
}
