import { useEffect, useRef, useState } from 'react';
import { QUERY_CLASSES, REPO_URL, type ClientConfig } from '../../shared/types';
import type { AtlasStore, Snapshot } from '../store';
import { CLASS_HINT, CLASS_LABEL, ClassGlyph, fmtCompact, fmtShare, Icon, Logo } from './bits';

interface ChromeProps {
  store: AtlasStore;
  snap: Snapshot;
  config: ClientConfig;
}

/** U9: what is wrong, in words. A blank map must never be the only symptom. */
export function problems(snap: Snapshot, config: ClientConfig): string[] {
  if (config.mode === 'demo') return [];
  const out: string[] = [];
  if (snap.connection === 'lost') out.push('Connection to the Atlas server lost — reconnecting…');
  for (const i of snap.status?.instances ?? []) {
    if (i.state === 'error') out.push(`${i.name}: ${i.message ?? 'not reachable'}`);
  }
  if (snap.status && !snap.status.geoip) {
    out.push('No GeoIP database could be opened — queries are counted, but nothing can be placed on the map.');
  }
  return out;
}

function StatusChip({ snap, config }: { snap: Snapshot; config: ClientConfig }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const instances = snap.status?.instances ?? [];
  const down = instances.filter((i) => i.state === 'error').length;
  let tone: 'ok' | 'warn' | 'bad' | 'idle' = 'ok';
  let text: string;
  if (config.mode === 'demo') {
    text = 'Demo';
  } else if (snap.connection === 'lost') {
    tone = 'bad';
    text = 'Reconnecting';
  } else if (!snap.ready) {
    tone = 'idle';
    text = 'Connecting';
  } else if (down > 0) {
    tone = down === instances.length ? 'bad' : 'warn';
    text = down === instances.length && down === 1 ? 'Instance down' : `${down} of ${instances.length} down`;
  } else if (instances.some((i) => i.state === 'connecting')) {
    tone = 'idle';
    text = 'Connecting';
  } else {
    text = instances.length > 1 ? `Live · ${instances.length} instances` : 'Live';
  }

  return (
    <div className="status" ref={ref}>
      <button type="button" className={`chip chip-${tone}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="chip-dot" />
        {text}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Sources">
          <h3 className="eyebrow">{config.mode === 'demo' ? 'Synthetic sources' : 'AdGuard Home'}</h3>
          <ul className="sources">
            {instances.map((i) => (
              <li key={i.name} data-state={i.state}>
                <span className="chip-dot" />
                <span className="source-name">{i.name}</span>
                <span className="source-state">
                  {i.state === 'ok' ? 'polling' : i.state === 'connecting' ? 'connecting…' : (i.message ?? 'error')}
                </span>
              </li>
            ))}
            {instances.length === 0 && <li className="empty">No status yet</li>}
          </ul>
          {config.mode === 'live' && snap.status && !snap.status.geoip && (
            <p className="popover-note">No GeoIP database: nothing can be located.</p>
          )}
          {config.mode === 'demo' && (
            <p className="popover-note">Generated in this browser tab. Nothing is fetched from anywhere.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  store,
  snap,
  config,
  onKiosk,
}: ChromeProps & { onKiosk: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="brand-name">
          AdGuard <b>Atlas</b>
        </span>
      </div>
      <StatusChip snap={snap} config={config} />
      {config.mode === 'demo' && (
        <p className="demo-pill">
          <strong>Synthetic demo</strong>
          <span className="demo-long"> — every device, domain and query here is made up.</span>{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            Get the real thing
          </a>
        </p>
      )}
      <div className="controls">
        <button
          type="button"
          className="icon-button"
          aria-pressed={snap.paused}
          onClick={() => store.setPaused(!snap.paused)}
          title={snap.paused ? 'Resume the animation (Space)' : 'Pause the animation (Space)'}
          aria-label={snap.paused ? 'Resume the animation' : 'Pause the animation'}
        >
          <Icon name={snap.paused ? 'play' : 'pause'} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={snap.privacy}
          disabled={config.privacyForced}
          onClick={() => store.setPrivacy(!snap.privacy)}
          title={
            config.privacyForced
              ? 'Privacy mode is forced by the server configuration'
              : snap.privacy
                ? 'Show device names and domains (P)'
                : 'Hide device names and domains (P)'
          }
          aria-label="Privacy mode"
        >
          <Icon name={config.privacyForced ? 'lock' : snap.privacy ? 'eye-off' : 'eye'} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => store.setTheme(snap.theme === 'dark' ? 'light' : 'dark')}
          title={snap.theme === 'dark' ? 'Light theme (T)' : 'Dark theme (T)'}
          aria-label="Switch theme"
        >
          <Icon name={snap.theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="icon-button" onClick={onKiosk} title="Kiosk mode: map only (K)" aria-label="Kiosk mode">
          <Icon name="expand" />
        </button>
      </div>
    </header>
  );
}

export function Notices({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="notices" role="status">
      {items.map((text) => (
        <p key={text} className="notice">
          <span className="notice-mark" aria-hidden />
          {text}
        </p>
      ))}
    </div>
  );
}

function AllowedGlyph() {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" className="glyph-allowed" aria-hidden>
      <path d="M2 10C8 1 18 1 24 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="24" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * With a store, every entry toggles its class (F16), in step with the class rows in
 * the counters. Without one it is a caption, as in kiosk mode (F18).
 */
export function Legend({ store, snap }: { store?: AtlasStore; snap?: Snapshot }) {
  return (
    <ul className="legend">
      {QUERY_CLASSES.map((cls) => {
        const glyph = cls === 'allowed' ? <AllowedGlyph /> : <ClassGlyph cls={cls} />;
        if (!store || !snap) {
          return (
            <li key={cls}>
              {glyph}
              {CLASS_LABEL[cls]}
            </li>
          );
        }
        const shown = snap.filters.classes[cls];
        return (
          <li key={cls}>
            <button
              type="button"
              aria-pressed={shown}
              onClick={() => store.toggleClass(cls)}
              title={`${CLASS_HINT[cls]}. Click to ${shown ? 'hide' : 'show'}.`}
            >
              {glyph}
              {CLASS_LABEL[cls]}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Footer({ store, snap, config }: ChromeProps) {
  return (
    <footer className="foot">
      <Legend store={store} snap={snap} />
      <p className="caveat">
        Shows what devices <em>asked for</em> — not where their traffic went.
      </p>
      <p className="credits">
        {config.mode === 'live' && (
          <>
            <a href="https://db-ip.com" target="_blank" rel="noreferrer noopener">
              IP geolocation by DB-IP
            </a>
            <span aria-hidden> · </span>
          </>
        )}
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
          AdGuard Atlas {config.version}
        </a>
      </p>
    </footer>
  );
}

/** F18: what is left on a wall display — a caption, never a control. */
export function KioskCaption({ snap, config }: { snap: Snapshot; config: ClientConfig }) {
  const { view } = snap;
  return (
    <div className="kiosk-caption" aria-hidden>
      <div className="kiosk-brand">
        <Logo size={22} />
        <span className="brand-name">
          AdGuard <b>Atlas</b>
        </span>
        {config.mode === 'demo' && <span className="kiosk-demo">synthetic demo</span>}
      </div>
      <dl className="kiosk-stats">
        <div>
          <dt>queries · {config.windowMinutes} min</dt>
          <dd>{fmtCompact(view.total)}</dd>
        </div>
        <div className="kiosk-blocked">
          <dt>blocked</dt>
          <dd>{fmtShare(view.blockedShare)}</dd>
        </div>
        <div>
          <dt>countries</dt>
          <dd>{view.countries}</dd>
        </div>
      </dl>
      <Legend />
    </div>
  );
}
