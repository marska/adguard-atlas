import type { AtlasEvent, QueryClass } from '../../shared/types';
import { CITIES, DEMO_INSTANCES, DESTINATIONS, DEVICES, type DeviceProfile, type Habit } from './data';

/** Small seeded PRNG (mulberry32): the demo is reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function exponential(random: () => number, mean: number): number {
  return -Math.log(1 - random()) * mean;
}

interface DeviceState {
  profile: DeviceProfile;
  index: number;
  /** Every device draws from its own stream, so the result does not depend on how time is stepped. */
  random: () => number;
  seq: number;
  totalWeight: number;
  busy: boolean;
  /** When the current busy or quiet spell ends. */
  spellEnds: number;
  /** When the next burst starts. */
  nextBurst: number;
}

/**
 * F24. An invented household: every device has its own habits and alternates
 * between busy spells (bursts every few seconds) and quiet ones. Time is simulated,
 * so the same code fills the window on start-up and then runs live.
 */
export class DemoGenerator {
  private readonly devices: DeviceState[];
  /** Events already decided but still in the future: the tail of a burst. */
  private queue: AtlasEvent[] = [];

  constructor(seed: number, startTime: number) {
    this.devices = DEVICES.map((profile, index) => {
      const random = mulberry32(seed + index * 7919);
      const busy = random() < profile.busyFor / (profile.busyFor + profile.quietFor);
      return {
        profile,
        index,
        random,
        seq: 0,
        totalWeight: profile.habits.reduce((sum, h) => sum + h[1], 0),
        busy,
        spellEnds: startTime + exponential(random, busy ? profile.busyFor : profile.quietFor),
        nextBurst: startTime + 1 + random() * (busy ? profile.busyGap : profile.quietGap),
      };
    });
  }

  private pick(state: DeviceState): Habit {
    let r = state.random() * state.totalWeight;
    for (const habit of state.profile.habits) {
      r -= habit[1];
      if (r <= 0) return habit;
    }
    return state.profile.habits[0]!;
  }

  private event(state: DeviceState, habit: Habit, t: number): AtlasEvent {
    const [pattern, , forced] = habit;
    const { random } = state;
    const domain = pattern.replace('#', String(1 + Math.floor(random() * 8)));
    const cls: QueryClass = forced ?? 'allowed';
    const resolver = random() < 0.9 ? state.profile.resolver : 1 - state.profile.resolver;
    const event: AtlasEvent = {
      id: `d${state.index}-${(state.seq++).toString(36)}`,
      t: Math.round(t),
      instance: DEMO_INSTANCES[resolver]!,
      client: state.profile.name,
      domain,
      qtype: random() < 0.82 ? 'A' : 'AAAA',
      cls,
    };
    if (cls === 'allowed') {
      const code = DESTINATIONS[pattern];
      if (code) {
        const c = CITIES[code];
        event.dest = { lat: c.lat, lon: c.lon, city: c.city, country: c.country, cc: c.cc };
      }
    }
    return event;
  }

  /** Advance simulated time to `until` and return what happened, oldest first. */
  advance(until: number): AtlasEvent[] {
    for (const state of this.devices) {
      const { profile, random } = state;
      while (state.nextBurst <= until) {
        const at = state.nextBurst;
        while (at >= state.spellEnds) {
          state.busy = !state.busy;
          state.spellEnds += exponential(random, state.busy ? profile.busyFor : profile.quietFor);
        }
        const [min, max] = profile.burst;
        const size = state.busy ? min + Math.floor(random() * (max - min + 1)) : 1;
        // An app opening asks for a few names over and over, not for everything once.
        const focus = this.pick(state);
        let t = at;
        for (let i = 0; i < size; i++) {
          const habit = i > 0 && random() < 0.35 ? focus : this.pick(state);
          this.queue.push(this.event(state, habit, t));
          t += 25 + random() * 260;
        }
        state.nextBurst = at + Math.max(400, exponential(random, state.busy ? profile.busyGap : profile.quietGap));
      }
    }
    this.queue.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let due = 0;
    while (due < this.queue.length && this.queue[due]!.t <= until) due++;
    return this.queue.splice(0, due);
  }
}
