import type { QueryClass } from '../shared/types';
import { isIpAddress, isPublicAddress } from './ip';

/** The parts of an AdGuard Home query-log entry this app reads. */
export interface RawAnswer {
  type?: string;
  value?: unknown;
  ttl?: number;
}

export interface RawEntry {
  answer?: RawAnswer[] | null;
  client?: string;
  client_info?: { name?: string } | null;
  question?: { name?: string; type?: string; class?: string } | null;
  reason?: string;
  status?: string;
  time?: string;
}

export interface Classification {
  cls: QueryClass;
  /** The public address the query resolved to; only for `allowed`. */
  address?: string;
}

/**
 * F6 / F8. A query-log entry carries the whole answer section, so a CNAME chain and
 * the addresses at its end arrive together: the destination is the first public
 * address among the A/AAAA records, wherever in the chain it sits.
 */
export function classify(entry: RawEntry): Classification {
  const reason = entry.reason ?? '';
  if (reason.startsWith('Filtered')) return { cls: 'blocked' };

  let sawAddress = false;
  for (const record of entry.answer ?? []) {
    if (record.type !== 'A' && record.type !== 'AAAA') continue;
    if (!isIpAddress(record.value)) continue;
    sawAddress = true;
    if (isPublicAddress(record.value)) return { cls: 'allowed', address: record.value };
  }

  // Private answers and rewrites that lead nowhere public: LAN names.
  if (sawAddress || reason.startsWith('Rewrite')) return { cls: 'local' };

  return { cls: 'noanswer' };
}

/** D5: the name AdGuard Home knows the client by, its IP otherwise. */
export function clientName(entry: RawEntry): string {
  const name = entry.client_info?.name?.trim();
  return name || entry.client?.trim() || 'unknown';
}

export function questionName(entry: RawEntry): string {
  return (entry.question?.name ?? '').replace(/\.$/, '').toLowerCase();
}

const TIME = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/;

/**
 * AdGuard Home timestamps are RFC 3339 with nanoseconds. Milliseconds are not
 * enough to tell neighbouring entries apart, so the poller compares nanoseconds.
 */
export function parseTimeNs(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const m = TIME.exec(value);
  if (!m) return null;
  const ms = Date.parse(m[1]! + m[3]!);
  if (Number.isNaN(ms)) return null;
  const frac = (m[2] ?? '').padEnd(9, '0');
  return BigInt(ms) * 1_000_000n + BigInt(frac);
}
