import { open, type CityResponse, type Reader } from 'maxmind';
import type { Destination } from '../shared/types';

export interface GeoLocator {
  lookup(address: string): Destination | undefined;
}

/**
 * F7. Reads a MaxMind-format (.mmdb) city database from disk: the bundled DB-IP
 * City Lite, or a mounted GeoLite2-City. No lookup service is ever called.
 */
export class MmdbLocator implements GeoLocator {
  private constructor(private readonly reader: Reader<CityResponse>) {}

  static async open(path: string): Promise<MmdbLocator> {
    return new MmdbLocator(await open<CityResponse>(path));
  }

  get databaseType(): string {
    return this.reader.metadata.databaseType;
  }

  lookup(address: string): Destination | undefined {
    let record: CityResponse | null;
    try {
      record = this.reader.get(address);
    } catch {
      return undefined;
    }
    const lat = record?.location?.latitude;
    const lon = record?.location?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
    const country = record?.country ?? record?.registered_country;
    return {
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
      city: record?.city?.names?.en || undefined,
      country: country?.names?.en || undefined,
      cc: country?.iso_code || undefined,
    };
  }
}
