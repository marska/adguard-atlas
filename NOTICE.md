# Third-party data and software

AdGuard Atlas is licensed under the GNU General Public License v3.0 (see `LICENSE`).
The container image and the front-end bundle also contain:

- **IP geolocation data** — [DB-IP City Lite](https://db-ip.com/db/download/ip-to-city-lite)
  by DB-IP, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  The database is downloaded when the image is built; it is not part of this
  repository. The page credits it as "IP geolocation by DB-IP".
- **World geometry** — [Natural Earth](https://www.naturalearthdata.com/) 1:50m
  country polygons (public domain), through the `world-atlas` package (ISC).
- **Fonts** — Space Grotesk and JetBrains Mono, both under the SIL Open Font
  License 1.1, through the `@fontsource-variable` packages.
- **Libraries** — React (MIT), d3-geo (ISC), topojson-client (ISC), maxmind (MIT).

AdGuard Atlas is not affiliated with AdGuard. "AdGuard" and "AdGuard Home" are
trademarks of their owner; the name only describes what this project connects to.
