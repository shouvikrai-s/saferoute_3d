# SafeRoute Backend (Phase 1 foundation)

Lightweight Express API that sits between the SafeRoute 3D app and
GraphHopper. Current stage: proxies to the **public GraphHopper cloud
API** (with the API key now kept server-side instead of in the client
HTML), plus request validation, rate limiting, duplicate-request
suppression, and a bounded route cache. Self-hosted GraphHopper (Phase G)
is wired in as a configuration switch but is **not yet deployed** — see
`data/README.md`.

## Run it locally

```bash
cd backend
cp .env.example .env
# edit .env and set GRAPHHOPPER_API_KEY to a real key
npm install
npm start
```

Server starts at `http://127.0.0.1:3000` by default (`PORT` in `.env`).

## Dataset inventory and normalization

The repository includes actual raw hazard data under `backend/data/raw`:

- `open meteo/sikkim flood data .csv.csv` — a six-location Open-Meteo discharge dataset in `m³/s`
- `isro_nrsc/open-meteo-27.38N88.59E1588m.csv` — hourly meteorological observations and precipitation records
- `cwc/cwc sk2026-2030.csv` — a CWC-labelled river-discharge CSV snapshot; timestamps and station records are validated, invalid values excluded, and the raw file remains unchanged
- `ssdma/*.pdf` and `isro_nrsc/*.pdf` — historical landslide, forest-fire, earthquake, and geospatial reference material

Run the processing script to fingerprint raw files, normalize weather/discharge archives and CWC river observations, extract only well-structured dated SSDMA history from the earthquake and forest-fire tables, and generate a machine-readable inventory:

```bash
cd backend
node scripts/process-datasets.js
```

This writes:

- `data/processed/dataset_inventory.json`
- `data/processed/flood_normalized.json`
- `data/processed/weather_normalized.json`
- `data/processed/cwc_river_observations.json`
- `data/processed/historical_events.json`

The source files are not modified. Each raw-file inventory entry includes its byte size and SHA-256 fingerprint. The pipeline extracts 59 coordinate-bearing earthquake records (UTC event time, coordinates, depth and magnitude) and 539 date-bearing fire-document entries (no inferred coordinates). Suspect dates are retained as source text and excluded from normalized date ranges. Other PDFs remain catalogued source references where text is not reliably extractable; no OCR-derived locations or incidents are invented.

### Load archives into PostgreSQL

After processing, apply the additive, idempotent historical-data tables and import records (including valid CWC CSV rows):

```bash
npm run load:historical-data
```

This creates `saferoute_historical_observations` and `saferoute_historical_events` if absent, then upserts the normalized records inside a transaction. It does not alter the existing routing/resource tables. Daily Open-Meteo discharge estimates dated after the current UTC date are stored as `forecast_estimate`; earlier dates are `historical_model_estimate` and remain explicitly model-derived, not gauge observations. Hourly weather retains its source timestamp and is normalized to UTC using the source CSV's GMT metadata.

Public read-only endpoints:

- `GET /api/data/catalog` — raw-file fingerprints, database record counts/date ranges, extractable PDF references, road-network source presence, and boundary-data availability.
- `GET /api/data/history?dataset=weather|discharge|cwc&start=YYYY-MM-DD&end=YYYY-MM-DD&locationId=N&limit=100&offset=0` — bounded archive history. Discharge forecasts are excluded by default; request `includeForecast=true` to include and clearly label them.
- `GET /api/data/river-observations` — latest valid imported CWC-labelled CSV reading per station, with source and normalized timestamps, freshness, units, coordinates, and provenance.
- `GET /api/data/assessment?lat=...&lon=...` — descriptive statistics from the nearest archived weather/discharge point within 100 km. This is historical context, not a risk warning or live reading.
- `GET /api/data/events?type=earthquake|forest_fire` — date-filterable historical source-document events. Earthquake events include coordinates; forest-fire records do not, because the source document supplies no coordinates.

The AI Monitor requests the catalog, a current-viewport archive assessment, and the CWC station snapshot. The optional “CWC river discharge stations” Map Controls layer shows the latest imported station readings in both the 2D overlay and Cesium 3D map. It is off by default. The CWC file has no timestamp timezone, so the original text is retained and normalized UTC uses an explicit Asia/Kolkata assumption. A six-hour freshness threshold marks old readings `STALE`; the single file cannot verify live updates, so even a recent snapshot is never labeled `LIVE`. Discharge is not dam gate/reservoir status or an official flood warning. The app continues to use its existing 2D-first startup.

## Flood forecast model (real data, chronological evaluation)

The repository also includes a real trained baseline forecast built from the processed flood discharge series. It uses a chronological 70/30 split and predicts the next day of discharge from the previous value and the trailing 7-day rolling mean at each station.

```bash
cd backend
npm run train:flood-model
```

This saves `data/model-artifacts/saferoute-flood-baseline-0.1.0.json` and records the measured hold-out MAE/RMSE versus a naive baseline. The model is intentionally labelled as a contextual discharge model and not as an official flood warning system.

## Traffic model provenance and retraining

The backend includes the `SafeRouteTrafficKMeans v0.1.0` model metadata and a retraining entry point at `backend/scripts/train-traffic-model.js`.

The default persisted artifact at `backend/data/model-artifacts/saferoute-traffic-kmeans-0.1.0.json` is intentionally left in a `not_trained` state until a licence-cleared TomTom/OSM traffic dataset is added. This avoids fabricating production claims while still keeping the inference path and training pipeline explicit and reproducible.

Run the retraining entry point with a JSON dataset containing `relativeSpeed` values (for example an array of numbers or an object with a `samples`/`observations` array):

```bash
cd backend
node scripts/train-traffic-model.js ./data/example-traffic-samples.json
```

When no dataset is passed, the script leaves the model in the documented `not_trained` state instead of implying a validated production model.

## Endpoints

See “Load archives into PostgreSQL” for the history/catalog/event APIs.

### `GET /api/route`

```
GET /api/route?startLat=27.3389&startLon=88.6065&endLat=27.3314&endLon=88.6142
```

Required query params: `startLat`, `startLon`, `endLat`, `endLon` (all
numeric; latitudes -90..90, longitudes -180..180).

Response: the **raw GraphHopper response**, unchanged — `data.paths[]`,
each with `points.coordinates`, `instructions`, `distance`, `time`, etc.
This is deliberate: the existing `calculateRoute()` parsing in
`HelloWorld.html` needs zero changes to consume this endpoint.

Response headers:
- `X-SafeRoute-Cache: HIT | MISS`
- `X-SafeRoute-Deduped: true` (present only when this request was served
  by piggybacking on an already-in-flight identical request)

Error responses (JSON body, non-2xx status):
- `400` — missing/invalid parameters
- `429` — rate limited (`Retry-After` header included)
- `502` — upstream GraphHopper error (e.g. its own rate limit)
- `500` — unexpected server error

### `GET /health`

Returns backend status, routing mode, and cache stats. Never returns API
keys or other secrets.

## Switching the app to use this backend

In `HelloWorld.html`, once this backend is deployed somewhere reachable
from the phone:

```js
const ROUTING_CONFIG = {
  mode: "backend",
  backendUrl: "https://your-backend-host/api/route"
};
```

That's the only change required — `buildRouteUrl()` already branches on
`mode`, and response parsing is unchanged because the schema is identical.
The GraphHopper provider key stays in the backend environment; do not add
it to the browser configuration.

**Do this only after the backend is actually deployed and verified** —
not yet, per this phase's scope.

## Optional 3D imagery provider configuration

The generated client does not bundle a Cesium Ion access token or configure
`Cesium.GoogleMaps.defaultApiKey`. Without an authorized provider credential,
the photorealistic tileset is not requested and the app keeps its separate 2D
OpenStreetMap road map available; the Cesium 3D view is marked unavailable.
The viewer has `globe: false`, so there is no OSM-on-ellipsoid fallback in 3D.

`Cesium.createGooglePhotorealistic3DTileset` can use a Google Maps Platform
3D Tiles API key configured through its `key` option or
`Cesium.GoogleMaps.defaultApiKey`. When no Google key is set, this Cesium
version instead resolves Ion asset `2275207`, which requires a Cesium Ion
access token authorized for that asset. Configure either credential through
an owner-managed, appropriately restricted runtime/build setup; do not embed
a raw token in the source HTML. Provider rate limits or other service errors
can still prevent imagery from loading even when a credential is configured.
Photorealistic 3D tiles are not elevation terrain data.
The raster tiles use the public OSM tile service on a best-effort basis:
do not bulk-prefetch, preserve normal browser caching and referer behavior,
and use a separately provisioned tile service if application demand grows.
There is currently no supported local token-injection hook in the active
Flutter loader or generated client. A previous version of this documentation
referred to `window.__sr3dProviderConfig.cesiumIonAccessToken`, but that hook
is not implemented in the current source. Do not rely on it or copy a token
from historical backups. To restore the original Ion path, first make an
owner-managed, rotated browser token available through secure local
configuration, then add and verify an explicit loader path before building.
Cesium browser tokens are necessarily visible to users and are not server
secrets; restrict the token to the required asset and applicable referrers.
Never put a privileged server credential in frontend configuration or commit
any token.

## Protections implemented

- Per-IP rate limiting (`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`
  in `.env`) — **Redis-backed and shared across instances when
  `REDIS_URL` is set**, with automatic fallback to the original
  in-memory/single-instance behavior if Redis is unset or unreachable.
- Full coordinate/parameter validation before any upstream call
- In-flight de-duplication — identical concurrent requests share one
  upstream call instead of hammering GraphHopper. Still per-instance
  only (documented limitation — see `services/graphhopper.js`).
- Route cache (`CACHE_TTL_MS` / `CACHE_MAX_ENTRIES`) — **Redis-backed
  and shared across instances when `REDIS_URL` is set**, same
  automatic fallback behavior as rate limiting.
- Request logging (method, path, status, duration) to stdout
- `GET /metrics` — Prometheus text-format counters (requests, cache
  hit/miss, dedup hits, errors, rate-limited count)
- `GET /live` — process liveness only
- `GET /ready` — readiness (routing backend configured); Redis status
  reported but does not fail readiness, since it's an optional
  accelerator with automatic fallback
- Provider credentials (such as GraphHopper and TomTom keys) stay server-side and are never sent to the client. Browser-facing app endpoints are public and rely on validation and configured per-IP rate limiting; a key embedded in a distributed app would not be secret authentication.

## Redis (optional, recommended before horizontally scaling)

Set `REDIS_URL` (e.g. `redis://localhost:6379` or a managed provider's
connection string) and run `npm install` to pull in `ioredis`. With it
set and reachable:
- rate limiting is enforced correctly across ALL backend instances
  sharing that Redis, instead of each instance allowing its own
  independent quota
- the route cache is shared across all instances, so a route already
  computed by instance A is served instantly by instance B on a cache
  hit, instead of every instance independently hitting GraphHopper

Without `REDIS_URL` (or if Redis becomes unreachable mid-session), both
features automatically fall back to the original in-memory,
single-instance-only behavior — nothing crashes or hard-fails.

**Status: CODE INSPECTED + SYNTAX CHECKED, NOT yet run against a real
Redis instance in this session** (no network access in this
environment). Before relying on it: run a real Redis (local `docker run
redis` is the fastest way to check), set `REDIS_URL`, start the server,
and confirm the `[redis] connected` log line and `"cacheBackend":
"redis (shared)"` in `GET /health`.

## Load testing

`backend/loadtest/route-loadtest.js` (autocannon-based) hits `/api/route`
with a realistic mix of repeated Sikkim/Kalimpong coordinate pairs so
cache/dedup paths get exercised the way real traffic would.

```
cd backend
npm install --save-dev autocannon
npm start                 # terminal 1
npm run loadtest          # terminal 2
```

**This has NOT been run in this session** (no network/no live server
here) — it's provided for you to run and is not itself proof of any
throughput number. It characterizes ONE instance; real 700,000-user
readiness requires running it against your actual deployed instance
count and multiplying with real numbers, not assuming linear scaling.

## 700,000-user scalability path (honest status)

**What exists right now:** a single-instance-capable backend that
ALSO supports safe horizontal scaling once Redis is configured (rate
limit + cache are now shared-state-ready). What does **not** yet
exist: multiple instances actually deployed, a real reverse proxy in
front of them, self-hosted GraphHopper, or any load-test evidence at
realistic concurrency. This does **not** by itself serve 700,000
simultaneous users — nobody should claim that without running the load
test above against a real multi-instance deployment.

**Realistic path to get there:**

```
SafeRoute App
      |
Nginx / reverse proxy (TLS termination, load balancing)
  — see deploy/nginx.saferoute.conf.sample —
      |
Multiple backend instances (this codebase, horizontally scaled,
all pointed at the SAME REDIS_URL)
      |
Self-hosted GraphHopper (Phase G — regional OSM data, Phase H)
```

Still required beyond this phase, in rough order:
1. A real VPS/server (not a student laptop) to host the backend + GraphHopper
2. Self-hosted GraphHopper running against the Sikkim+Kalimpong OSM extract
   (removes GraphHopper cloud's free-tier bottleneck entirely)
3. Deploy `deploy/nginx.saferoute.conf.sample` (fill in real domain/TLS)
   in front of multiple backend instances
4. Provision a real Redis (managed, e.g. Upstash/Redis Cloud/ElastiCache,
   or self-hosted) and set `REDIS_URL` identically on every instance —
   the application code is now ready for this; the infrastructure isn't
   provisioned yet
5. Basic uptime/error monitoring (scrape `/metrics`) and backups
6. Run `npm run loadtest` against the real multi-instance deployment at
   realistic concurrency to size actual server resources — 700,000
   *registered* users is not 700,000 *simultaneous* requests, and the
   right server spec depends on the real concurrency number, not the
   total user count

Steps 1, 2, 3, 5 are not built yet. Step 4's application code is ready;
the actual Redis instance is not provisioned. Step 6's script exists
but has not been run.

## What this phase deliberately did NOT touch

- `HelloWorld.html` routing logic/parsing — untouched (see final report)
- Flutter UI, GPS, TTS, hazard/weather/emergency features — untouched
- Distributed in-flight request de-duplication across instances —
  intentionally left per-instance (see `services/graphhopper.js` for
  the reasoning)
- Database readiness / queue architecture — this backend is currently
  stateless (routing proxy + cache only, no persistent data model), so
  there is no database to make "ready" yet; a queue would only be
  needed once a genuinely async workload exists (none does yet)