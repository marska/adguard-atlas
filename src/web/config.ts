import { STATIC_DEMO_CONFIG, type ClientConfig } from '../shared/types';

/**
 * The server writes the configuration into a meta tag of index.html (the static
 * demo has it baked in at build time), so the page needs no request to find out
 * which mode it is in.
 */
export function readConfig(): ClientConfig {
  const raw = document.querySelector('meta[name="atlas-config"]')?.getAttribute('content');
  if (raw && raw.startsWith('{')) {
    try {
      return JSON.parse(raw) as ClientConfig;
    } catch {
      // fall through to the demo
    }
  }
  return STATIC_DEMO_CONFIG;
}

export interface UrlOptions {
  kiosk: boolean;
  /** `?kiosk=bare`: not even the caption. */
  bare: boolean;
  theme: 'dark' | 'light' | null;
  privacy: boolean;
}

export function readUrl(search = window.location.search): UrlOptions {
  const params = new URLSearchParams(search);
  const kiosk = params.get('kiosk');
  const theme = params.get('theme');
  const privacy = params.get('privacy');
  return {
    kiosk: kiosk !== null && kiosk !== '0' && kiosk !== 'false',
    bare: kiosk === 'bare',
    theme: theme === 'dark' || theme === 'light' ? theme : null,
    privacy: privacy !== null && privacy !== '0' && privacy !== 'false',
  };
}

export function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(`atlas.${key}`, value);
  } catch {
    // storage may be unavailable (private mode, kiosk profiles); the setting just does not stick
  }
}

export function recall(key: string): string | null {
  try {
    return window.localStorage.getItem(`atlas.${key}`);
  } catch {
    return null;
  }
}
