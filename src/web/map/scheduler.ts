export interface Scheduled<T> {
  key: string;
  payload: T;
  /** How many queries this one arc stands for. */
  count: number;
}

interface Pending<T> extends Scheduled<T> {
  since: number;
}

export interface SchedulerOptions {
  /** Sustained arcs per second. */
  perSecond: number;
  /** How many may start at once after a quiet moment. */
  burst: number;
  /** Queries that waited longer than this are not drawn as arcs at all. */
  maxWaitMs: number;
}

/**
 * F22. A token bucket in front of the arc animation. Queries to the same
 * destination that arrive while waiting are merged into one, heavier arc; what
 * cannot be drawn in time is handed back as `expired`, to be shown as a marker
 * pulse only. However noisy a device is, the page draws a bounded number of arcs.
 */
export class ArcScheduler<T> {
  private pending = new Map<string, Pending<T>>();
  private tokens: number;
  private last: number | null = null;

  constructor(private readonly options: SchedulerOptions = { perSecond: 12, burst: 6, maxWaitMs: 1400 }) {
    this.tokens = options.burst;
  }

  push(key: string, payload: T, now: number): void {
    const existing = this.pending.get(key);
    if (existing) existing.count++;
    else this.pending.set(key, { key, payload, count: 1, since: now });
  }

  get waiting(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }

  take(now: number): { released: Scheduled<T>[]; expired: Scheduled<T>[] } {
    const { perSecond, burst, maxWaitMs } = this.options;
    if (this.last !== null) {
      this.tokens = Math.min(burst, this.tokens + (Math.max(0, now - this.last) * perSecond) / 1000);
    }
    this.last = now;

    const released: Scheduled<T>[] = [];
    const expired: Scheduled<T>[] = [];
    for (const [key, item] of this.pending) {
      if (this.tokens >= 1) {
        this.tokens -= 1;
        released.push(item);
        this.pending.delete(key);
      } else if (now - item.since > maxWaitMs) {
        expired.push(item);
        this.pending.delete(key);
      }
    }
    return { released, expired };
  }
}
