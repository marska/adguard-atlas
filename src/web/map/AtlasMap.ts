import { geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
import type { AtlasEvent, Destination } from '../../shared/types';
import { placeKey, type Place, type Selection } from '../store';
import { countryAt, worldGeometry, type Country } from './geometry';
import { ArcScheduler } from './scheduler';

/**
 * The map (F10, F11, F17, F20, F22). Two stacked canvases: a base layer with the
 * world, redrawn only when the projection or the theme changes, and an effects
 * layer redrawn every frame with markers, arcs and pulses. It is plain canvas code
 * on purpose — React never sees an individual query.
 */

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapOptions {
  home: { lat: number; lon: number; label: string };
  onSelect: (selection: Selection) => void;
}

type RGB = [number, number, number];

interface Palette {
  land: string;
  landEdge: string;
  dot: string;
  coast: string;
  border: string;
  graticule: string;
  label: string;
  halo: string;
  allowed: RGB;
  blocked: RGB;
  local: RGB;
  noanswer: RGB;
  home: RGB;
  select: RGB;
  additive: boolean;
}

interface Arc {
  key: string;
  lon: number;
  lat: number;
  count: number;
  start: number;
  duration: number;
  /** Per-arc variation of the curve, so repeated arcs fan out instead of overprinting. */
  lift: number;
  points: Float32Array | null;
  version: number;
  landed: boolean;
}

interface Ring {
  kind: 'arrive' | 'blocked' | 'local' | 'noanswer';
  /** Rings are anchored geographically, so they follow the map when it moves. */
  lon: number;
  lat: number;
  start: number;
  duration: number;
  from: number;
  to: number;
  strength: number;
}

const ARC_SAMPLES = 44;
const MAX_ARCS = 140;
const MAX_MARKERS = 320;
const AFTERGLOW_MS = 950;
const MAX_FX_PIXELS = 2_600_000;
const TAIL_LAG = 0.42;

/** Extreme points of the part of the world worth showing; the projection is fitted to these. */
const FIT_OUTLINE = {
  type: 'MultiPoint' as const,
  coordinates: [
    [-180, 0],
    [180, 0],
    [0, 83],
    [0, -57],
    [-180, 83],
    [180, 83],
    [-180, -57],
    [180, -57],
  ],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function parseColor(value: string, fallback: RGB): RGB {
  const hex = value.trim().replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return fallback;
}

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function glowSprite(color: RGB): HTMLCanvasElement {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(color, 0.9));
  g.addColorStop(0.18, rgba(color, 0.42));
  g.addColorStop(0.5, rgba(color, 0.1));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export class AtlasMap {
  private readonly base: HTMLCanvasElement;
  private readonly fx: HTMLCanvasElement;
  private readonly tooltip: HTMLDivElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly fxCtx: CanvasRenderingContext2D;
  private readonly world = worldGeometry();
  private readonly projection: GeoProjection = geoNaturalEarth1();
  private readonly resizeObserver: ResizeObserver;
  private readonly scheduler = new ArcScheduler<Destination>();

  private width = 0;
  private height = 0;
  private dpr = 1;
  private fxDpr = 1;
  private padding: Padding = { top: 16, right: 16, bottom: 16, left: 16 };
  private fitScale = 1;
  private fitTranslate: [number, number] = [0, 0];
  private zoom = { k: 1, x: 0, y: 0 };
  private version = 0;
  private baseDirty = true;

  private palette!: Palette;
  private sprites!: { allowed: HTMLCanvasElement; home: HTMLCanvasElement };
  private font = 'sans-serif';
  private monoFont = 'monospace';

  private places: Place[] = [];
  private maxCount = 1;
  private placeCountry = new Map<string, string | null>();
  private countryCc = new Map<string, string>();
  private ccCountry = new Map<string, string>();
  private countryPaths = new Map<string, { version: number; path: Path2D }>();
  private hits = new Map<string, number>();

  private arcs: Arc[] = [];
  private rings: Ring[] = [];
  private pendingHome = { blocked: 0, local: 0, noanswer: 0 };
  private lastHomeRing = { blocked: -1e9, local: -1e9, noanswer: -1e9 };

  private selection: Selection = null;
  private hoverPlace: Place | null = null;
  private hoverCountry: Country | null = null;
  private pointer: { x: number; y: number } | null = null;
  private pointerDirty = false;
  private showLabels = true;
  private labelCount = 7;

  private paused = false;
  private clock = 0;
  private lastFrame = 0;
  private lastHover = 0;
  private raf = 0;
  private destroyed = false;

  // pointer gesture state
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinchStart: { distance: number; k: number } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: MapOptions,
  ) {
    this.base = document.createElement('canvas');
    this.base.className = 'map-layer';
    this.fx = document.createElement('canvas');
    this.fx.className = 'map-layer map-fx';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'map-tooltip';
    container.append(this.base, this.fx, this.tooltip);
    this.baseCtx = this.base.getContext('2d')!;
    this.fxCtx = this.fx.getContext('2d')!;

    this.readTheme();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.fx.addEventListener('pointerdown', this.onPointerDown);
    this.fx.addEventListener('pointermove', this.onPointerMove);
    this.fx.addEventListener('pointerup', this.onPointerUp);
    this.fx.addEventListener('pointercancel', this.onPointerUp);
    this.fx.addEventListener('pointerleave', this.onPointerLeave);
    this.fx.addEventListener('wheel', this.onWheel, { passive: false });
    this.fx.addEventListener('dblclick', this.onDoubleClick);

    // The bundled fonts load after first paint; labels are redrawn every frame anyway.
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.base.remove();
    this.fx.remove();
    this.tooltip.remove();
  }

  // --- inputs from the application ------------------------------------------

  /** Re-read the colours from CSS: the stylesheet is the single source of the palette. */
  readTheme(): void {
    const css = getComputedStyle(this.container);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const allowed = parseColor(v('--c-allowed'), [80, 230, 210]);
    const home = parseColor(v('--map-home'), [255, 255, 255]);
    this.palette = {
      land: v('--map-land') || '#101b2d',
      landEdge: v('--map-land-edge') || '#0c1524',
      dot: v('--map-dot') || '#22395a',
      coast: v('--map-coast') || '#2b4a72',
      border: v('--map-border') || '#1a2c47',
      graticule: v('--map-graticule') || '#0e1726',
      label: v('--map-label') || '#9fb4d0',
      halo: v('--map-halo') || '#060a12',
      allowed,
      blocked: parseColor(v('--c-blocked'), [255, 93, 115]),
      local: parseColor(v('--c-local'), [157, 140, 255]),
      noanswer: parseColor(v('--c-noanswer'), [245, 184, 92]),
      home,
      select: parseColor(v('--map-select'), [255, 255, 255]),
      additive: v('--map-blend') !== 'normal',
    };
    this.sprites = { allowed: glowSprite(allowed), home: glowSprite(home) };
    this.font = v('--font-ui') || 'sans-serif';
    this.monoFont = v('--font-mono') || 'monospace';
    this.baseDirty = true;
  }

  setPadding(padding: Padding): void {
    const p = this.padding;
    if (p.top === padding.top && p.right === padding.right && p.bottom === padding.bottom && p.left === padding.left) {
      return;
    }
    this.padding = padding;
    this.fit();
  }

  setLabels(show: boolean, count: number): void {
    this.showLabels = show;
    this.labelCount = count;
  }

  setPlaces(places: Place[]): void {
    this.places = places.length > MAX_MARKERS ? places.slice(0, MAX_MARKERS) : places;
    this.maxCount = Math.max(12, places[0]?.count ?? 1);
    for (const p of this.places) {
      if (this.placeCountry.has(p.key)) continue;
      const country = countryAt(p.lon, p.lat);
      this.placeCountry.set(p.key, country?.id ?? null);
      if (country && p.cc) {
        if (!this.countryCc.has(country.id)) this.countryCc.set(country.id, p.cc);
        if (!this.ccCountry.has(p.cc)) this.ccCountry.set(p.cc, country.id);
      }
    }
    if (this.hoverPlace) {
      this.hoverPlace = this.places.find((p) => p.key === this.hoverPlace!.key) ?? null;
      this.pointerDirty = true;
    }
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.scheduler.clear();
      this.pendingHome = { blocked: 0, local: 0, noanswer: 0 };
    }
  }

  /** A live query. While paused nothing is queued: the animation resumes from "now". */
  push(event: AtlasEvent): void {
    if (this.paused || document.hidden) return;
    if (event.cls === 'allowed') {
      if (event.dest) this.scheduler.push(placeKey(event.dest), event.dest, this.clock);
    } else {
      this.pendingHome[event.cls]++;
    }
  }

  // --- projection -----------------------------------------------------------

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    // The effects layer is cleared and redrawn every frame, so its pixel count is
    // capped: on a 4K wall display the glows lose nothing, the frame rate gains a lot.
    this.fxDpr = Math.min(dpr, Math.max(1, Math.sqrt(MAX_FX_PIXELS / (width * height))));
    this.base.width = Math.round(width * dpr);
    this.base.height = Math.round(height * dpr);
    this.fx.width = Math.round(width * this.fxDpr);
    this.fx.height = Math.round(height * this.fxDpr);
    this.fit();
  }

  private fit(): void {
    const { top, right, bottom, left } = this.padding;
    const x0 = left;
    const y0 = top;
    const x1 = Math.max(x0 + 80, this.width - right);
    const y1 = Math.max(y0 + 60, this.height - bottom);
    this.projection.scale(1).translate([0, 0]);
    this.projection.fitExtent(
      [
        [x0, y0],
        [x1, y1],
      ],
      FIT_OUTLINE,
    );
    this.fitScale = this.projection.scale();
    this.fitTranslate = this.projection.translate();
    this.applyZoom();
  }

  private applyZoom(): void {
    const z = this.zoom;
    z.k = clamp(z.k, 1, 9);
    if (z.k === 1) {
      z.x = 0;
      z.y = 0;
    } else {
      z.x = clamp(z.x, this.width * (1 - z.k), 0);
      z.y = clamp(z.y, this.height * (1 - z.k), 0);
    }
    this.projection
      .scale(this.fitScale * z.k)
      .translate([this.fitTranslate[0] * z.k + z.x, this.fitTranslate[1] * z.k + z.y]);
    this.version++;
    this.baseDirty = true;
    this.pointerDirty = true;
  }

  private zoomAt(x: number, y: number, k: number): void {
    const z = this.zoom;
    const next = clamp(k, 1, 9);
    const ratio = next / z.k;
    z.x = x - (x - z.x) * ratio;
    z.y = y - (y - z.y) * ratio;
    z.k = next;
    this.applyZoom();
  }

  private project(lon: number, lat: number): [number, number] {
    return this.projection([lon, lat]) ?? [-9999, -9999];
  }

  // --- pointer --------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.fx.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.fx.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    this.dragMoved = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: this.zoom.k };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const previous = this.pointers.get(e.pointerId);
    if (previous) {
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.dragMoved += 10;
        this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, (this.pinchStart.k * distance) / this.pinchStart.distance);
      } else if (this.pointers.size === 1) {
        const dx = p.x - previous.x;
        const dy = p.y - previous.y;
        this.dragMoved += Math.abs(dx) + Math.abs(dy);
        if (this.zoom.k > 1 && this.dragMoved > 4) {
          this.zoom.x += dx;
          this.zoom.y += dy;
          this.applyZoom();
        }
      }
    }
    if (e.pointerType !== 'touch') {
      this.pointer = p;
      this.pointerDirty = true;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasGesture = this.pointers.size > 1;
    const tracked = this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (!tracked || e.type === 'pointercancel' || wasGesture || this.dragMoved > 6) return;
    this.click(this.local(e));
  };

  private onPointerLeave = (): void => {
    this.pointer = null;
    this.pointerDirty = true;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomAt(p.x, p.y, this.zoom.k * Math.exp(-delta * 0.0016));
  };

  private onDoubleClick = (): void => {
    this.zoom = { k: 1, x: 0, y: 0 };
    this.applyZoom();
  };

  private markerRadius(count: number): number {
    const zoomBoost = Math.pow(this.zoom.k, 0.3);
    return (2.6 + 15 * Math.sqrt(Math.min(1, count / this.maxCount))) * zoomBoost;
  }

  private placeAt(x: number, y: number, slack: number): Place | null {
    let best: Place | null = null;
    let bestDistance = Infinity;
    for (const place of this.places) {
      const [px, py] = this.project(place.lon, place.lat);
      const d = Math.hypot(px - x, py - y);
      if (d <= this.markerRadius(place.count) + slack && d < bestDistance) {
        best = place;
        bestDistance = d;
      }
    }
    return best;
  }

  private countryAtPoint(x: number, y: number): Country | null {
    const geo = this.projection.invert?.([x, y]);
    if (!geo || !Number.isFinite(geo[0]) || !Number.isFinite(geo[1])) return null;
    return countryAt(geo[0], geo[1]) ?? null;
  }

  private click(p: { x: number; y: number }): void {
    const place = this.placeAt(p.x, p.y, 8);
    if (place) {
      this.options.onSelect({ kind: 'place', key: place.key });
      return;
    }
    const country = this.countryAtPoint(p.x, p.y);
    if (country) {
      this.options.onSelect({
        kind: 'country',
        cc: this.countryCc.get(country.id) ?? '',
        name: country.name,
        featureId: country.id,
      });
      return;
    }
    this.options.onSelect(null);
  }

  private updateHover(): void {
    this.pointerDirty = false;
    const p = this.pointer;
    const dragging = this.pointers.size > 0 && this.dragMoved > 4;
    if (!p || dragging) {
      this.hoverPlace = null;
      this.hoverCountry = null;
      this.tooltip.dataset.show = 'false';
      this.fx.style.cursor = dragging ? 'grabbing' : '';
      return;
    }
    this.hoverPlace = this.placeAt(p.x, p.y, 5);
    this.hoverCountry = this.hoverPlace ? null : this.countryAtPoint(p.x, p.y);
    this.fx.style.cursor = this.hoverPlace || this.hoverCountry ? 'pointer' : this.zoom.k > 1 ? 'grab' : '';

    let title = '';
    let meta = '';
    if (this.hoverPlace) {
      const h = this.hoverPlace;
      title = h.city ?? h.country ?? 'Unknown place';
      const n = h.count.toLocaleString('en-US');
      meta = `${h.city && h.country ? h.country + ' · ' : ''}${n} ${h.count === 1 ? 'query' : 'queries'}`;
    } else if (this.hoverCountry) {
      title = this.hoverCountry.name;
    }
    if (!title) {
      this.tooltip.dataset.show = 'false';
      return;
    }
    this.tooltip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = title;
    this.tooltip.append(strong);
    if (meta) {
      const span = document.createElement('span');
      span.textContent = meta;
      this.tooltip.append(span);
    }
    const flip = p.x > this.width - 200;
    this.tooltip.dataset.show = 'true';
    this.tooltip.dataset.flip = String(flip);
    this.tooltip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }

  // --- base layer -----------------------------------------------------------

  private drawBase(): void {
    this.baseDirty = false;
    const ctx = this.baseCtx;
    const { width, height, dpr, palette } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const path = geoPath(this.projection, ctx);

    ctx.lineWidth = 0.6;
    ctx.strokeStyle = palette.graticule;
    ctx.beginPath();
    path(this.world.graticule);
    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette.land);
    gradient.addColorStop(1, palette.landEdge);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    path(this.world.land);
    ctx.fill();

    this.drawDots(ctx);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = palette.border;
    ctx.beginPath();
    path(this.world.borders);
    ctx.stroke();

    ctx.lineWidth = 0.9;
    ctx.strokeStyle = palette.coast;
    ctx.beginPath();
    path(this.world.land);
    ctx.stroke();
  }

  /**
   * A halftone of dots over the land. The land is rasterised into a tiny canvas
   * with one pixel per dot cell; every covered pixel becomes a dot.
   */
  private drawDots(ctx: CanvasRenderingContext2D): void {
    const step = this.width < 700 ? 5 : 6.5;
    const offsetX = ((this.zoom.x % step) + step) % step;
    const offsetY = ((this.zoom.y % step) + step) % step;
    const cols = Math.ceil(this.width / step) + 1;
    const rows = Math.ceil(this.height / step) + 1;
    const mask = document.createElement('canvas');
    mask.width = cols;
    mask.height = rows;
    const mctx = mask.getContext('2d', { willReadFrequently: true })!;
    mctx.scale(1 / step, 1 / step);
    mctx.translate(-offsetX + step / 2, -offsetY + step / 2);
    mctx.fillStyle = '#000';
    mctx.beginPath();
    geoPath(this.projection, mctx)(this.world.land);
    mctx.fill();
    const data = mctx.getImageData(0, 0, cols, rows).data;

    ctx.fillStyle = this.palette.dot;
    const r = step * 0.17;
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (data[(row * cols + col) * 4 + 3]! < 150) continue;
        const x = col * step + offsetX - step / 2;
        const y = row * step + offsetY - step / 2;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  // --- effects layer --------------------------------------------------------

  private frame = (timestamp: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(100, timestamp - this.lastFrame) : 16;
    this.lastFrame = timestamp;
    if (!this.paused) this.clock += dt;

    if (this.baseDirty) this.drawBase();
    if (this.pointerDirty && timestamp - this.lastHover > 80) {
      this.lastHover = timestamp;
      this.updateHover();
    }
    if (!this.paused) this.spawn();
    this.drawEffects();
  };

  private spawn(): void {
    const now = this.clock;
    const { released, expired } = this.scheduler.take(now);
    const [hx, hy] = this.project(this.options.home.lon, this.options.home.lat);
    for (const item of released) {
      const [x, y] = this.project(item.payload.lon, item.payload.lat);
      const distance = Math.hypot(x - hx, y - hy);
      this.arcs.push({
        key: item.key,
        lon: item.payload.lon,
        lat: item.payload.lat,
        count: item.count,
        start: now,
        duration: clamp(620 + distance * 1.5, 700, 1900),
        lift: 0.8 + Math.random() * 0.5,
        points: null,
        version: -1,
        landed: false,
      });
    }
    // Too many to draw: these only make their marker flash (F22).
    for (const item of expired) this.hits.set(item.key, now);
    if (this.arcs.length > MAX_ARCS) this.arcs.splice(0, this.arcs.length - MAX_ARCS);

    const home = this.options.home;
    const ring = (kind: 'blocked' | 'local' | 'noanswer', gap: number, duration: number, reach: number) => {
      const n = this.pendingHome[kind];
      if (n === 0 || now - this.lastHomeRing[kind] < gap) return;
      this.pendingHome[kind] = 0;
      this.lastHomeRing[kind] = now;
      const strength = Math.min(1, 0.45 + Math.log2(1 + n) * 0.2);
      this.rings.push({
        kind,
        lon: home.lon,
        lat: home.lat,
        start: now,
        duration,
        from: 5,
        to: reach * (0.75 + strength * 0.5),
        strength,
      });
    };
    ring('blocked', 240, 1100, 34);
    ring('local', 420, 900, 17);
    ring('noanswer', 420, 1300, 25);
    if (this.rings.length > 80) this.rings.splice(0, this.rings.length - 80);
  }

  private arcPoints(arc: Arc): Float32Array {
    if (arc.points && arc.version === this.version) return arc.points;
    const [ax, ay] = this.project(this.options.home.lon, this.options.home.lat);
    const [bx, by] = this.project(arc.lon, arc.lat);
    const dx = bx - ax;
    const dy = by - ay;
    const distance = Math.hypot(dx, dy) || 1;
    // Perpendicular to the chord, on whichever side points up the screen.
    let nx = -dy / distance;
    let ny = dx / distance;
    if (ny > 0 || (ny === 0 && nx > 0)) {
      nx = -nx;
      ny = -ny;
    }
    const lift = Math.min(distance * 0.3, 190 * Math.sqrt(this.zoom.k)) * arc.lift;
    const cx = (ax + bx) / 2 + nx * lift;
    const cy = (ay + by) / 2 + ny * lift;
    const points = arc.points ?? new Float32Array((ARC_SAMPLES + 1) * 2);
    for (let i = 0; i <= ARC_SAMPLES; i++) {
      const t = i / ARC_SAMPLES;
      const u = 1 - t;
      points[i * 2] = u * u * ax + 2 * u * t * cx + t * t * bx;
      points[i * 2 + 1] = u * u * ay + 2 * u * t * cy + t * t * by;
    }
    arc.points = points;
    arc.version = this.version;
    return points;
  }

  private static pointOn(points: Float32Array, t: number): [number, number] {
    const f = clamp(t, 0, 1) * ARC_SAMPLES;
    const i = Math.min(ARC_SAMPLES - 1, Math.floor(f));
    const r = f - i;
    return [
      points[i * 2]! + (points[i * 2 + 2]! - points[i * 2]!) * r,
      points[i * 2 + 1]! + (points[i * 2 + 3]! - points[i * 2 + 1]!) * r,
    ];
  }

  private static trace(ctx: CanvasRenderingContext2D, points: Float32Array, t0: number, t1: number): void {
    const [sx, sy] = AtlasMap.pointOn(points, t0);
    const [ex, ey] = AtlasMap.pointOn(points, t1);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    const first = Math.floor(t0 * ARC_SAMPLES) + 1;
    const last = Math.ceil(t1 * ARC_SAMPLES) - 1;
    for (let i = first; i <= last; i++) ctx.lineTo(points[i * 2]!, points[i * 2 + 1]!);
    ctx.lineTo(ex, ey);
  }

  private countryPath(country: Country): Path2D {
    const cached = this.countryPaths.get(country.id);
    if (cached && cached.version === this.version) return cached.path;
    const path = new Path2D(geoPath(this.projection)(country.feature) ?? '');
    this.countryPaths.set(country.id, { version: this.version, path });
    return path;
  }

  private selectedCountry(): Country | undefined {
    const s = this.selection;
    if (s?.kind !== 'country') return undefined;
    const id = s.featureId ?? this.ccCountry.get(s.cc);
    return id ? this.world.byId.get(id) : undefined;
  }

  private drawEffects(): void {
    const ctx = this.fxCtx;
    const { width, height, palette, clock } = this;
    ctx.setTransform(this.fxDpr, 0, 0, this.fxDpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const blend: GlobalCompositeOperation = palette.additive ? 'lighter' : 'source-over';

    // Countries: selection and hover.
    const selected = this.selectedCountry();
    if (selected) {
      const path = this.countryPath(selected);
      ctx.fillStyle = rgba(palette.select, palette.additive ? 0.13 : 0.16);
      ctx.fill(path);
      ctx.strokeStyle = rgba(palette.select, 0.85);
      ctx.lineWidth = 1.2;
      ctx.stroke(path);
    }
    if (this.hoverCountry && this.hoverCountry !== selected) {
      const path = this.countryPath(this.hoverCountry);
      ctx.fillStyle = rgba(palette.select, 0.06);
      ctx.fill(path);
      ctx.strokeStyle = rgba(palette.select, 0.4);
      ctx.lineWidth = 0.9;
      ctx.stroke(path);
    }

    // Markers, smallest last so that big ones do not bury them.
    const selectedPlace = this.selection?.kind === 'place' ? this.selection.key : null;
    const selectedCc = this.selection?.kind === 'country' ? this.selection.cc : null;
    const labels: { x: number; y: number; r: number; text: string }[] = [];
    for (let i = 0; i < this.places.length; i++) {
      const place = this.places[i]!;
      const [x, y] = this.project(place.lon, place.lat);
      if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue;
      const r = this.markerRadius(place.count);
      const hitAt = this.hits.get(place.key);
      const flash = hitAt === undefined ? 0 : Math.max(0, 1 - (clock - hitAt) / 700);
      const isSelected = place.key === selectedPlace || (selectedCc !== null && selectedCc !== '' && place.cc === selectedCc);
      const isHover = this.hoverPlace?.key === place.key;

      ctx.globalCompositeOperation = blend;
      const glow = r * (3.1 + flash * 1.6);
      ctx.globalAlpha = (palette.additive ? 0.5 : 0.34) + flash * 0.4;
      ctx.drawImage(this.sprites.allowed, x - glow, y - glow, glow * 2, glow * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(palette.allowed, 0.13 + flash * 0.2 + (isHover ? 0.12 : 0));
      ctx.fill();
      ctx.lineWidth = isHover || isSelected ? 1.6 : 1;
      ctx.strokeStyle = rgba(palette.allowed, 0.6 + flash * 0.4);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, Math.min(2.1, r * 0.55) + flash * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(palette.allowed, 0.95);
      ctx.fill();

      if (isSelected) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(clock / 2600);
        ctx.beginPath();
        ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = rgba(palette.select, 0.95);
        ctx.stroke();
        ctx.restore();
      }
      if (this.showLabels && i < this.labelCount && place.city) labels.push({ x, y, r, text: place.city });
    }

    // Arcs.
    const keep: Arc[] = [];
    for (const arc of this.arcs) {
      const elapsed = clock - arc.start;
      if (elapsed > arc.duration * (1 + TAIL_LAG) + AFTERGLOW_MS) continue;
      keep.push(arc);
      const points = this.arcPoints(arc);
      const head = easeInOut(clamp(elapsed / arc.duration, 0, 1));
      const tail = easeInOut(clamp((elapsed - arc.duration * TAIL_LAG) / arc.duration, 0, 1));
      const fade = 1 - clamp((elapsed - arc.duration) / AFTERGLOW_MS, 0, 1);
      const weight = 1 + Math.min(arc.count - 1, 8) * 0.22;

      if (!arc.landed && elapsed >= arc.duration) {
        arc.landed = true;
        this.hits.set(arc.key, clock);
        this.rings.push({
          kind: 'arrive',
          lon: arc.lon,
          lat: arc.lat,
          start: clock,
          duration: 800,
          from: 3,
          to: 15 + weight * 4,
          strength: Math.min(1, 0.6 + weight * 0.15),
        });
      }

      ctx.globalCompositeOperation = blend;
      // The wake: the whole path travelled so far, fading once the head has landed.
      if (fade > 0) {
        AtlasMap.trace(ctx, points, 0, head);
        ctx.lineWidth = 0.9 * weight;
        ctx.strokeStyle = rgba(palette.allowed, (palette.additive ? 0.2 : 0.26) * fade * fade);
        ctx.stroke();
      }
      // The comet: a bright stretch between tail and head.
      if (head - tail > 0.004) {
        const [tx, ty] = AtlasMap.pointOn(points, tail);
        const [hx, hy] = AtlasMap.pointOn(points, head);
        const gradient = ctx.createLinearGradient(tx, ty, hx, hy);
        gradient.addColorStop(0, rgba(palette.allowed, 0));
        gradient.addColorStop(1, rgba(palette.allowed, palette.additive ? 0.95 : 1));
        AtlasMap.trace(ctx, points, tail, head);
        if (palette.additive) {
          const halo = ctx.createLinearGradient(tx, ty, hx, hy);
          halo.addColorStop(0, rgba(palette.allowed, 0));
          halo.addColorStop(1, rgba(palette.allowed, 0.2));
          ctx.lineWidth = 5.5 * weight;
          ctx.strokeStyle = halo;
          ctx.stroke();
        }
        ctx.lineWidth = 1.5 * weight;
        ctx.strokeStyle = gradient;
        ctx.stroke();

        if (elapsed < arc.duration) {
          const size = 9 + weight * 3;
          ctx.globalAlpha = 0.95;
          ctx.drawImage(this.sprites.allowed, hx - size, hy - size, size * 2, size * 2);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.beginPath();
          ctx.arc(hx, hy, 1.3 + weight * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = palette.additive ? 'rgba(255,255,255,0.95)' : rgba(palette.allowed, 1);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    this.arcs = keep;

    this.drawRings(ctx);
    this.drawHome(ctx);
    this.drawLabels(ctx, labels);

    if (this.hits.size > 600) {
      for (const [key, at] of this.hits) if (clock - at > 2000) this.hits.delete(key);
    }
  }

  private drawRings(ctx: CanvasRenderingContext2D): void {
    const { palette, clock } = this;
    const keep: Ring[] = [];
    for (const ring of this.rings) {
      const t = (clock - ring.start) / ring.duration;
      if (t >= 1) continue;
      keep.push(ring);
      const [x, y] = this.project(ring.lon, ring.lat);
      const radius = ring.from + (ring.to - ring.from) * easeOut(t);
      const alpha = (1 - t) * (1 - t) * ring.strength;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      if (ring.kind === 'arrive') {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgba(palette.allowed, alpha * 0.9);
        ctx.stroke();
      } else if (ring.kind === 'blocked') {
        // A refusal: a filled flash and a heavy ring that stops short.
        ctx.fillStyle = rgba(palette.blocked, alpha * 0.14);
        ctx.fill();
        ctx.lineWidth = 2.2 * (1 - t) + 0.8;
        ctx.strokeStyle = rgba(palette.blocked, alpha);
        ctx.stroke();
      } else if (ring.kind === 'local') {
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = rgba(palette.local, alpha * 0.95);
        ctx.stroke();
      } else {
        // No answer: a broken ring that drifts out and fades.
        ctx.save();
        ctx.setLineDash([2.5, 5]);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = rgba(palette.noanswer, alpha * 0.95);
        ctx.stroke();
        ctx.restore();
      }
    }
    this.rings = keep;
  }

  private drawHome(ctx: CanvasRenderingContext2D): void {
    const { palette, clock } = this;
    const home = this.options.home;
    const [x, y] = this.project(home.lon, home.lat);

    for (let i = 0; i < 2; i++) {
      const t = ((clock / 3400 + i * 0.5) % 1 + 1) % 1;
      ctx.beginPath();
      ctx.arc(x, y, 6 + 26 * easeOut(t), 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(palette.home, 0.34 * (1 - t) * (1 - t));
      ctx.stroke();
    }

    ctx.globalCompositeOperation = palette.additive ? 'lighter' : 'source-over';
    ctx.globalAlpha = palette.additive ? 0.75 : 0.35;
    ctx.drawImage(this.sprites.home, x - 22, y - 22, 44, 44);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = palette.halo;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(palette.home, 0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = rgba(palette.home, 1);
    ctx.fill();

    ctx.font = `600 10px ${this.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = home.label.toUpperCase();
    AtlasMap.spaced(ctx, '0.14em');
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = palette.halo;
    ctx.strokeText(label, x, y - 15);
    ctx.fillStyle = rgba(palette.home, 0.95);
    ctx.fillText(label, x, y - 15);
    AtlasMap.spaced(ctx, '0px');
  }

  private static spaced(ctx: CanvasRenderingContext2D, value: string): void {
    // Canvas letter-spacing is recent; where it is missing the text is just tighter.
    if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    labels: { x: number; y: number; r: number; text: string }[],
  ): void {
    if (labels.length === 0) return;
    const { palette } = this;
    const [hx, hy] = this.project(this.options.home.lon, this.options.home.lat);
    const taken: [number, number, number, number][] = [[hx - 34, hy - 30, hx + 34, hy + 12]];
    ctx.font = `500 10.5px ${this.monoFont}`;
    ctx.textBaseline = 'middle';
    for (const label of labels) {
      const w = ctx.measureText(label.text).width;
      const right = label.x + label.r + 7 + w < this.width - 8;
      const x0 = right ? label.x + label.r + 7 : label.x - label.r - 7 - w;
      const box: [number, number, number, number] = [x0 - 3, label.y - 8, x0 + w + 3, label.y + 8];
      if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      taken.push(box);
      ctx.textAlign = 'left';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = palette.halo;
      ctx.strokeText(label.text, x0, label.y);
      ctx.fillStyle = palette.label;
      ctx.fillText(label.text, x0, label.y);
    }
  }
}
