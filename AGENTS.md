# Notes for agents

AdGuard Atlas draws the DNS queries of a network on a world map, live, from the query
log of AdGuard Home. [docs/SPEC.md](docs/SPEC.md) is the source of truth for what it
does; [README.md](README.md) is what users read. Change the spec first when behaviour
changes, and keep the README in step.

## Docker only

Nothing gets installed on the host. Do not run `npm install`, `npm ci` or `npx`
outside a container, and do not leave `node_modules`, `dist` or `demo-dist` behind.

```sh
# type check, lint, tests
docker build --target check .

# the runtime image
docker build -t adguard-atlas .

# try it: synthetic traffic, no AdGuard Home needed — http://127.0.0.1:18080
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e DEMO=true -p 127.0.0.1:18080:8080 adguard-atlas

# the static demo (plain files, no server)
docker build --target demo -o demo-dist .
```

A dependency change means regenerating `package-lock.json` inside a container
(`npm install --package-lock-only` in `node:22-alpine`, running as the host user) and
committing it.

## Layout

- `src/server` — polling of AdGuard Home, classification, GeoIP, in-memory window,
  event stream.
- `src/web` — React shell, canvas map (`map/`), in-browser demo generator (`demo/`),
  event sources (`sources/`).
- `src/shared` — the event type both sides speak.
- `test` — vitest; includes a fake AdGuard Home and a recorded query-log fixture.

## Pipeline

`.github/workflows/ci.yml` builds the `check` and `demo` targets, then the image,
which it starts with the hardening flags, exercises and scans before pushing.
`master` publishes `edge` to the GitHub Container Registry and the demo to Cloudflare Pages; a `v*.*.*`
tag (it must match `package.json` and `APP_VERSION`) publishes the versioned image,
`latest` and a GitHub release; `dev` and pull requests publish nothing.
Dependabot opens against `dev`. A change to the smoke test is worth running by hand
against a local image first — it is plain shell.

## Rules that are easy to break

- **Read-only towards AdGuard Home.** The server issues `GET /control/querylog` and
  nothing else; only `src/server/adguard.ts` makes outbound requests. Tests pin both.
- **No external resources in the page.** No tile servers, CDN fonts or analytics;
  fonts and map geometry are bundled. The Content-Security-Policy is `connect-src
  'self'` for the server build and `connect-src 'none'` for the static demo.
- **The demo names nothing real.** Generated domains stay under `.example`.
- **Credentials stay on the server.** Nothing from `ADGUARD_*` reaches the browser.
- **Never test against a real AdGuard Home** without the owner asking; use the fake
  in `test/`.
- **The container stays hardened**: non-root, read-only root filesystem, no
  capabilities. A change that needs a writable path needs a reason.
- **GeoIP data is fetched at image build time**, never committed.

## Git

- Branch `master` is the release line; work happens on `dev` or a branch off it.
  A push to `master` publishes.
- Commits go in the owner's name only: no `Co-Authored-By`, no "Generated with"
  footer, no mention of a tool — in commit messages and pull requests alike.
- Do not push or add a remote unless asked.
