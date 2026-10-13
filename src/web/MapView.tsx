import { useEffect, useRef } from 'react';
import type { ClientConfig } from '../shared/types';
import { AtlasMap, type Padding } from './map/AtlasMap';
import type { AtlasStore, Place, Selection, Theme } from './store';

interface Props {
  store: AtlasStore;
  config: ClientConfig;
  padding: Padding;
  places: Place[];
  selection: Selection;
  paused: boolean;
  theme: Theme;
  labels: number;
}

/** The thin React shell around the canvas map: it only forwards state. */
export function MapView({ store, config, padding, places, selection, paused, theme, labels }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AtlasMap | null>(null);

  useEffect(() => {
    const instance = new AtlasMap(container.current!, {
      home: config.home,
      onSelect: (s) => store.select(s),
    });
    map.current = instance;
    const stop = store.onLive((e) => instance.push(e));
    return () => {
      stop();
      instance.destroy();
      map.current = null;
    };
  }, [store, config]);

  const { top, right, bottom, left } = padding;
  useEffect(() => map.current?.setPadding({ top, right, bottom, left }), [top, right, bottom, left]);
  useEffect(() => map.current?.setPlaces(places), [places]);
  useEffect(() => map.current?.setSelection(selection), [selection]);
  useEffect(() => map.current?.setPaused(paused), [paused]);
  useEffect(() => map.current?.setLabels(labels > 0, labels), [labels]);
  // The palette lives in CSS; the root's data-theme is set in a layout effect, before this runs.
  useEffect(() => map.current?.readTheme(), [theme]);

  return <div className="map" ref={container} role="img" aria-label="World map of DNS queries" />;
}
