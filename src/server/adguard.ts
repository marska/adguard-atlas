import http from 'node:http';
import https from 'node:https';
import type { InstanceStatus } from '../shared/types';
import { parseTimeNs, type RawEntry } from './classify';
import type { InstanceConfig } from './config';

/**
 * The one request this application ever makes to AdGuard Home (section 7 of the
 * specification). The account it uses could also change settings, so the method
 * and path are constants and a test pins them.
 */
export const QUERYLOG_METHOD = 'GET';
export const QUERYLOG_PATH = '/control/querylog';

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export type AdGuardErrorKind = 'unauthorized' | 'unreachable' | 'timeout' | 'tls' | 'http' | 'bad_response';

export class AdGuardError extends Error {
  constructor(
    readonly kind: AdGuardErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface QueryLogPage {
  data: RawEntry[];
  oldest: string;
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export class AdGuardClient {
  private readonly base: URL;
  private readonly authorization: string;

  constructor(
    private readonly instance: InstanceConfig,
    private readonly timeoutMs = 10_000,
  ) {
    this.base = new URL(instance.url);
    this.authorization =
      'Basic ' + Buffer.from(`${instance.user}:${instance.password}`, 'utf8').toString('base64');
  }

  /** F1: `GET /control/querylog`, newest entries first. */
  fetchQueryLog(limit: number, olderThan?: string): Promise<QueryLogPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (olderThan) query.set('older_than', olderThan);
    const path = this.base.pathname.replace(/\/+$/, '') + QUERYLOG_PATH + '?' + query.toString();
    const secure = this.base.protocol === 'https:';

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        method: QUERYLOG_METHOD,
        hostname: this.base.hostname.replace(/^\[|\]$/g, ''),
        port: this.base.port || (secure ? 443 : 80),
        path,
        headers: { Authorization: this.authorization, Accept: 'application/json' },
        timeout: this.timeoutMs,
        // F4: only ever relaxed for the instance that asked for it.
        ...(secure ? { rejectUnauthorized: !this.instance.insecureTls } : {}),
      };
      const req = (secure ? https : http).request(options, (res) => {
        const status = res.statusCode ?? 0;
        if (status === 401 || status === 403) {
          res.resume();
          reject(new AdGuardError('unauthorized', `Credentials rejected (HTTP ${status})`));
          return;
        }
        // Redirects are deliberately not followed: the server only ever talks to
        // the URLs it was configured with.
        if (status !== 200) {
          res.resume();
          reject(new AdGuardError('http', `Unexpected answer: HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new AdGuardError('bad_response', 'Query log answer is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', (err) => reject(toError(err)));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<QueryLogPage>;
            resolve({
              data: Array.isArray(body.data) ? body.data : [],
              oldest: typeof body.oldest === 'string' ? body.oldest : '',
            });
          } catch {
            reject(new AdGuardError('bad_response', 'Answer is not a query log (is this an AdGuard Home URL?)'));
          }
        });
      });
      req.on('timeout', () => {
        req.destroy(new AdGuardError('timeout', `No answer within ${Math.round(this.timeoutMs / 1000)} s`));
      });
      req.on('error', (err) => reject(toError(err)));
      req.end();
    });
  }
}

function toError(err: unknown): AdGuardError {
  if (err instanceof AdGuardError) return err;
  const code = (err as NodeJS.ErrnoException).code ?? '';
  if (TLS_CODES.has(code)) {
    return new AdGuardError(
      'tls',
      `TLS certificate not trusted (${code}); set ADGUARD_<n>_INSECURE_TLS=true for a self-signed panel`,
    );
  }
  return new AdGuardError('unreachable', `Unreachable${code ? ` (${code})` : ''}`);
}

export interface QueryLogSource {
  fetchQueryLog(limit: number, olderThan?: string): Promise<QueryLogPage>;
}

export interface PollerOptions {
  name: string;
  intervalMs: number;
  onEntries: (entries: RawEntry[]) => void;
  onStatus: (status: InstanceStatus) => void;
  pageLimit?: number;
  maxPages?: number;
  maxBackoffMs?: number;
}

const SEEN_LIMIT = 4000;

function entryKey(e: RawEntry): string {
  return `${e.time}|${e.client}|${e.question?.name}|${e.question?.type}`;
}

/**
 * F3 / F5. AdGuard Home has no streaming API, so the query log is polled. The first
 * successful poll only records where the log currently ends ("now"); after that
 * each poll walks back from the newest entry until it meets something already seen.
 */
export class Poller {
  private watermark: bigint | null = null;
  private seen = new Set<string>();
  private failures = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private status: InstanceStatus;

  constructor(
    private readonly source: QueryLogSource,
    private readonly options: PollerOptions,
  ) {
    this.status = { name: options.name, state: 'connecting' };
  }

  get currentStatus(): InstanceStatus {
    return this.status;
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** How long to wait before the next poll: the interval, doubled per consecutive failure. */
  nextDelay(): number {
    const { intervalMs, maxBackoffMs = 60_000 } = this.options;
    if (this.failures === 0) return intervalMs;
    // The cap must never be shorter than the normal interval (POLL_INTERVAL_MS goes up to
    // 10 minutes): a failing instance is retried less often, never more often.
    return Math.min(Math.max(intervalMs, 1000) * 2 ** Math.min(this.failures, 10), Math.max(maxBackoffMs, intervalMs));
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    await this.tick();
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), this.nextDelay());
  }

  private setStatus(next: InstanceStatus): void {
    const changed = next.state !== this.status.state || next.message !== this.status.message;
    this.status = next;
    if (changed) this.options.onStatus(next);
  }

  /** One poll. Never throws: a failure becomes a status. */
  async tick(): Promise<void> {
    try {
      const fresh = await this.collect();
      this.failures = 0;
      this.setStatus({ name: this.options.name, state: 'ok', lastOk: Date.now() });
      if (fresh.length > 0) this.options.onEntries(fresh);
    } catch (err) {
      this.failures++;
      const message = err instanceof AdGuardError ? err.message : 'Unexpected error while polling';
      this.setStatus({ name: this.options.name, state: 'error', message, lastOk: this.status.lastOk });
    }
  }

  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size > SEEN_LIMIT) {
      // Sets iterate in insertion order: drop the oldest half.
      let drop = SEEN_LIMIT / 2;
      for (const k of this.seen) {
        if (drop-- <= 0) break;
        this.seen.delete(k);
      }
    }
  }

  private async collect(): Promise<RawEntry[]> {
    const { pageLimit = 200, maxPages = 10 } = this.options;

    if (this.watermark === null) {
      // First contact: note where the log ends and emit nothing.
      const page = await this.source.fetchQueryLog(pageLimit);
      let newest = 0n;
      for (const e of page.data) {
        const ns = parseTimeNs(e.time);
        if (ns === null) continue;
        if (ns > newest) newest = ns;
        this.remember(entryKey(e));
      }
      this.watermark = newest;
      return [];
    }

    const fresh: RawEntry[] = [];
    let newest = this.watermark;
    let olderThan: string | undefined;
    pages: for (let page = 0; page < maxPages; page++) {
      const res = await this.source.fetchQueryLog(pageLimit, olderThan);
      for (const e of res.data) {
        const ns = parseTimeNs(e.time);
        if (ns === null) continue;
        if (ns < this.watermark) break pages;
        const key = entryKey(e);
        if (this.seen.has(key)) continue;
        if (ns > newest) newest = ns;
        fresh.push(e);
      }
      const last = res.data[res.data.length - 1];
      olderThan = res.oldest || last?.time;
      if (res.data.length < pageLimit || !olderThan) break;
    }
    // Remember oldest first, so that when the set is trimmed the newest keys survive.
    fresh.reverse();
    for (const e of fresh) this.remember(entryKey(e));
    this.watermark = newest;
    return fresh;
  }
}
