import type { CSSProperties, ReactNode } from 'react';
import type { AtlasEvent, QueryClass } from '../../shared/types';

export const CLASS_LABEL: Record<QueryClass, string> = {
  allowed: 'Allowed',
  blocked: 'Blocked',
  local: 'Local',
  noanswer: 'No answer',
};

export const CLASS_HINT: Record<QueryClass, string> = {
  allowed: 'Answered with a public address — drawn as an arc',
  blocked: 'Filtered by AdGuard Home — a pulse at home',
  local: 'Answered with a private address — stays in the house',
  noanswer: 'NXDOMAIN, SERVFAIL or an answer without an address',
};

const number = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const fmt = (n: number) => number.format(n);
export const fmtCompact = (n: number) => (n < 10_000 ? number.format(n) : compact.format(n));
export const fmtTime = (t: number) => clock.format(t);
export const fmtShare = (share: number) =>
  share === 0 ? '0%' : share < 0.1 ? `${(share * 100).toFixed(1)}%` : `${Math.round(share * 100)}%`;

/** Colour is never the only signal: every class also has its own shape. */
export function ClassGlyph({ cls, size = 12 }: { cls: QueryClass; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 12 12', className: `glyph glyph-${cls}`, 'aria-hidden': true };
  switch (cls) {
    case 'allowed':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="3.2" fill="currentColor" />
          <circle cx="6" cy="6" r="5.2" fill="none" stroke="currentColor" strokeOpacity="0.35" />
        </svg>
      );
    case 'blocked':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.9 9.1 9.1 2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'local':
      return (
        <svg {...common}>
          <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="4.8" y="4.8" width="2.4" height="2.4" rx="0.6" fill="currentColor" />
        </svg>
      );
    case 'noanswer':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.4" />
        </svg>
      );
  }
}

/** F19: a redaction bar. The text itself is never put in the document. */
export function Redacted({ seed }: { seed: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const style = { '--w': `${9 + (h % 13)}ch` } as CSSProperties;
  return <span className="redacted" style={style} role="img" aria-label="hidden" />;
}

/** A domain as the server sent it, or a bar when masking is on (or was forced upstream). */
export function Domain({ value, privacy }: { value: string; privacy: boolean }) {
  if (privacy || value.startsWith('~')) return <Redacted seed={value} />;
  return <>{value}</>;
}

export function whereOf(e: AtlasEvent): string {
  switch (e.cls) {
    case 'blocked':
      return 'blocked';
    case 'local':
      return 'local network';
    case 'noanswer':
      return 'no answer';
    case 'allowed':
      if (!e.dest) return 'not located';
      return [e.dest.city, e.dest.cc ?? e.dest.country].filter(Boolean).join(', ') || 'somewhere';
  }
}

type IconName = 'pause' | 'play' | 'eye' | 'eye-off' | 'sun' | 'moon' | 'expand' | 'close' | 'search' | 'lock';

const ICONS: Record<IconName, ReactNode> = {
  pause: <path d="M7 5v14M17 5v14" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.4 17.4 0 0 1-3.2 4M6.5 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.3" />
      <ellipse cx="16" cy="16" rx="5" ry="11.5" fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.1" />
      <path d="M4.5 16h23" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.1" />
      <path className="logo-arc" d="M8 21.5C10.5 9.5 20 6.5 25 12" fill="none" strokeWidth="2.1" strokeLinecap="round" />
      <circle className="logo-home" cx="8" cy="21.5" r="2.5" />
      <circle className="logo-dest" cx="25" cy="12" r="2.5" />
    </svg>
  );
}
