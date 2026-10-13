# AdGuard Atlas — specification

Status: draft 2, 2026-10-13. Nothing is implemented yet.

## 1. What it is

A self-hosted web page that shows a world map and draws the DNS queries of your
network on it as they happen. It reads the query log of one or more
[AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) instances, looks up where
the answered addresses are, and animates an arc from your home to each destination.

One container, read-only access to AdGuard Home, no changes to the network.

## 2. What it is not

- **Not a traffic monitor.** It shows what devices *asked for*, not where packets
  went. Connections made to a bare IP address, traffic volume and ports are invisible
  to it. The UI must say so.
- **Not an AdGuard Home admin panel.** It never writes to AdGuard Home: no rules,
  no settings, no log clearing.
- **Not a long-term analytics store.** History beyond a short in-memory window is
  AdGuard Home's job.
- **Not affiliated with AdGuard.** The name describes what it connects to.

## 3. Use cases

| # | As… | I want to… | So that… |
| --- | --- | --- | --- |
| U1 | the owner of a home network | open one page and watch queries fly across a world map live | I get a feel for what my network talks to |
| U2 | the owner | see blocked queries differently from allowed ones | I can see the filter working |
| U3 | the owner | click a country or an arc and see which domains and which devices are behind it | "why is something talking to X?" has an answer |
| U4 | the owner | filter the map to one device | I can watch what a TV, a phone or an IoT gadget does |
| U5 | the owner of two resolvers | see queries from all AdGuard Home instances on one map | a split query log stops being a problem |
| U6 | someone with a wall display | run the page full-screen with no controls | it works as an ambient dashboard |
| U7 | a privacy-minded user | hide device names and domains on screen | the page can stay open when guests are around |
| U8 | an operator | run it with `docker run` and a few environment variables | setup takes minutes |
| U9 | an operator | see clearly when an instance is unreachable or the credentials are wrong | a blank map is never the only symptom |
| U10 | a visitor to the public demo | see the map working with made-up traffic, without installing anything | I can judge the project in ten seconds |
| U11 | an operator | start the container in demo mode | I can try the image before pointing it at my AdGuard Home |

## 4. Functional requirements

### 4.1 Data source

- F1. Reads `GET /control/querylog` of AdGuard Home (tested against v0.107.x) with
  HTTP Basic authentication.
- F2. Supports **several instances**; each has a URL, credentials and a display name.
- F3. AdGuard Home has no streaming API, so each instance is polled (default every
  2 s). Entries already seen are skipped; a restart starts from "now", not from the
  beginning of the log.
- F4. TLS verification can be turned off per instance (self-signed panel certificates).
- F5. An instance that fails is retried with backoff and reported in the UI (U9);
  the others keep working.

### 4.2 Turning a log entry into something drawable

- F6. Destination = the first public address among the `A`/`AAAA` answers. `CNAME`
  chains are followed within the same entry.
- F7. Location comes from a GeoIP database inside the container — no lookup service
  is called. Resolution is city level where the database has it, country otherwise.
- F8. Entries are classified:

  | Class | Meaning | On the map |
  | --- | --- | --- |
  | allowed | answered with a public address | arc home → destination |
  | blocked | filtered by AdGuard Home | pulse at home, counted, no arc |
  | local | answer is a private address (rewrites, LAN names) | counted, no arc |
  | no answer | NXDOMAIN, SERVFAIL, empty | counted, no arc |

- F9. The home location is set by configuration (latitude/longitude). It is never
  derived from the public IP.

### 4.3 Map

- F10. A world map fills the page; arcs animate from home to destination and fade.
- F11. Destinations that receive many queries accumulate a marker whose size follows
  the count within the current window (default 15 minutes).
- F12. The world geometry ships in the image. The page loads **no external
  resources** — no tile server, no fonts, no analytics — so it works on an isolated
  network.
- F13. Dark and light themes; responsive down to a phone.

### 4.4 Around the map

- F14. Live feed: the most recent queries with time, device, domain, country, class.
- F15. Counters for the window: queries, blocked share, top countries, top domains,
  top devices.
- F16. Filters: device, class, instance, text match on domain (U3, U4).
- F17. Clicking a marker or a country lists the domains and devices behind it (U3).
- F18. Kiosk mode (`?kiosk`): map only (U6).
- F19. Privacy mode: device names and domains masked on screen (U7), switchable in
  the UI and forceable by configuration.
- F20. Pause/resume of the animation; the feed keeps collecting.

### 4.5 Delivery to the browser

- F21. The server pushes events over Server-Sent Events; a new tab first receives
  the current window, then live events.
- F22. Bursts are rate-limited for drawing (a cap on arcs per second, the rest
  aggregated), so a noisy device cannot freeze the page.

### 4.6 Demo mode

- F23. The front end takes its events from one of two interchangeable sources: the
  server's event stream, or a **generator that runs in the browser**. Everything
  after the source — map, feed, counters, filters, modes — is the same code.
- F24. The generator invents a household: a handful of named devices, each with its
  own habits (a TV that talks to streaming CDNs, a phone, a chatty IoT plug that
  mostly gets blocked), realistic bursts and quiet periods, and a share of blocked,
  local and failed queries.
- F25. Destinations come from a list bundled with the generator (domain, city,
  coordinates). The demo performs no DNS and no GeoIP lookups, and names no real
  person or network.
- F26. The demo is clearly labelled as synthetic on screen, with a link to the
  repository.
- F27. Two ways to get it:
  - **static demo build** — `npm run build:demo` produces a directory of files with
    no server at all, deployed to Cloudflare Pages (U10);
  - **`DEMO=true`** on the container — the server serves the same front end switched
    to the generator and contacts no AdGuard Home (U11).

## 5. Architecture

```
AdGuard Home #1 ─┐  poll /control/querylog
AdGuard Home #2 ─┼──────────────► server ──► GeoIP lookup ──► in-memory window
        …        ┘                  │
                                    └── SSE ──► browser: map, feed, filters
```

- **Server** — holds the AdGuard credentials, polls, enriches, keeps the window in
  memory, serves the static front end and the event stream. Credentials never reach
  the browser.
- **Front end** — static bundle; draws from the event stream only.
- **State** — none on disk. A restart loses the window and nothing else.

Unlike certificate-inspector the real thing cannot be a static export: something has
to hold credentials and talk to AdGuard Home. The image therefore contains an
application runtime, and the hardening has to be done by configuration rather than by
absence.

The demo is the exception. With the generator as the event source there is no
server-side work left, so the demo build *is* a static export:

```
browser: generator ──► map, feed, filters        (no server, no network calls)
```

## 6. Configuration

Environment variables only; no configuration file is required.

| Variable | Meaning | Default |
| --- | --- | --- |
| `ADGUARD_1_URL`, `ADGUARD_1_USER`, `ADGUARD_1_PASSWORD` | first instance | required |
| `ADGUARD_1_NAME` | display name | host of the URL |
| `ADGUARD_1_INSECURE_TLS` | skip certificate verification | `false` |
| `ADGUARD_2_…` and so on | further instances | — |
| `HOME_LAT`, `HOME_LON` | where arcs start | required |
| `HOME_LABEL` | label of the home marker | `Home` |
| `POLL_INTERVAL_MS` | polling period | `2000` |
| `WINDOW_MINUTES` | size of the in-memory window | `15` |
| `PRIVACY_MODE` | force masking of devices and domains | `false` |
| `IGNORE_CLIENTS`, `IGNORE_DOMAINS` | comma-separated exclusions | empty |
| `DEMO` | serve synthetic traffic; no AdGuard Home is contacted and the `ADGUARD_*` and `HOME_*` variables are not required | `false` |
| `PORT` | listening port | `8080` |

`*_PASSWORD_FILE` variants are accepted so secrets can come from Docker secrets.

## 7. Security and privacy

A DNS query log is personal data: it says who looked at what, and when.

- The app has **no login of its own**. It is meant for a trusted network or behind a
  reverse proxy that authenticates. The README says this in the first screen.
- The server needs an AdGuard Home account; AdGuard Home has no read-only role, so
  that account can also change settings. The app uses `GET /control/querylog` and
  nothing else, and a test pins that.
- The server makes outbound connections to the configured AdGuard Home URLs only.
- The page ships a Content-Security-Policy with `connect-src 'self'` and no
  third-party origins. The static demo goes further with `connect-src 'none'`: it
  has nothing to connect to, and the header proves it shows no one's real queries.
- Nothing is written to disk; domains and device names are not logged at the default
  log level.
- Container: non-root user, read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, healthcheck on `/healthz` — the same settings as
  certificate-inspector's compose file.

## 8. Build and publishing

Same shape as [certificate-inspector](https://github.com/marska/certificate-inspector):

- Multi-stage `Dockerfile`; images for `linux/amd64` and `linux/arm64`.
- GitHub Actions: type check, lint, tests → build → smoke test of the container
  with the hardening flags applied → Trivy scan (HIGH/CRITICAL, fixed only) → push.
  The checks run through the Dockerfile's own targets (`check`, `demo`), so the
  pipeline and a local build cannot disagree about what "the checks" are.
- Docker Hub, `marskadh/adguard-atlas`. Tags: semver from `v*.*.*` tags, `latest`
  for the newest release only, `edge` for the tip of `master`, short SHA.
- Branches `master` and `dev`; Dependabot (npm, actions, docker) targets `dev`.
- Weekly scheduled rebuild without cache to pick up base-image patches.
- `docker-compose.yml` in the repository as the reference deployment.
- Licence: GPL-3.0.

**Demo on Cloudflare Pages**, also as in certificate-inspector: the `verify` job
builds the static demo and hands it over as an artifact; a `deploy` job on `master`
publishes exactly those files with `wrangler pages deploy` and then checks that the
live site still sends its Content-Security-Policy. Project name `adguard-atlas`;
the job creates the project on its first run and reads the site's address back from
Cloudflare rather than assuming it.

## 9. Decisions

Accepted 2026-10-13.

| # | Question | Decision |
| --- | --- | --- |
| D1 | Stack | TypeScript end to end, as in certificate-inspector: a small Node server (polling, SSE) plus a static React front end. No Next.js. |
| D2 | Map rendering | Canvas with `d3-geo` and Natural Earth geometry (public domain): small, offline, enough for arcs. A 3-D globe can be a later view. |
| D3 | GeoIP database | DB-IP Lite (CC BY 4.0) bundled in the image with attribution and refreshed by the weekly rebuild. MaxMind GeoLite2 needs a licence key and may not be bundled in a public image; supported as an optional mounted file. |
| D4 | Flat map or globe first | Flat map — everything is visible at once, which suits a wall display. |
| D5 | Device names | The client names AdGuard Home already knows (`client_info`); the IP as fallback. |
| D6 | Demo mode | Yes, generated in the browser — see 4.6. Primary use is local, against real AdGuard Home instances; the public face of the project is the demo on Cloudflare Pages. |

## 10. Milestones

1. **Skeleton** — server polls one instance and prints classified, located entries;
   tests on recorded query-log fixtures.
2. **Map** — event stream, flat map, arcs, home marker, live feed.
3. **Exploration** — counters, filters, click-through, several instances.
4. **Modes** — kiosk, privacy; themes.
5. **Demo** — in-browser generator, static demo build, `DEMO=true`.
6. **Release** — Dockerfile, CI, hardening, Cloudflare Pages deployment of the demo,
   README with screenshot and demo link, `v0.1.0`.

## 11. Out of scope for the first release

UniFi or NetFlow as a data source (real traffic), persistence and history replay,
alerts, built-in authentication, Pi-hole and other resolvers, IPv6-specific views.
