import { describe, expect, it } from 'vitest';
import type { AtlasEvent } from '../src/shared/types';
import { CITIES, DESTINATIONS, DEVICES } from '../src/web/demo/data';
import { DemoGenerator } from '../src/web/demo/generator';
import { ArcScheduler } from '../src/web/map/scheduler';

const START = Date.UTC(2026, 9, 13, 10, 0, 0);
const MINUTE = 60_000;

describe('demo generator: invariants (F24, F25)', () => {
  it('only uses the reserved .example TLD for anything that could be a real name', () => {
    for (const device of DEVICES) {
      for (const [domain, , cls] of device.habits) {
        const lan = cls === 'local' || cls === 'noanswer';
        expect(domain, `${device.name}: ${domain}`).toMatch(lan ? /\.(example|lan|localdomain)$/ : /\.example$/);
      }
    }
    for (const domain of Object.keys(DESTINATIONS)) expect(domain).toMatch(/\.example$/);
  });

  it('names no real person and no network: devices are not IPs, MACs, e-mail addresses or hostnames', () => {
    for (const { name } of DEVICES) {
      expect(name).not.toMatch(/@|\d+\.\d+\.\d+\.\d+|([0-9a-f]{2}:){3}|\.[a-z]{2,}$/i);
    }
    const events = new DemoGenerator(5, START).advance(START + 5 * MINUTE);
    for (const e of events) expect(JSON.stringify(e)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('keeps every bundled city a plausible point on the map', () => {
    for (const [code, c] of Object.entries(CITIES)) {
      expect(Math.abs(c.lat), code).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon), code).toBeLessThanOrEqual(180);
      expect(c.cc, code).toMatch(/^[A-Z]{2}$/);
      expect(c.city.length, code).toBeGreaterThan(0);
    }
  });

  it.each([1, 2, 3, 4, 5, 99, 2026])('has all four classes in a 15-minute window, seed %i', (seed) => {
    const events = new DemoGenerator(seed, START).advance(START + 15 * MINUTE);
    const counts = { allowed: 0, blocked: 0, local: 0, noanswer: 0 };
    for (const e of events) counts[e.cls]++;
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0);
    expect(counts.allowed / events.length).toBeGreaterThan(0.4);
    expect(counts.blocked / events.length).toBeLessThan(0.5);
    expect(counts.local + counts.noanswer).toBeLessThan(events.length * 0.25);
  });

  it('gives every event a unique id and a plausible shape', () => {
    const events = new DemoGenerator(11, START).advance(START + 15 * MINUTE);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    for (const e of events) {
      expect(['A', 'AAAA']).toContain(e.qtype);
      expect(e.domain).not.toContain('#');
    }
  });

  it('does not go back in time or lose events when asked for an earlier moment', () => {
    const g = new DemoGenerator(3, START);
    const first = g.advance(START + 2 * MINUTE);
    expect(g.advance(START + MINUTE)).toEqual([]);
    expect(g.advance(START + 2 * MINUTE)).toEqual([]);
    const later = g.advance(START + 4 * MINUTE);
    const all: AtlasEvent[] = [...first, ...later];
    expect(all).toEqual(new DemoGenerator(3, START).advance(START + 4 * MINUTE));
  });

  it('shows more than one resolver, but each device mostly sticks to its own', () => {
    const events = new DemoGenerator(8, START).advance(START + 15 * MINUTE);
    const tv = events.filter((e) => e.client === 'Living-room TV');
    const home = tv.filter((e) => e.instance === 'adguard-1').length / tv.length;
    expect(home).toBeGreaterThan(0.7);
    expect(home).toBeLessThan(1);
  });
});

describe('arc scheduler: guarantees under load (F22)', () => {
  it('accounts for every query: nothing is lost, only merged or expired', () => {
    const s = new ArcScheduler<null>({ perSecond: 5, burst: 3, maxWaitMs: 800 });
    let pushed = 0;
    let accounted = 0;
    for (let ms = 0; ms <= 20_000; ms += 10) {
      for (let i = 0; i < 6; i++) {
        s.push(`k${(ms / 10 + i * 31) % 200}`, null, ms);
        pushed++;
      }
      const out = s.take(ms);
      for (const r of [...out.released, ...out.expired]) accounted += r.count;
    }
    // Everything still waiting has waited far too long by now: it is released or handed back.
    const rest = s.take(60_000);
    for (const r of [...rest.released, ...rest.expired]) accounted += r.count;
    expect(s.waiting).toBe(0);
    expect(accounted).toBe(pushed);
  });

  it('does not bank an unlimited credit during a quiet hour', () => {
    const s = new ArcScheduler<null>({ perSecond: 10, burst: 4, maxWaitMs: 1000 });
    s.take(0);
    for (let i = 0; i < 100; i++) s.push(`k${i}`, null, 3_600_000);
    expect(s.take(3_600_000).released).toHaveLength(4);
  });

  it('survives a clock that stands still or steps back', () => {
    const s = new ArcScheduler<null>({ perSecond: 10, burst: 2, maxWaitMs: 1000 });
    s.push('a', null, 1000);
    s.push('b', null, 1000);
    s.push('c', null, 1000);
    expect(s.take(1000).released).toHaveLength(2);
    expect(s.take(1000).released).toHaveLength(0);
    expect(s.take(500).released).toHaveLength(0);
    expect(s.take(1200).released).toHaveLength(1);
  });
});
