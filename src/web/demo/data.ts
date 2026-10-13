import type { QueryClass } from '../../shared/types';

/**
 * Everything the demo knows about the world (F25). The household, its devices and
 * every service name below are invented; all domains sit under the reserved
 * `.example` top-level domain, so none of them can belong to anyone. Only the
 * cities are real — they are just points on the map.
 */

export interface City {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
}

const city = (name: string, country: string, cc: string, lat: number, lon: number): City => ({
  city: name,
  country,
  cc,
  lat,
  lon,
});

export const CITIES = {
  ams: city('Amsterdam', 'Netherlands', 'NL', 52.37, 4.9),
  fra: city('Frankfurt', 'Germany', 'DE', 50.11, 8.68),
  lon: city('London', 'United Kingdom', 'GB', 51.51, -0.13),
  dub: city('Dublin', 'Ireland', 'IE', 53.35, -6.26),
  par: city('Paris', 'France', 'FR', 48.86, 2.35),
  sto: city('Stockholm', 'Sweden', 'SE', 59.33, 18.07),
  waw: city('Warsaw', 'Poland', 'PL', 52.23, 21.01),
  mad: city('Madrid', 'Spain', 'ES', 40.42, -3.7),
  mil: city('Milan', 'Italy', 'IT', 45.46, 9.19),
  zrh: city('Zurich', 'Switzerland', 'CH', 47.38, 8.54),
  hel: city('Helsinki', 'Finland', 'FI', 60.17, 24.94),
  osl: city('Oslo', 'Norway', 'NO', 59.91, 10.75),
  prg: city('Prague', 'Czechia', 'CZ', 50.08, 14.44),
  rek: city('Reykjavik', 'Iceland', 'IS', 64.15, -21.94),
  ist: city('Istanbul', 'Türkiye', 'TR', 41.01, 28.98),
  iad: city('Ashburn', 'United States', 'US', 39.04, -77.49),
  nyc: city('New York', 'United States', 'US', 40.71, -74.01),
  chi: city('Chicago', 'United States', 'US', 41.88, -87.63),
  dal: city('Dallas', 'United States', 'US', 32.78, -96.8),
  sea: city('Seattle', 'United States', 'US', 47.61, -122.33),
  sjc: city('San Jose', 'United States', 'US', 37.34, -121.89),
  lax: city('Los Angeles', 'United States', 'US', 34.05, -118.24),
  yyz: city('Toronto', 'Canada', 'CA', 43.65, -79.38),
  yul: city('Montreal', 'Canada', 'CA', 45.5, -73.57),
  mex: city('Mexico City', 'Mexico', 'MX', 19.43, -99.13),
  gru: city('São Paulo', 'Brazil', 'BR', -23.55, -46.63),
  eze: city('Buenos Aires', 'Argentina', 'AR', -34.6, -58.38),
  scl: city('Santiago', 'Chile', 'CL', -33.45, -70.67),
  jnb: city('Johannesburg', 'South Africa', 'ZA', -26.2, 28.05),
  los: city('Lagos', 'Nigeria', 'NG', 6.52, 3.38),
  nbo: city('Nairobi', 'Kenya', 'KE', -1.29, 36.82),
  dxb: city('Dubai', 'United Arab Emirates', 'AE', 25.2, 55.27),
  bom: city('Mumbai', 'India', 'IN', 19.08, 72.88),
  blr: city('Bengaluru', 'India', 'IN', 12.97, 77.59),
  sin: city('Singapore', 'Singapore', 'SG', 1.35, 103.82),
  cgk: city('Jakarta', 'Indonesia', 'ID', -6.21, 106.85),
  hkg: city('Hong Kong', 'Hong Kong', 'HK', 22.32, 114.17),
  tpe: city('Taipei', 'Taiwan', 'TW', 25.03, 121.57),
  icn: city('Seoul', 'South Korea', 'KR', 37.57, 126.98),
  nrt: city('Tokyo', 'Japan', 'JP', 35.68, 139.69),
  kix: city('Osaka', 'Japan', 'JP', 34.69, 135.5),
  syd: city('Sydney', 'Australia', 'AU', -33.87, 151.21),
  mel: city('Melbourne', 'Australia', 'AU', -37.81, 144.96),
  akl: city('Auckland', 'New Zealand', 'NZ', -36.85, 174.76),
} satisfies Record<string, City>;

export type CityCode = keyof typeof CITIES;

/** domain → where it "resolves". A `#` in a domain becomes a small number. */
export const DESTINATIONS: Record<string, CityCode> = {
  // streaming
  'edge-fra-#.streamhaus.example': 'fra',
  'edge-ams-#.streamhaus.example': 'ams',
  'edge-waw-#.streamhaus.example': 'waw',
  'api.streamhaus.example': 'iad',
  'img.streamhaus.example': 'dub',
  'vod.kinobox.example': 'par',
  'live.sportcast.example': 'lon',
  'subtitles.kinobox.example': 'mil',
  // phone
  'chat.pingme.example': 'dub',
  'media.pingme.example': 'sto',
  'feed.snaploop.example': 'sin',
  'video.snaploop.example': 'nrt',
  'mail.postbox.example': 'zrh',
  'push.mobilecloud.example': 'sjc',
  'maps.wayfind.example': 'hel',
  'weather.skycast.example': 'osl',
  'music.tunedrop.example': 'sto',
  'bank.finora.example': 'waw',
  'photos.shoebox.example': 'chi',
  'rides.hopon.example': 'ist',
  // laptop
  'git.codeforge.example': 'sea',
  'registry.pkgyard.example': 'iad',
  'docs.paperdesk.example': 'dub',
  'meet.huddle.example': 'ams',
  'turn-#.huddle.example': 'fra',
  'search.findly.example': 'zrh',
  'cdn.fontlib.example': 'chi',
  'wiki.openlore.example': 'ams',
  'news.morningpost.example': 'nyc',
  'updates.osvendor.example': 'dal',
  'ci.buildfarm.example': 'yul',
  'api.translatr.example': 'icn',
  // console
  'lobby.playgrid.example': 'lon',
  'match-eu-#.playgrid.example': 'mad',
  'match-as-#.playgrid.example': 'kix',
  'store.playgrid.example': 'lax',
  'dl.playgrid.example': 'ams',
  'voice.playgrid.example': 'par',
  // tablet
  'kids.tinytube.example': 'lon',
  'cdn.tinytube.example': 'mil',
  'learn.wordowl.example': 'yyz',
  'store.appshelf.example': 'sjc',
  'books.pageturn.example': 'mel',
  // iot
  'api.plugcloud.example': 'hkg',
  'time.ntpring.example': 'prg',
  'iot.cleanbot.example': 'sin',
  'maps.cleanbot.example': 'tpe',
  'relay.doorview.example': 'syd',
  'clips.doorview.example': 'bom',
  'p2p-#.doorview.example': 'dxb',
  'fw.doorview.example': 'cgk',
  // nas
  'backup.coldvault.example': 'rek',
  'updates.nasware.example': 'tpe',
  'ddns.homelink.example': 'yyz',
  // speaker
  'voice.echohall.example': 'iad',
  'radio-br.airwave.example': 'gru',
  'radio-za.airwave.example': 'jnb',
  'radio-mx.airwave.example': 'mex',
  'radio-ke.airwave.example': 'nbo',
  'radio-ar.airwave.example': 'eze',
  'radio-in.airwave.example': 'blr',
  'radio-nz.airwave.example': 'akl',
  'radio-ng.airwave.example': 'los',
  'radio-cl.airwave.example': 'scl',
};

export type Habit = [domain: string, weight: number, cls?: Exclude<QueryClass, 'allowed'>];

export interface DeviceProfile {
  name: string;
  /** Which of the two demo resolvers the device normally uses. */
  resolver: 0 | 1;
  /** Mean pause between bursts while busy / while quiet, in ms. */
  busyGap: number;
  quietGap: number;
  /** Mean length of a busy spell and of a quiet one, in ms. */
  busyFor: number;
  quietFor: number;
  /** Queries per burst, min and max. */
  burst: [number, number];
  habits: Habit[];
}

export const DEMO_INSTANCES = ['adguard-1', 'adguard-2'] as const;

export const DEVICES: DeviceProfile[] = [
  {
    name: 'Living-room TV',
    resolver: 0,
    busyGap: 2600,
    quietGap: 45_000,
    busyFor: 240_000,
    quietFor: 90_000,
    burst: [2, 6],
    habits: [
      ['edge-fra-#.streamhaus.example', 9],
      ['edge-ams-#.streamhaus.example', 7],
      ['edge-waw-#.streamhaus.example', 4],
      ['api.streamhaus.example', 3],
      ['img.streamhaus.example', 3],
      ['vod.kinobox.example', 3],
      ['subtitles.kinobox.example', 1],
      ['live.sportcast.example', 2],
      ['telemetry.streamhaus.example', 3, 'blocked'],
      ['ads.tvmetrics.example', 3, 'blocked'],
      ['time.ntpring.example', 0.5],
    ],
  },
  {
    name: 'Phone A',
    resolver: 0,
    busyGap: 3800,
    quietGap: 30_000,
    busyFor: 70_000,
    quietFor: 110_000,
    burst: [3, 12],
    habits: [
      ['chat.pingme.example', 8],
      ['media.pingme.example', 4],
      ['feed.snaploop.example', 6],
      ['video.snaploop.example', 4],
      ['mail.postbox.example', 3],
      ['push.mobilecloud.example', 4],
      ['maps.wayfind.example', 2],
      ['weather.skycast.example', 1.5],
      ['music.tunedrop.example', 3],
      ['bank.finora.example', 1],
      ['rides.hopon.example', 1],
      ['graph.adnexus.example', 4, 'blocked'],
      ['pixel.trackly.example', 3, 'blocked'],
    ],
  },
  {
    name: 'Phone B',
    resolver: 1,
    busyGap: 4500,
    quietGap: 40_000,
    busyFor: 50_000,
    quietFor: 150_000,
    burst: [2, 9],
    habits: [
      ['chat.pingme.example', 6],
      ['photos.shoebox.example', 4],
      ['mail.postbox.example', 3],
      ['push.mobilecloud.example', 3],
      ['feed.snaploop.example', 3],
      ['news.morningpost.example', 2],
      ['music.tunedrop.example', 2],
      ['store.appshelf.example', 1],
      ['pixel.trackly.example', 3, 'blocked'],
      ['sdk.appmetrics.example', 2, 'blocked'],
    ],
  },
  {
    name: 'Work laptop',
    resolver: 0,
    busyGap: 3200,
    quietGap: 25_000,
    busyFor: 180_000,
    quietFor: 80_000,
    burst: [2, 10],
    habits: [
      ['git.codeforge.example', 6],
      ['registry.pkgyard.example', 4],
      ['docs.paperdesk.example', 5],
      ['meet.huddle.example', 3],
      ['turn-#.huddle.example', 3],
      ['search.findly.example', 4],
      ['cdn.fontlib.example', 2],
      ['wiki.openlore.example', 2],
      ['news.morningpost.example', 2],
      ['updates.osvendor.example', 1.5],
      ['ci.buildfarm.example', 2],
      ['api.translatr.example', 1],
      ['analytics.sitebeacon.example', 3, 'blocked'],
      ['nas.lan', 2, 'local'],
      ['intranet.lan', 1.5, 'local'],
      ['wpad.localdomain', 0.8, 'noanswer'],
    ],
  },
  {
    name: 'Tablet',
    resolver: 1,
    busyGap: 4200,
    quietGap: 60_000,
    busyFor: 120_000,
    quietFor: 200_000,
    burst: [2, 7],
    habits: [
      ['kids.tinytube.example', 7],
      ['cdn.tinytube.example', 6],
      ['learn.wordowl.example', 3],
      ['store.appshelf.example', 1.5],
      ['books.pageturn.example', 2],
      ['ads.playpromo.example', 5, 'blocked'],
    ],
  },
  {
    name: 'Game console',
    resolver: 0,
    busyGap: 3000,
    quietGap: 90_000,
    busyFor: 150_000,
    quietFor: 240_000,
    burst: [3, 14],
    habits: [
      ['lobby.playgrid.example', 5],
      ['match-eu-#.playgrid.example', 6],
      ['match-as-#.playgrid.example', 2],
      ['voice.playgrid.example', 3],
      ['store.playgrid.example', 2],
      ['dl.playgrid.example', 3],
      ['telemetry.playgrid.example', 4, 'blocked'],
    ],
  },
  {
    // The chatty one: phones home every few seconds and is mostly refused.
    name: 'Smart plug',
    resolver: 1,
    busyGap: 5200,
    quietGap: 9000,
    busyFor: 600_000,
    quietFor: 20_000,
    burst: [1, 3],
    habits: [
      ['device-metrics.plugcloud.example', 12, 'blocked'],
      ['log.plugcloud.example', 5, 'blocked'],
      ['api.plugcloud.example', 2],
      ['time.ntpring.example', 1],
    ],
  },
  {
    name: 'Robot vacuum',
    resolver: 1,
    busyGap: 9000,
    quietGap: 70_000,
    busyFor: 90_000,
    quietFor: 300_000,
    burst: [1, 4],
    habits: [
      ['iot.cleanbot.example', 6],
      ['maps.cleanbot.example', 3],
      ['stats.cleanbot.example', 4, 'blocked'],
    ],
  },
  {
    name: 'Doorbell camera',
    resolver: 1,
    busyGap: 7000,
    quietGap: 50_000,
    busyFor: 40_000,
    quietFor: 160_000,
    burst: [2, 6],
    habits: [
      ['relay.doorview.example', 5],
      ['clips.doorview.example', 3],
      ['p2p-#.doorview.example', 3],
      ['fw.doorview.example', 0.6],
      ['metrics.doorview.example', 2, 'blocked'],
    ],
  },
  {
    name: 'Kitchen speaker',
    resolver: 0,
    busyGap: 8000,
    quietGap: 60_000,
    busyFor: 200_000,
    quietFor: 120_000,
    burst: [1, 4],
    habits: [
      ['music.tunedrop.example', 5],
      ['voice.echohall.example', 3],
      ['radio-br.airwave.example', 1.2],
      ['radio-za.airwave.example', 1],
      ['radio-mx.airwave.example', 1],
      ['radio-ke.airwave.example', 0.8],
      ['radio-ar.airwave.example', 0.8],
      ['radio-in.airwave.example', 1],
      ['radio-nz.airwave.example', 0.7],
      ['radio-ng.airwave.example', 0.7],
      ['radio-cl.airwave.example', 0.6],
      ['voicelog.echohall.example', 2, 'blocked'],
    ],
  },
  {
    name: 'NAS',
    resolver: 0,
    busyGap: 12_000,
    quietGap: 40_000,
    busyFor: 60_000,
    quietFor: 180_000,
    burst: [1, 3],
    habits: [
      ['backup.coldvault.example', 6],
      ['updates.nasware.example', 1.5],
      ['ddns.homelink.example', 2],
      ['time.ntpring.example', 1],
      ['tracker.oldmirror.example', 1.2, 'noanswer'],
    ],
  },
  {
    name: 'Printer',
    resolver: 1,
    busyGap: 15_000,
    quietGap: 45_000,
    busyFor: 30_000,
    quietFor: 200_000,
    burst: [1, 3],
    habits: [
      ['fw-check.inkworks.example', 4, 'noanswer'],
      ['printer.lan', 3, 'local'],
      ['telemetry.inkworks.example', 3, 'blocked'],
    ],
  },
];
