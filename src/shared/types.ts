/** Types shared by the server and the front end. */

export type QueryClass = 'allowed' | 'blocked' | 'local' | 'noanswer';

export const QUERY_CLASSES: readonly QueryClass[] = ['allowed', 'blocked', 'local', 'noanswer'];

export const APP_VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/marska/adguard-atlas';

/** Where an answer points, as far as the GeoIP database knows. */
export interface Destination {
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  /** ISO 3166-1 alpha-2 */
  cc?: string;
}

/** One DNS query, classified and located. This is all the browser ever sees. */
export interface AtlasEvent {
  id: string;
  /** Unix time in milliseconds */
  t: number;
  /** Display name of the AdGuard Home instance */
  instance: string;
  /** Device name, or its IP address when AdGuard Home has no name for it */
  client: string;
  domain: string;
  qtype: string;
  cls: QueryClass;
  dest?: Destination;
}

export interface InstanceStatus {
  name: string;
  state: 'connecting' | 'ok' | 'error';
  message?: string;
  lastOk?: number;
}

export interface ServerStatus {
  instances: InstanceStatus[];
  /** false when no GeoIP database could be opened: nothing can be located */
  geoip: boolean;
}

export interface SnapshotMessage {
  /** Server clock, so a browser with a wrong clock still windows correctly */
  now: number;
  events: AtlasEvent[];
  status: ServerStatus;
}

/** Injected into index.html by the server (or at build time for the static demo). */
export interface ClientConfig {
  mode: 'live' | 'demo';
  home: { lat: number; lon: number; label: string };
  windowMinutes: number;
  privacyForced: boolean;
  version: string;
}

/** Where the demo's invented household lives when nothing else is configured. */
export const DEMO_HOME = { lat: 48.21, lon: 16.37 };

export const DEFAULT_WINDOW_MINUTES = 15;

/** The configuration baked into the static demo build. */
export const STATIC_DEMO_CONFIG: ClientConfig = {
  mode: 'demo',
  home: { ...DEMO_HOME, label: 'Home' },
  windowMinutes: DEFAULT_WINDOW_MINUTES,
  privacyForced: false,
  version: APP_VERSION,
};
