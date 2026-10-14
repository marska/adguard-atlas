import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QUERY_CLASSES, type AtlasEvent } from '../src/shared/types';
import { Legend } from '../src/web/components/Chrome';
import { CITIES, DESTINATIONS, DEVICES } from '../src/web/demo/data';
import { DemoGenerator } from '../src/web/demo/generator';
import { ArcScheduler } from '../src/web/map/scheduler';
import { AtlasStore, FEED_SIZE, placeKey } from '../src/web/store';

const START = Date.UTC(2026, 9, 13, 10, 0, 0);
const MINUTE = 60_000;

describe('demo generator (F24, F25)', () => {
  const events = new DemoGenerator(42, START).advance(START + 15 * MINUTE);

  it('is deterministic for a seed', () => {
    expect(new DemoGenerator(42, START).advance(START + 15 * MINUTE)).toEqual(events);
    expect(new DemoGenerator(43, START).advance(START + 15 * MINUTE)).not.toEqual(events);
  });

  it('produces a lively but bounded household', () => {
    expect(events.length).toBeGreaterThan(1500);
    expect(events.length).toBeLessThan(15_000);
    expect(new Set(events.map((e) => e.client)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(events.map((e) => e.instance))).toEqual(new Set(['adguard-1', 'adguard-2']));
    for (let i = 1; i < events.length; i++) expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    expect(events.every((e) => e.t > START && e.t <= START + 15 * MINUTE)).toBe(true);
  });

  it('has a share of every class', () => {
    const share = (cls: string) => events.filter((e) => e.cls === cls).length / events.length;
    expect(share('allowed')).toBeGreaterThan(0.45);
    expect(share('blocked')).toBeGreaterThan(0.1);
    expect(share('blocked')).toBeLessThan(0.45);
    expect(share('local')).toBeGreaterThan(0);
    expect(share('noanswer')).toBeGreaterThan(0);
  });

  it('gives the smart plug its habit of being refused', () => {
    const plug = events.filter((e) => e.client === 'Smart plug');
    expect(plug.length).toBeGreaterThan(20);
    expect(plug.filter((e) => e.cls === 'blocked').length / plug.length).toBeGreaterThan(0.6);
  });

  it('only ever names invented domains and bundled cities', () => {
    const cities = new Set(Object.values(CITIES).map((c) => `${c.city}|${c.lat}|${c.lon}`));
    for (const e of events) {
      expect(e.domain).toMatch(/\.(example|lan|localdomain)$/);
      if (e.cls === 'allowed') {
        expect(e.dest).toBeDefined();
        expect(cities.has(`${e.dest!.city}|${e.dest!.lat}|${e.dest!.lon}`)).toBe(true);
      } else {
        expect(e.dest).toBeUndefined();
      }
    }
  });

  it('has a destination for every allowed habit and none for the others', () => {
    for (const device of DEVICES) {
      for (const [domain, weight, cls] of device.habits) {
        expect(weight).toBeGreaterThan(0);
        expect(domain in DESTINATIONS).toBe(cls === undefined);
      }
    }
  });

  it('continues seamlessly when advanced in small steps', () => {
    const g = new DemoGenerator(7, START);
    const stepped: AtlasEvent[] = [];
    for (let t = START + 120; t <= START + 2 * MINUTE; t += 120) stepped.push(...g.advance(t));
    expect(stepped).toEqual(new DemoGenerator(7, START).advance(START + 2 * MINUTE));
  });
});

describe('arc scheduler (F22)', () => {
  const dest = (n: number) => `place-${n}`;

  it('caps the arcs released per second, however many queries arrive', () => {
    const s = new ArcScheduler<number>({ perSecond: 10, burst: 5, maxWaitMs: 1000 });
    let released = 0;
    let expired = 0;
    // Ten seconds of 500 queries per second to 500 different places.
    for (let ms = 0; ms <= 10_000; ms += 16) {
      for (let i = 0; i < 8; i++) s.push(dest((ms + i) % 500), i, ms);
      const out = s.take(ms);
      released += out.released.length;
      expired += out.expired.length;
    }
    expect(released).toBeLessThanOrEqual(10 * 10 + 5);
    expect(released).toBeGreaterThan(90);
    expect(expired).toBeGreaterThan(0);
    expect(s.waiting).toBeLessThanOrEqual(500);
  });

  it('merges queries to the same destination into one heavier arc', () => {
    const s = new ArcScheduler<number>({ perSecond: 1, burst: 1, maxWaitMs: 1000 });
    for (let i = 0; i < 40; i++) s.push('same', i, 0);
    const { released } = s.take(0);
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ key: 'same', count: 40 });
    expect(s.waiting).toBe(0);
  });

  it('hands back what waited too long instead of drawing it late', () => {
    const s = new ArcScheduler<number>({ perSecond: 1, burst: 1, maxWaitMs: 500 });
    s.push('a', 1, 0);
    s.push('b', 2, 0);
    expect(s.take(0).released.map((r) => r.key)).toEqual(['a']);
    expect(s.take(100)).toEqual({ released: [], expired: [] });
    expect(s.take(700).expired.map((r) => r.key)).toEqual(['b']);
  });
});

describe('store', () => {
  const now = Date.now();
  const make = (i: number, patch: Partial<AtlasEvent> = {}): AtlasEvent => ({
    id: String(i),
    t: now - 1000 + i,
    instance: 'one',
    client: 'tv',
    domain: `d${i}.example`,
    qtype: 'A',
    cls: 'allowed',
    dest: { lat: 50.11, lon: 8.68, city: 'Frankfurt', country: 'Germany', cc: 'DE' },
    ...patch,
  });
  const sample = [
    make(1),
    make(2, { domain: 'd1.example' }),
    make(3, { client: 'phone', cls: 'blocked', dest: undefined, domain: 'ads.example' }),
    make(4, { client: 'phone', instance: 'two', dest: { lat: 35.68, lon: 139.69, city: 'Tokyo', country: 'Japan', cc: 'JP' } }),
    make(5, { cls: 'local', dest: undefined, domain: 'nas.lan' }),
    make(6, { cls: 'noanswer', dest: undefined }),
  ];

  const fresh = () => {
    const store = new AtlasStore(15 * MINUTE);
    store.reset(sample, now);
    return store;
  };

  it('derives counters, places and the feed from the window (F11, F14, F15)', () => {
    const { view } = fresh().getSnapshot();
    expect(view.total).toBe(6);
    expect(view.byClass).toEqual({ allowed: 3, blocked: 1, local: 1, noanswer: 1 });
    expect(view.blockedShare).toBeCloseTo(1 / 6);
    expect(view.topCountries.map((r) => [r.cc, r.count])).toEqual([['DE', 2], ['JP', 1]]);
    expect(view.topDomains[0]).toMatchObject({ label: 'd1.example', count: 2 });
    expect(view.topDevices.map((r) => [r.label, r.count])).toEqual([['tv', 4], ['phone', 2]]);
    expect(view.places.map((p) => [p.city, p.count])).toEqual([['Frankfurt', 2], ['Tokyo', 1]]);
    expect(view.feed.map((e) => e.id)).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(view.devices).toEqual(['phone', 'tv']);
    expect(view.instances).toEqual(['one', 'two']);
    expect(view.buckets.reduce((sum, b) => sum + b[0] + b[1] + b[2], 0)).toBe(6);
  });

  it('filters by device, class, instance and domain text (F16)', () => {
    const store = fresh();
    store.setFilters({ device: 'phone' });
    expect(store.getSnapshot().view.total).toBe(2);
    expect(store.getSnapshot().view.places.map((p) => p.city)).toEqual(['Tokyo']);
    // The device list is not narrowed by its own filter.
    expect(store.getSnapshot().view.devices).toEqual(['phone', 'tv']);

    store.clearFilters();
    store.toggleClass('blocked');
    expect(store.getSnapshot().view.total).toBe(5);
    expect(store.getSnapshot().view.byClass.blocked).toBe(1);
    expect(store.getSnapshot().view.feed.some((e) => e.cls === 'blocked')).toBe(false);

    store.clearFilters();
    store.setFilters({ instance: 'two' });
    expect(store.getSnapshot().view.total).toBe(1);

    store.clearFilters();
    store.setFilters({ text: ' D1.EX ' });
    expect(store.getSnapshot().view.total).toBe(2);
  });

  it('matches every word of the text against the domain or the device (F16)', () => {
    const store = fresh();
    const ids = () => store.getSnapshot().view.feed.map((e) => e.id).sort();
    store.setFilters({ text: 'phone' });
    expect(ids()).toEqual(['3', '4']);
    store.setFilters({ text: '  PHO   ads ' });
    expect(ids()).toEqual(['3']);
    store.setFilters({ text: 'tv d1' });
    expect(ids()).toEqual(['1', '2']);
    store.setFilters({ text: 'phone d1' });
    expect(ids()).toEqual([]);
    expect(store.matches(make(9, { client: 'phone', domain: 'ads.example' }))).toBe(false);
    store.setFilters({ text: 'ads phone' });
    expect(store.matches(make(9, { client: 'phone', domain: 'ads.example' }))).toBe(true);
  });

  it('lets the legend toggle classes, but not in kiosk mode (F16, F18)', () => {
    const store = fresh();
    const live = renderToStaticMarkup(createElement(Legend, { store, snap: store.getSnapshot() }));
    expect(live.match(/<button/g)).toHaveLength(QUERY_CLASSES.length);
    expect(live).not.toContain('aria-pressed="false"');

    store.toggleClass('noanswer');
    const toggled = renderToStaticMarkup(createElement(Legend, { store, snap: store.getSnapshot() }));
    expect(toggled.match(/aria-pressed="false"[^>]*>(.*?)<\/button>/)?.[1]).toContain('No answer');

    const caption = renderToStaticMarkup(createElement(Legend));
    expect(caption).not.toContain('<button');
    expect(caption).toContain('No answer');
  });

  it('lists the domains and devices behind a place or a country (F17)', () => {
    const store = fresh();
    store.select({ kind: 'place', key: placeKey({ lat: 50.11, lon: 8.68 }) });
    expect(store.getSnapshot().view.detail).toMatchObject({
      title: 'Frankfurt',
      subtitle: 'Germany',
      total: 2,
      domains: [{ label: 'd1.example', count: 2 }],
      devices: [{ label: 'tv', count: 2 }],
    });
    store.select({ kind: 'country', cc: 'JP', name: 'Japan' });
    expect(store.getSnapshot().view.detail).toMatchObject({ title: 'Japan', total: 1, cities: [{ label: 'Tokyo' }] });
    store.select({ kind: 'country', cc: '', name: 'Greenland' });
    expect(store.getSnapshot().view.detail).toMatchObject({ title: 'Greenland', total: 0 });
    store.select(null);
    expect(store.getSnapshot().view.detail).toBeNull();
  });

  it('passes live events on only when they match the filters, and keeps collecting', () => {
    const store = fresh();
    const live: string[] = [];
    store.onLive((e) => live.push(e.id));
    store.setFilters({ device: 'tv' });
    store.ingest([make(7), make(8, { client: 'phone' })]);
    expect(live).toEqual(['7']);
    store.clearFilters();
    store.flush();
    expect(store.getSnapshot().view.total).toBe(8);
  });

  it('drops what has left the window and uses the source clock', () => {
    const store = new AtlasStore(15 * MINUTE);
    // A browser whose clock is an hour ahead of the server's.
    const serverNow = Date.now() - 60 * MINUTE;
    store.reset([make(1, { t: serverNow - 16 * MINUTE }), make(2, { t: serverNow - 14 * MINUTE })], serverNow);
    expect(store.getSnapshot().view.feed.map((e) => e.id)).toEqual(['2']);
  });

  it('caps the feed and masks devices consistently (F19)', () => {
    const store = new AtlasStore(15 * MINUTE);
    store.reset(Array.from({ length: 300 }, (_, i) => make(i)), now);
    expect(store.getSnapshot().view.feed).toHaveLength(FEED_SIZE);
    expect(store.alias('tv')).toBe('Device 01');
    expect(store.alias('phone')).toBe('Device 02');
    expect(store.alias('tv')).toBe('Device 01');
    store.setFilters({ text: 'secret.example' });
    store.setPrivacy(true);
    expect(store.getSnapshot().filters.text).toBe('');
    expect(store.getSnapshot().privacy).toBe(true);
  });
});
