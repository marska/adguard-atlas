import type { AtlasEvent } from '../shared/types';
import { classify, clientName, parseTimeNs, questionName, type RawEntry } from './classify';
import type { GeoLocator } from './geoip';
import type { Masker } from './privacy';

export interface PipelineOptions {
  geo?: GeoLocator;
  masker?: Masker;
  ignoreClients?: string[];
  ignoreDomains?: string[];
}

/** Turns raw query-log entries into the events the browser draws (F6–F8). */
export class Pipeline {
  private seq = 0;
  private readonly ignoreClients: Set<string>;
  private readonly ignoreDomains: string[];

  constructor(private readonly options: PipelineOptions = {}) {
    this.ignoreClients = new Set(options.ignoreClients ?? []);
    this.ignoreDomains = options.ignoreDomains ?? [];
  }

  private ignored(entry: RawEntry, device: string, domain: string): boolean {
    if (this.ignoreClients.has(device.toLowerCase())) return true;
    if (entry.client && this.ignoreClients.has(entry.client.toLowerCase())) return true;
    return this.ignoreDomains.some((d) => domain === d || domain.endsWith('.' + d));
  }

  process(instance: string, entries: RawEntry[]): AtlasEvent[] {
    const out: AtlasEvent[] = [];
    for (const entry of entries) {
      const domain = questionName(entry);
      const ns = parseTimeNs(entry.time);
      if (!domain || ns === null) continue;
      const device = clientName(entry);
      if (this.ignored(entry, device, domain)) continue;

      const { cls, address } = classify(entry);
      const { masker, geo } = this.options;
      const event: AtlasEvent = {
        id: (this.seq++).toString(36),
        t: Number(ns / 1_000_000n),
        instance,
        client: masker ? masker.device(device) : device,
        domain: masker ? masker.domain(domain) : domain,
        qtype: entry.question?.type ?? '',
        cls,
      };
      if (address) {
        const dest = geo?.lookup(address);
        if (dest) event.dest = dest;
      }
      out.push(event);
    }
    return out;
  }
}
