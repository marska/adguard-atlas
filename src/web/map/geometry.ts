import { geoBounds, geoContains, geoGraticule10 } from 'd3-geo';
import type { Feature, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { feature, merge, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldData from 'world-atlas/countries-50m.json';

/**
 * F12 / D2. Natural Earth 1:50m country polygons (public domain), bundled through
 * the `world-atlas` package. Nothing is fetched at runtime.
 */

export interface Country {
  id: string;
  name: string;
  feature: Feature<Polygon | MultiPolygon, { name: string }>;
  /** [[west, south], [east, north]]; west > east when it crosses the antimeridian */
  bounds: [[number, number], [number, number]];
}

type World = Topology<{ countries: GeometryCollection<{ name: string }> }>;

const ANTARCTICA = '010';

export interface WorldGeometry {
  countries: Country[];
  byId: Map<string, Country>;
  land: MultiPolygon;
  borders: MultiLineString;
  graticule: MultiLineString;
}

let cached: WorldGeometry | undefined;

export function worldGeometry(): WorldGeometry {
  if (cached) return cached;
  const topology = worldData as unknown as World;
  const object = topology.objects.countries;
  // Antarctica is left out: no query ends there, and the map gains a fifth in height.
  const kept = object.geometries.filter((g) => String(g.id) !== ANTARCTICA);
  const collection = feature(topology, { ...object, geometries: kept });

  const countries: Country[] = collection.features.map((f, i) => ({
    // A few disputed territories have no ISO number in Natural Earth.
    id: f.id !== undefined ? String(f.id) : `x${i}`,
    name: f.properties.name,
    feature: f as Country['feature'],
    bounds: geoBounds(f),
  }));

  cached = {
    countries,
    byId: new Map(countries.map((c) => [c.id, c])),
    land: merge(topology, kept as never),
    borders: mesh(topology, { ...object, geometries: kept } as never, (a, b) => a !== b),
    graticule: geoGraticule10(),
  };
  return cached;
}

function inBounds(b: Country['bounds'], lon: number, lat: number): boolean {
  if (lat < b[0][1] || lat > b[1][1]) return false;
  return b[0][0] <= b[1][0] ? lon >= b[0][0] && lon <= b[1][0] : lon >= b[0][0] || lon <= b[1][0];
}

/** The country a point lies in, if any. */
export function countryAt(lon: number, lat: number): Country | undefined {
  for (const c of worldGeometry().countries) {
    if (inBounds(c.bounds, lon, lat) && geoContains(c.feature, [lon, lat])) return c;
  }
  return undefined;
}
