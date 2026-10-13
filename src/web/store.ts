import {
  QUERY_CLASSES,
  type AtlasEvent,
  type Destination,
  type QueryClass,
  type ServerStatus,
} from '../shared/types';
import type { ConnectionState } from './sources/types';

export interface Filters {
  device: string | null;
  instance: string | null;
  classes: Record<QueryClass, boolean>;
  text: string;
}

export type Selection =
  | { kind: 'place'; key: string }
  | { kind: 'country'; cc: string; name: string; featureId?: string }
  | null;

export interface Place {
  key: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  cc?: string;
  count: number;
  last: number;
}

export interface Row {
  key: string;
  label: string;
  count: number;
  blocked: number;
  cc?: string;
}

export interface Detail {
  title: string;
  subtitle: string;
  total: number;
  domains: Row[];
  devices: Row[];
  cities: Row[];
}

export const BUCKETS = 60;

export interface View {
  total: number;
  byClass: Record<QueryClass, number>;
  /** Share of blocked queries among everything that passes the non-class filters. */
  blockedShare: number;
  perMinute: number;
  /** Histogram over the window: [allowed, blocked, other] per bucket. */
  buckets: [number, number, number][];
  topCountries: Row[];
  topDomains: Row[];
  topDevices: Row[];
  countries: number;
  feed: AtlasEvent[];
  devices: string[];
  instances: string[];
  places: Place[];
  detail: Detail | null;
}

export type Theme = 'dark' | 'light';

export interface Snapshot {
  view: View;
  filters: Filters;
  selection: Selection;
  paused: boolean;
  privacy: boolean;
  theme: Theme;
  status: ServerStatus | null;
  connection: ConnectionState;
  /** False until the first snapshot has arrived. */
  ready: boolean;
}

export const FEED_SIZE = 70;
const MAX_EVENTS = 40_000;

export function placeKey(dest: Destination): string {
  return `${dest.lat.toFixed(2)},${dest.lon.toFixed(2)}`;
}

export function defaultFilters(): Filters {
  return {
    device: null,
    instance: null,
    classes: { allowed: true, blocked: true, local: true, noanswer: true },
    text: '',
  };
}

export function filtersActive(f: Filters): number {
  return (
    (f.device ? 1 : 0) +
    (f.instance ? 1 : 0) +
    (f.text.trim() ? 1 : 0) +
    QUERY_CLASSES.filter((c) => !f.classes[c]).length
  );
}

function top(map: Map<string, Row>, n: number): Row[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, n);
}

function bump(map: Map<string, Row>, key: string, label: string, e: AtlasEvent, cc?: string): void {
  let row = map.get(key);
  if (!row) {
    row = { key, label, count: 0, blocked: 0, cc };
    map.set(key, row);
  }
  row.count++;
  if (e.cls === 'blocked') row.blocked++;
}

/**
 * The browser's copy of the window and everything derived from it. Events arrive
 * much faster than React should render, so the store collects them and recomputes
 * the view on a timer; the map listens to live events directly.
 */
export class AtlasStore {
  private events: AtlasEvent[] = [];
  private listeners = new Set<() => void>();
  private liveListeners = new Set<(e: AtlasEvent) => void>();
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clockOffset = 0;
  private computedAt = 0;
  private aliases = new Map<string, string>();
  private snapshot: Snapshot;

  constructor(
    private readonly windowMs: number,
    initial: { privacy?: boolean; theme?: Theme } = {},
  ) {
    this.snapshot = {
      view: this.compute(defaultFilters(), null),
      filters: defaultFilters(),
      selection: null,
      paused: false,
      privacy: initial.privacy ?? false,
      theme: initial.theme ?? 'dark',
      status: null,
      connection: 'connecting',
      ready: false,
    };
  }

  // --- React binding ------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  /** Called for every live event that passes the filters, as it arrives. */
  onLive(listener: (e: AtlasEvent) => void): () => void {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  start(intervalMs = 450): () => void {
    this.timer = setInterval(() => this.flush(), intervalMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }

  /** Recompute the view if anything changed, or if time alone moved the window. */
  flush(force = false): void {
    // With nothing new, the window still slides; that only needs an occasional refresh.
    const idle = !this.dirty && !force;
    if (idle && (this.events.length === 0 || Date.now() - this.computedAt < 2000)) return;
    this.dirty = false;
    this.computedAt = Date.now();
    this.prune();
    this.set({ view: this.compute(this.snapshot.filters, this.snapshot.selection) });
  }

  // --- data ---------------------------------------------------------------

  now(): number {
    return Date.now() + this.clockOffset;
  }

  reset(events: AtlasEvent[], sourceNow?: number): void {
    if (sourceNow !== undefined) this.clockOffset = sourceNow - Date.now();
    this.events = events.slice();
    this.prune();
    this.set({ ready: true, view: this.compute(this.snapshot.filters, this.snapshot.selection) });
  }

  ingest(events: AtlasEvent[]): void {
    const filters = this.snapshot.filters;
    for (const e of events) {
      this.events.push(e);
      if (this.liveListeners.size > 0 && this.matches(e, filters)) {
        for (const l of this.liveListeners) l(e);
      }
    }
    this.dirty = true;
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    let drop = 0;
    while (drop < this.events.length && this.events[drop]!.t < cutoff) drop++;
    drop = Math.max(drop, this.events.length - MAX_EVENTS);
    if (drop > 0) this.events.splice(0, drop);
  }

  // --- ui state -----------------------------------------------------------

  setFilters(patch: Partial<Filters>): void {
    const filters = { ...this.snapshot.filters, ...patch };
    this.set({ filters, view: this.compute(filters, this.snapshot.selection) });
  }

  toggleClass(cls: QueryClass): void {
    const classes = { ...this.snapshot.filters.classes };
    classes[cls] = !classes[cls];
    this.setFilters({ classes });
  }

  clearFilters(): void {
    this.setFilters(defaultFilters());
  }

  select(selection: Selection): void {
    this.set({ selection, view: this.compute(this.snapshot.filters, selection) });
  }

  setPaused(paused: boolean): void {
    this.set({ paused });
  }

  setPrivacy(privacy: boolean): void {
    // A domain typed into the filter would give away what masking hides.
    if (privacy && this.snapshot.filters.text) this.setFilters({ text: '' });
    this.set({ privacy });
  }

  setTheme(theme: Theme): void {
    this.set({ theme });
  }

  setStatus(status: ServerStatus): void {
    this.set({ status });
  }

  setConnection(connection: ConnectionState): void {
    if (connection !== this.snapshot.connection) this.set({ connection });
  }

  /** F19: a stable stand-in for a device name. */
  alias(device: string): string {
    let alias = this.aliases.get(device);
    if (!alias) {
      alias = `Device ${String(this.aliases.size + 1).padStart(2, '0')}`;
      this.aliases.set(device, alias);
    }
    return alias;
  }

  // --- derivation ---------------------------------------------------------

  /** Everything except the class filter. */
  private matchesBase(e: AtlasEvent, f: Filters, text: string): boolean {
    if (f.device && e.client !== f.device) return false;
    if (f.instance && e.instance !== f.instance) return false;
    if (text && !e.domain.includes(text)) return false;
    return true;
  }

  matches(e: AtlasEvent, f: Filters = this.snapshot.filters): boolean {
    return f.classes[e.cls] && this.matchesBase(e, f, f.text.trim().toLowerCase());
  }

  private compute(filters: Filters, selection: Selection): View {
    const now = this.now();
    const start = now - this.windowMs;
    const bucketMs = this.windowMs / BUCKETS;
    const text = filters.text.trim().toLowerCase();

    const byClass: Record<QueryClass, number> = { allowed: 0, blocked: 0, local: 0, noanswer: 0 };
    const buckets: [number, number, number][] = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
    const countries = new Map<string, Row>();
    const domains = new Map<string, Row>();
    const devices = new Map<string, Row>();
    const places = new Map<string, Place>();
    const allDevices = new Set<string>();
    const allInstances = new Set<string>();
    const detailDomains = new Map<string, Row>();
    const detailDevices = new Map<string, Row>();
    const detailCities = new Map<string, Row>();
    let detailTotal = 0;
    let detailPlace: Place | undefined;
    let total = 0;
    let perMinute = 0;

    for (const e of this.events) {
      allDevices.add(e.client);
      allInstances.add(e.instance);
      if (!this.matchesBase(e, filters, text)) continue;
      // Counted before the class filter, so hiding a class does not zero its own counter.
      byClass[e.cls]++;
      if (!filters.classes[e.cls]) continue;

      total++;
      if (e.t >= now - 60_000) perMinute++;
      const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor((e.t - start) / bucketMs)));
      buckets[b]![e.cls === 'allowed' ? 0 : e.cls === 'blocked' ? 1 : 2]++;
      bump(domains, e.domain, e.domain, e);
      bump(devices, e.client, e.client, e);

      const dest = e.dest;
      if (!dest) continue;
      const key = placeKey(dest);
      let place = places.get(key);
      if (!place) {
        place = { key, ...dest, count: 0, last: 0 };
        places.set(key, place);
      }
      place.count++;
      if (e.t > place.last) place.last = e.t;
      const countryKey = dest.cc ?? dest.country ?? '??';
      bump(countries, countryKey, dest.country ?? dest.cc ?? 'Unknown', e, dest.cc);

      const selected =
        selection?.kind === 'place'
          ? selection.key === key
          : selection?.kind === 'country'
            ? selection.cc !== '' && selection.cc === dest.cc
            : false;
      if (selected) {
        detailTotal++;
        detailPlace = place;
        bump(detailDomains, e.domain, e.domain, e);
        bump(detailDevices, e.client, e.client, e);
        bump(detailCities, key, dest.city ?? 'Unknown place', e);
      }
    }

    const feed: AtlasEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && feed.length < FEED_SIZE; i--) {
      const e = this.events[i]!;
      if (filters.classes[e.cls] && this.matchesBase(e, filters, text)) feed.push(e);
    }

    let detail: Detail | null = null;
    if (selection?.kind === 'place') {
      detail = {
        title: detailPlace?.city ?? detailPlace?.country ?? 'Selected place',
        subtitle: detailPlace?.city ? (detailPlace.country ?? '') : '',
        total: detailTotal,
        domains: top(detailDomains, 14),
        devices: top(detailDevices, 10),
        cities: [],
      };
    } else if (selection?.kind === 'country') {
      detail = {
        title: selection.name,
        subtitle: detailCities.size > 0 ? `${detailCities.size} ${detailCities.size === 1 ? 'place' : 'places'}` : '',
        total: detailTotal,
        domains: top(detailDomains, 14),
        devices: top(detailDevices, 10),
        cities: top(detailCities, 6),
      };
    }

    const seen = byClass.allowed + byClass.blocked + byClass.local + byClass.noanswer;
    return {
      total,
      byClass,
      blockedShare: seen > 0 ? byClass.blocked / seen : 0,
      perMinute,
      buckets,
      topCountries: top(countries, 6),
      topDomains: top(domains, 6),
      topDevices: top(devices, 6),
      countries: countries.size,
      feed,
      devices: [...allDevices].sort((a, b) => a.localeCompare(b)),
      instances: [...allInstances].sort((a, b) => a.localeCompare(b)),
      places: [...places.values()].sort((a, b) => b.count - a.count),
      detail,
    };
  }
}
