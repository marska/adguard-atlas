import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { ClientConfig } from '../shared/types';
import { Footer, KioskCaption, Notices, problems, TopBar } from './components/Chrome';
import { Icon } from './components/bits';
import { SidePanel, StatsPanel } from './components/Panels';
import { remember, type UrlOptions } from './config';
import type { Padding } from './map/AtlasMap';
import { MapView } from './MapView';
import type { AtlasStore } from './store';

const WIDE = '(min-width: 1180px)';

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

const PADDING: Record<'wide' | 'narrow' | 'kiosk' | 'bare', Padding> = {
  // On a wide screen the panels float over the map, so the world is fitted between them.
  wide: { top: 86, right: 400, bottom: 70, left: 356 },
  narrow: { top: 14, right: 12, bottom: 14, left: 12 },
  kiosk: { top: 36, right: 36, bottom: 92, left: 36 },
  bare: { top: 24, right: 24, bottom: 24, left: 24 },
};

interface Props {
  store: AtlasStore;
  config: ClientConfig;
  initialUrl: UrlOptions;
}

export function App({ store, config, initialUrl }: Props) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const wide = useMedia(WIDE);
  const [kiosk, setKiosk] = useState(initialUrl.kiosk);
  const [tab, setTab] = useState<'feed' | 'stats'>('feed');
  const bare = kiosk && initialUrl.bare;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = snap.theme;
    remember('theme', snap.theme);
  }, [snap.theme]);

  useEffect(() => {
    if (!config.privacyForced) remember('privacy', snap.privacy ? 'on' : 'off');
  }, [snap.privacy, config.privacyForced]);

  const toggleKiosk = useCallback((next: boolean) => {
    setKiosk(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('kiosk', '');
    else url.searchParams.delete('kiosk');
    window.history.replaceState(null, '', url.pathname + url.search.replace(/=(?=&|$)/g, '') + url.hash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      const s = store.getSnapshot();
      switch (e.key.toLowerCase()) {
        case ' ':
          if (target?.tagName === 'BUTTON') return;
          e.preventDefault();
          store.setPaused(!s.paused);
          break;
        case 'p':
          if (!config.privacyForced) store.setPrivacy(!s.privacy);
          break;
        case 't':
          store.setTheme(s.theme === 'dark' ? 'light' : 'dark');
          break;
        case 'k':
          toggleKiosk(!kiosk);
          break;
        case 'escape':
          if (s.selection) store.select(null);
          else if (kiosk) toggleKiosk(false);
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, config.privacyForced, kiosk, toggleKiosk]);

  // On a narrow screen a selection is only visible on the feed tab.
  const hasDetail = snap.view.detail !== null;
  useEffect(() => {
    if (hasDetail) setTab('feed');
  }, [hasDetail]);

  const padding = bare ? PADDING.bare : kiosk ? PADDING.kiosk : wide ? PADDING.wide : PADDING.narrow;
  const labels = kiosk ? 12 : wide ? 8 : 4;
  const panel = { store, snap, windowMinutes: config.windowMinutes, privacyForced: config.privacyForced };
  const issues = problems(snap, config);

  return (
    <div className="app" data-kiosk={kiosk} data-tab={tab} data-mode={config.mode}>
      <MapView
        store={store}
        config={config}
        padding={padding}
        places={snap.view.places}
        selection={snap.selection}
        paused={snap.paused}
        theme={snap.theme}
        labels={labels}
      />
      <div className="vignette" aria-hidden />
      {kiosk ? (
        <>
          {!bare && <KioskCaption snap={snap} config={config} />}
          {bare && config.mode === 'demo' && <p className="kiosk-demo kiosk-demo-bare">synthetic demo</p>}
          <button type="button" className="kiosk-exit" onClick={() => toggleKiosk(false)} title="Leave kiosk mode (Esc)">
            <Icon name="close" size={14} /> Exit kiosk
          </button>
        </>
      ) : (
        <>
          <TopBar store={store} snap={snap} config={config} onKiosk={() => toggleKiosk(true)} />
          <nav className="tabs" aria-label="Panels">
            <button type="button" aria-pressed={tab === 'feed'} onClick={() => setTab('feed')}>
              Feed
            </button>
            <button type="button" aria-pressed={tab === 'stats'} onClick={() => setTab('stats')}>
              Counters
            </button>
          </nav>
          <StatsPanel {...panel} />
          <SidePanel {...panel} />
          <Footer store={store} snap={snap} config={config} />
        </>
      )}
      <Notices items={issues} />
      {snap.paused && !kiosk && <p className="paused-flag">Animation paused</p>}
    </div>
  );
}
