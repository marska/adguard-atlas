import { readFileSync } from 'node:fs';
import { DEMO_HOME } from '../shared/types';
import type { LogLevel } from './log';

export interface InstanceConfig {
  /** The number in `ADGUARD_<n>_…` */
  index: number;
  name: string;
  /** Base URL without a trailing slash */
  url: string;
  user: string;
  password: string;
  insecureTls: boolean;
}

export interface Config {
  demo: boolean;
  port: number;
  instances: InstanceConfig[];
  home: { lat: number; lon: number; label: string };
  pollIntervalMs: number;
  windowMinutes: number;
  privacyMode: boolean;
  ignoreClients: string[];
  ignoreDomains: string[];
  geoipDb: string;
  logLevel: LogLevel;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

export const DEFAULT_GEOIP_DB = '/usr/share/geoip/dbip-city-lite.mmdb';

function bool(env: Env, key: string, fallback = false): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${key} must be true or false, got "${env[key]}"`);
}

function int(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${key} must be a whole number between ${min} and ${max}, got "${raw}"`);
  }
  return n;
}

function coordinate(env: Env, key: string, limit: number): number | undefined {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new ConfigError(`${key} must be a number between -${limit} and ${limit}, got "${raw}"`);
  }
  return n;
}

function list(env: Env, key: string): string[] {
  return (env[key] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function secret(env: Env, key: string, readFile: ReadFile): string | undefined {
  const direct = env[key];
  if (direct !== undefined && direct !== '') return direct;
  const file = env[`${key}_FILE`]?.trim();
  if (!file) return undefined;
  try {
    return readFile(file).replace(/\r?\n$/, '');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'error';
    throw new ConfigError(`${key}_FILE: cannot read ${file} (${code})`);
  }
}

function instances(env: Env, readFile: ReadFile): InstanceConfig[] {
  const indexes = new Set<number>();
  for (const key of Object.keys(env)) {
    const m = /^ADGUARD_(\d+)_[A-Z_]+$/.exec(key);
    if (m && env[key] !== undefined && env[key] !== '') indexes.add(Number(m[1]));
  }
  const result: InstanceConfig[] = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const prefix = `ADGUARD_${index}_`;
    const rawUrl = env[`${prefix}URL`]?.trim();
    if (!rawUrl) throw new ConfigError(`${prefix}URL is required`);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ConfigError(`${prefix}URL is not a valid URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ConfigError(`${prefix}URL must start with http:// or https://`);
    }
    if (url.username || url.password) {
      throw new ConfigError(`${prefix}URL must not contain credentials; use ${prefix}USER and ${prefix}PASSWORD`);
    }
    const user = env[`${prefix}USER`];
    if (!user) throw new ConfigError(`${prefix}USER is required`);
    const password = secret(env, `${prefix}PASSWORD`, readFile);
    if (password === undefined) {
      throw new ConfigError(`${prefix}PASSWORD (or ${prefix}PASSWORD_FILE) is required`);
    }
    result.push({
      index,
      name: env[`${prefix}NAME`]?.trim() || url.hostname,
      url: (url.origin + url.pathname).replace(/\/+$/, ''),
      user,
      password,
      insecureTls: bool(env, `${prefix}INSECURE_TLS`),
    });
  }
  // Display names double as filter keys in the UI, so they have to be unique.
  const seen = new Map<string, number>();
  for (const inst of result) {
    const n = (seen.get(inst.name) ?? 0) + 1;
    seen.set(inst.name, n);
    if (n > 1) inst.name = `${inst.name} #${n}`;
  }
  return result;
}

export function loadConfig(
  env: Env = process.env,
  readFile: ReadFile = (p) => readFileSync(p, 'utf8'),
): Config {
  const demo = bool(env, 'DEMO');
  const lat = coordinate(env, 'HOME_LAT', 90);
  const lon = coordinate(env, 'HOME_LON', 180);
  const level = (env.LOG_LEVEL?.trim().toLowerCase() || 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new ConfigError('LOG_LEVEL must be one of debug, info, warn, error');
  }

  const config: Config = {
    demo,
    port: int(env, 'PORT', 8080, 1, 65535),
    instances: [],
    home: {
      lat: lat ?? DEMO_HOME.lat,
      lon: lon ?? DEMO_HOME.lon,
      label: env.HOME_LABEL?.trim() || 'Home',
    },
    pollIntervalMs: int(env, 'POLL_INTERVAL_MS', 2000, 250, 600_000),
    windowMinutes: int(env, 'WINDOW_MINUTES', 15, 1, 240),
    privacyMode: bool(env, 'PRIVACY_MODE'),
    ignoreClients: list(env, 'IGNORE_CLIENTS'),
    ignoreDomains: list(env, 'IGNORE_DOMAINS').map((d) => d.replace(/^\*?\./, '').replace(/\.$/, '')),
    geoipDb: env.GEOIP_DB?.trim() || DEFAULT_GEOIP_DB,
    logLevel: level,
  };

  if (demo) return config;

  if (lat === undefined || lon === undefined) {
    throw new ConfigError('HOME_LAT and HOME_LON are required (or set DEMO=true to try the demo)');
  }
  config.instances = instances(env, readFile);
  if (config.instances.length === 0) {
    throw new ConfigError(
      'No AdGuard Home instance configured: set ADGUARD_1_URL, ADGUARD_1_USER and ADGUARD_1_PASSWORD (or set DEMO=true to try the demo)',
    );
  }
  return config;
}
