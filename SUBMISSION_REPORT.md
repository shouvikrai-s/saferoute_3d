# SafeRoute 3D Final Evidence-Based Submission Audit

## 1. Scope and actual repository state

This audit was performed directly against the repository at `C:\projects\saferoute_3d` and the live files in the project rather than a hypothetical design.

Verified artifacts currently present:
- Processed flood series: `backend/data/processed/flood_normalized.json`
- Dataset inventory: `backend/data/processed/dataset_inventory.json`
- Trained model artifact: `backend/data/model-artifacts/saferoute-flood-baseline-0.2.0.json`
- Training script: `backend/scripts/train-flood-model.js`
- Flood model service: `backend/services/floodModel.js`
- Monitoring API: `backend/routes/monitoring.js`
- Submission report: `SUBMISSION_REPORT.md`
- Startup guide: `SUBMISSION_STARTUP_GUIDE.md`
- UI entry: `assets/cesium/Apps/HelloWorld.html`

The project is not a Git repository in this environment (`git status` returned not a git repo), so the audit was performed against the working files directly.

## 2. Data provenance and quality inspection

The raw inventory indicates the actual available datasets include:
- Sikkim flood discharge CSV in `backend/data/raw/open meteo/sikkim flood data .csv.csv`
- Open-Meteo weather data in `backend/data/raw/isro_nrsc/open-meteo-27.38N88.59E1588m.csv`
- Hazard PDF references and historical geospatial documents under `backend/data/raw/...`

Validated processed flood data quality checks:
- 6 locations and 372 provider-derived discharge estimates spanning 2026-09-09 through 2026-11-09
- Units retained in m3/s
- The dataset contains future-dated values relative to the audit date (2026-10-11); these are excluded from training and monitoring inputs
- The source is not verified in-situ river-gauge telemetry and is not an official flood-warning feed
- The weather CSV is a downloaded archive, not the app's live runtime feed; the parser now correctly reads its separate metadata and hourly-data sections
- No labels or events were fabricated

## 3. Reproducible training and evaluation workflow

Executed commands:
- `node scripts/process-datasets.js`
- `node scripts/train-flood-model.js`
- `node --test test/*.test.js`

Actual output (2026-10-11):
- `Flood model trained successfully: C:\projects\saferoute_3d\backend\data\model-artifacts\saferoute-flood-baseline-0.2.0.json`
- `MAE: 9.098 m3/s`
- `Baseline MAE: 2.651 m3/s`
- `Relative improvement: -243.25%`
- Model version 0.2.0 excludes records after the UTC as-of date and evaluates every sample in the chronological holdout
- The model is substantially worse than the naive baseline and must not be used for safety decisions

## 4. Evaluation methodology

The model uses a chronological 70/30 holdout separately per location, with lag-1 and trailing 7-day mean features in m3/s. Dates after the as-of date are removed before splitting, and the first holdout day is now evaluated using the preceding training history. However, the values are provider-derived estimates rather than independent gauge measurements; this holdout is not independent real-world validation and does not establish flood-prediction skill.

## 5. Actual flood-model metrics

Verified persisted results in `backend/data/model-artifacts/saferoute-flood-baseline-0.2.0.json`:
- Baseline MAE: 2.6505 m3/s
- Trained-model MAE: 9.0978 m3/s
- Improvement relative to baseline: -243.2491%
- Training input window: 2026-09-09 through 2026-10-11; 6 locations, 33 eligible dated records per location

Interpretation:
- The trained model is much weaker than the baseline on these provider-derived estimates.
- The baseline remains the default benchmark for comparison.
- The learned model remains experimental and must not be presented as verified AI, live gauge monitoring, or reliable flood warning capability.

## 6. Backend test execution

Executed command:
- `node --test test/*.test.js`

Actual outcome after the dataset parser, date cutoff, and provenance changes: 17 passed, 0 failed (`node --test test/*.test.js`).

Passed coverage includes:
- feature rule validation
- traffic model non-fabrication checks
- dataset inventory checks
- flood-normalized output validation
- flood model artifact loading, inference, invalid-input rejection, and missing-artifact handling

## 7. Monitoring API and UI audit

The project server was started using the repository’s Node runtime and checked locally on `http://127.0.0.1:3000`.

Observed health response:
- `GET /health` returned HTTP 200 at `2026-10-11T06:45:25Z`; PostgreSQL and Redis both reported connected, and routing reported self-hosted configuration.
- `GET /api/monitoring/status` returned HTTP 200 without a client credential at `2026-10-11T06:45:22Z`. The earlier 401 was caused by a mismatch between the credential embedded in the browser and the server environment; browser-shipped credentials are not secret, so client-key enforcement was removed from the public app APIs while input validation and per-IP rate limiting remain.
- The browser AI Monitor displayed the backend traffic, weather, flood, and dam states and flood summary matching the direct API response; the browser/API comparison returned `true` for all four checks. No 401 was displayed.
- No TomTom upstream tile request was made during this pass because it may consume paid provider quota; credential validity, tile decoding, and live traffic rendering remain unverified.
- Traffic is `CONFIGURED`, not `LIVE`; backend weather is `UNAVAILABLE`; flood is `MODEL` with classification `UNKNOWN`; dam is `UNAVAILABLE`.

The app also includes honest monitoring logic that preserves:
- experimental model result (`MODEL` or contextual forecast)
- no verified official dam feed (`UNAVAILABLE`)
- clear distinction between model output and observations/official alerts

The UI remains conservative and does not present the flood model as a live warning or official sensor reading.

## 8. Live services verified versus unavailable

Verified:
- Backend health endpoint responds successfully on `http://127.0.0.1:3000/health`
- Redis is connected and PostgreSQL accepts queries in the local runtime
- SafeRoute 3D page loads with the 2D-first UI and AI Monitor affordances in the browser
- Known place search fallback resolves Sikkim locations such as Rangpo, Gangtok, Singtam, Namchi, Mangan, Yuksom, Lachen, Lachung, and NH-10 to valid coordinates in the current app logic
- GraphHopper self-hosted configuration is present and the server health reports self-hosted routing readiness in this environment

Unavailable or not configured:
- Official dam/reservoir feed: not configured; dam remains `UNAVAILABLE`
- Verified live flood alert feed: not configured; flood remains contextual/experimental, not official
- Traffic provider: a TomTom key is configured server-side, but upstream authentication, tile response/schema, decoding, and rendering were not verified in this pass; status remains `CONFIGURED`, not `LIVE`
- `http://192.168.1.5:3000` did not respond from this execution environment, indicating a LAN/firewall/network restriction outside the app code itself; the backend is listening on `0.0.0.0:3000` locally, but the LAN address is not reachable from this environment
- No government flood certification or official operational warning capacity was demonstrated

## 9. Verified application checks

The browser page was checked for the expected UI elements and map-mode affordances. The app exposes the expected 2D-first layout and 3D background/load path while preserving the monitoring/flood labels as contextual rather than official.

The browser automation specifically validated the search fallback and known-place selection behavior for `Rangpo` and a set of Sikkim locations, confirming the app resolves them to valid coordinates and updates the selection state without fabricating unsupported results.

The current local browser showed `2D map ready · 3D map ready`. The browser-side Open-Meteo current-precipitation panel displayed `LIVE`, `0.0 mm`, with a data age of 62 seconds at `2026-10-11T06:45:01Z`. This is precipitation context, not an official weather alert or flood observation. The API/browser monitoring comparison returned HTTP 200 with matching states and summaries and no 401. OpenStreetMap Overpass place requests returned HTTP 406 (non-fatal); the map continued rendering. Full phone-device and external-provider validation was not possible here.

## 10. Remaining blockers and honest limitations

1. No verified official flood or dam feed is configured.
2. The trained flood model is experimental only and underperforms the baseline on provider-derived estimates; no independent gauge validation exists.
3. Traffic remains intentionally not trained unless legitimate, evaluated traffic data becomes available.
4. A tested route request returned no usable route geometry (`fallback: true`); this is not a successful route calculation. A valid nearby query returned HTTP 200 with zero records.
5. No production readiness, official warning certification, or operational flood decision support has been established.
6. Complete real-world device validation beyond the local browser automation environment was not possible here.

## 11. Final submission statement

SafeRoute 3D includes a reproducible provider-derived discharge estimate workflow, a versioned experimental artifact, conservative monitoring integration, and honest UI/backend labeling. It does not claim verified live gauge monitoring, official flood prediction, live dam status, or certified operational readiness. The trained model is substantially worse than the naive baseline and has not been independently validated against gauges.

## 12. Audit update: future-date and weather parsing corrections (2026-10-11)

- Fixed the flood training/monitoring path to exclude records later than the current UTC as-of date. The provided series extends through 2026-11-09, so its later records are not treated as current observations.
- Versioned the changed flood artifact as `SafeRouteFloodBaseline 0.2.0`; the previous 0.1.0 artifact is retained and not overwritten.
- Corrected chronological holdout evaluation to include the first holdout day using prior training history.
- Corrected the weather CSV parser to read its metadata and hourly-data sections separately. The prior parser mistakenly treated the header row as a data point and produced null metrics; regenerated inventory now contains 840 dated, numeric hourly rows. This archived CSV is explicitly not the app's live runtime feed.
- Added tests for numeric weather values/timestamps, future-date exclusions, invalid as-of dates, monitoring input freshness, and unverified inference provenance.
- Flood inference now reports unverified input provenance and `MODEL` source status. Monitoring does not claim freshness for estimated inputs; `freshness` remains null and the input date is separate as `inputDataAsOf`.
- Validation commands: `node scripts/process-datasets.js`; `node scripts/train-flood-model.js`; `node --test test/*.test.js`.
- Regression result: 17 tests passed, 0 failed.
- Artifact metrics remain poor: model MAE 9.0978 m3/s vs persistence baseline 2.6505 m3/s (-243.2491% improvement). Do not deploy for safety decisions.
- Live feed blockers remain: TomTom credentials are configured but no upstream request was made, and no verified official flood/discharge, dam/reservoir, or hazard/closure feed is configured. The app's live rainfall status is only contextual Open-Meteo weather, not a disaster alert.

## 13. Follow-up implementation and end-to-end verification (2026-10-11)

This section supersedes the earlier HTTP 401 statements in Sections 7 and 9. The app no longer ships a `SAFEROUTE_CLIENT_KEY` or sends `X-SafeRoute-Client-Key`; browser-facing APIs rely on rate limiting and endpoint validation. The optional client-auth middleware is documented for confidential server-to-server callers only. The displayed weather unit was corrected from `mm/hr` to the Open-Meteo response unit `mm`.

### Current feature status

| Feature | Status | Evidence and limitation |
|---|---|---|
| 2D-first map and 3D readiness | PASS | Browser opened `assets/cesium/Apps/HelloWorld.html`; UI reported `2D map ready · 3D map ready`. This verifies local startup/readiness indicators, not every device or terrain tile. |
| Monitoring API and AI Monitor | PASS | Local `GET http://127.0.0.1:3000/api/monitoring/status` returned HTTP 200 without a client secret. At `2026-10-11T06:45:22Z`, browser-visible traffic/weather/flood/dam states and the flood summary matched the API response; no 401 was displayed. |
| Browser Open-Meteo precipitation | PASS (limited) | Browser displayed current precipitation as `0.0 mm`, status `LIVE`, age 62s at `2026-10-11T06:45:01Z`. Source: `https://api.open-meteo.com/v1/forecast` with current `precipitation`; contextual weather only, not flood/dam telemetry or an official alert. Backend weather remains `UNAVAILABLE`. |
| TomTom live traffic | UNVERIFIED | Server-side credential is configured, but no provider request was made. Endpoint/schema, authentication, vector-tile decoding, relative-speed validation, provider timestamps, caching/freshness, and both 2D/3D rendering have not been verified. UI correctly showed traffic `UNAVAILABLE` due to no fresh validated samples. |
| Traffic AI | BLOCKED | `SafeRouteTrafficKMeans v0.1.0` artifact explicitly has `status: not_trained`, empty centers, and no measured evaluation. `train-traffic-model.js` leaves it untrained without a dataset. No legitimate, licence-cleared traffic training data was established. |
| Flood/discharge AI | MODEL ONLY / EXPERIMENTAL | Artifact `backend/data/model-artifacts/saferoute-flood-baseline-0.2.0.json`; provider-derived input estimates for six locations through `2026-10-11`, not verified gauge observations. Holdout MAE 9.0978 m3/s versus persistence MAE 2.6505 m3/s (-243.2491% improvement). Backend returns `MODEL` but classification `UNKNOWN`, and the result is not eligible to generate a warning. |
| Official flood/river feed | BLOCKED | No verified official live flood or discharge provider is configured; API reports unavailable. The bundled Open-Meteo-derived discharge series is not an independently verified gauge feed. |
| Dam/reservoir monitoring | BLOCKED | No live level, release, discharge, or gate-status feed is configured; API reports `UNAVAILABLE`. Static dam markers are references only. |
| Hazard / road-closure / emergency alerts | UNVERIFIED | Two dated hazard reference zones are loaded and shown as `STALE`; no current incident or closure provider is connected. Official SACHET/SSDMA links are external links, not ingested feeds. |
| Landslide screening | MODEL/INFERRED ONLY | Rainfall and dated hazard references can be contextual inputs, but no verified live landslide observation or validated prediction provider exists. UI does not present a landslide warning. |
| Routing | FAIL for tested request | Observed route API response was HTTP 200 with `fallback: true` and no usable geometry. GraphHopper is configured, but the tested path did not establish successful end-to-end route geometry or overlay rendering. |
| Nearby resources / Explore | UNVERIFIED | Valid nearby API query returned HTTP 200 with zero rows. Built-in hospitals/police/dam places are dated references. OSM Overpass returned HTTP 406 at `2026-10-11T06:44:51Z` and `06:45:02Z`; failure was logged as non-fatal. |
| PostgreSQL, Redis, backend health | PASS (local process) | `GET /health` at `2026-10-11T06:45:25Z` reported status `ok`, PostgreSQL connected, Redis connected, and self-hosted routing configured. This is a local health check, not a deployment/restart or persistence test. |
| GPS / device bridge | UNAVAILABLE | AI Monitor reported no GPS fix from the device bridge in browser verification. |

### Coverage and provenance

The app includes geographic reference/search entries for Sikkim locations and NH-10, while Darjeeling and Kalimpong are identified as West Bengal. Map/search presence is not provider coverage. The browser-side precipitation locations are limited to Gangtok, Namchi, Gyalshing, Mangan, and Chungthang; no claim is made that all listed towns or NH-10 have live weather, traffic, river, hazard, or dam monitoring.

Raw project discharge/weather files include archived or provider-derived data. They are not represented as observed live measurements. No government approval, official warning service, independently validated safety model, or production readiness is established.

### Commands and repeatable evidence

- Backend regression: `Set-Location C:\projects\saferoute_3d\backend; npm.cmd test` — 19 passed, 0 failed, 0 skipped at `2026-10-11T06:44Z`.
- Health: `Invoke-WebRequest http://127.0.0.1:3000/health` — HTTP 200; PostgreSQL and Redis connected.
- Monitoring: `Invoke-WebRequest http://127.0.0.1:3000/api/monitoring/status` — HTTP 200 with no client credential.
- Browser: open `file:///C:/projects/saferoute_3d/assets/cesium/Apps/HelloWorld.html`, open AI Monitor, and compare backend rows with the monitoring response. Local browser snapshot showed map readiness, current client-side precipitation, and source/status labels.
- Current API state at `2026-10-11T06:45:22Z`: traffic `CONFIGURED`; backend weather `UNAVAILABLE`; flood `MODEL` / classification `UNKNOWN`; dam `UNAVAILABLE`.

## 14. Raw data integration and verification (2026-10-11)

This update supersedes the older statement that the raw data was only inventoried. The source files were fingerprinted, suitable structured records were normalized without changing the original files, historical rows/events were imported into additive PostgreSQL tables, new read-only APIs were exercised, and the current SafeRoute app was wired to display the archive assessment and optionally map historical earthquakes. Historical archive results remain visually and semantically separate from live observations.

### Actual backend data inventory

The source inventory is generated by `backend/scripts/process-datasets.js` and stored in `backend/data/processed/dataset_inventory.json`. At processing time `2026-10-11T07:16:04Z`, it found **9 raw files** under `backend/data/raw`; each inventory row includes byte size and SHA-256. These source files were not edited.

| Dataset/file | Actual details and processing result |
|---|---|
| `backend/data/raw/isro_nrsc/open-meteo-27.38N88.59E1588m.csv` | Open-Meteo hourly weather archive at 27.38137, 88.59218, 1588 m. **840** hourly records, `2026-09-04T00:00`–`2026-10-08T23:00`; timezone metadata GMT; precipitation/rain mm, temperature °C, gusts km/h. Normalized to `backend/data/processed/weather_normalized.json`, inserted as `historical_weather_archive`, not current weather measurements. It is located in an `isro_nrsc` folder but the file's data provenance identifies Open-Meteo, not an ISRO telemetry feed. |
| `backend/data/raw/open meteo/sikkim flood data .csv.csv` | Open-Meteo provider-derived daily discharge estimates at **6** points, **372** records, `2026-09-09`–`2026-11-09`, units m³/s. `198` dates through the current as-of date were inserted as `historical_model_estimate`; `174` future-dated values (`2026-10-12`–`2026-11-09`) were separated as `forecast_estimate`. Neither class is verified gauge telemetry. Normalized locations/series are at `backend/data/processed/flood_normalized.json`. |
| `backend/data/raw/ssdma/Earthquake_DATA_New sikkim.pdf` | Four-page historical table. Parser accepted **59** records with date/time, latitude, longitude, depth and magnitude; all 59 have coordinates. Source dates range `2006-02-03`–`2019-04-12`; source time column says UTC. They are archived earthquake references, not current alerts. |
| `backend/data/raw/ssdma/hISTORY_FOREST_FIRE sikkim.pdf` | Seventy-page historical table. Parser accepted **539** dated source entries; valid normalized dates range `2004-02-16`–`2014-04-24`. No coordinates are supplied, so none were invented and none appear as map points. One source string `20/3/0211` is retained as text with `eventDate: null` and `SUSPECT_SOURCE_DATE`; it is not silently corrected. |
| `backend/data/raw/isro_nrsc/Sikkim_Landslide_2016.pdf` | Three-page 2016 “So Bhir” historical report (Mantam/North Sikkim, event date 2016-08-13); text is extractable, but it is narrative rather than a consistently structured geospatial event table. It remains a cited reference, not an active incident or machine-geocoded map point. |
| `backend/data/raw/isro_nrsc/LandslideAtlas_new_2023.pdf` | 93-page ISRO/NRSC Landslide Atlas of India (February 2023). It is catalogued as a document/reference; this pass did not extract individual Sikkim event geometries or use atlas statistics as current conditions. |
| `backend/data/raw/ssdma/HISTORY_LANDSLIDE sikkim.pdf` | 91 pages; no extractable text from the inventory's page sample. It remains unparsed reference material. |
| `backend/data/raw/ssdma/HISTORY_LANDSLIDE south.pdf` | Same 22,119,540-byte file as `HISTORY_LANDSLIDE sikkim.pdf`; SHA-256 fingerprints are identical (`9602def9…b3ce73c0`). It is catalogued, not double-counted as independent evidence. |
| `backend/data/raw/india_wris/India-WRIS tista river.pdf` | Three-page capture of India-WRIS river-information website, not a time series/API response. No river stage, discharge, reservoir measurement or update feed was extractable; it is reference-only. |

The following non-raw routing assets were also found: `backend/data/sikkim-kalimpong.osm.pbf` and three PBFs under `backend/data/replacement-20261010/` (north-east source, east-zone source and expanded Sikkim network). `backend/data/README.md` documents the generated road graph extent (`87.875477..89.170252 E`, `26.389662..28.205434 N`) and 68,881 highway ways in the expanded extract. This supports road routing/map coverage, not current traffic speeds, closures, or observed traffic. The map's OSM basemap and routing graph are reference/network data.

### PostgreSQL and API integration

Added the idempotent migration `backend/migrations/001_historical_observations.sql` and transactional loader `backend/scripts/load-historical-data.js`. The loader creates separate additive tables `saferoute_historical_observations` and `saferoute_historical_events`, then upserts records by stable source-derived IDs. Existing resource/routing tables and source files were not deleted or rewritten.

Command `Set-Location C:\projects\saferoute_3d\backend; npm.cmd run process:data; npm.cmd run load:historical-data` completed at `2026-10-11T07:16Z`. PostgreSQL reported:

- 840 hourly archive-weather records
- 198 past-dated provider-derived discharge estimates
- 174 future-dated discharge forecasts, separately typed
- 59 dated/geolocated historical earthquakes
- 539 historical fire-document entries, 0 geolocated
- Total inserted/upserted: 1,212 weather/discharge observations and 598 document events

Backend restarted with the new routes on port 3000; live API checks around `2026-10-11T07:17Z` returned HTTP 200 for `GET /api/data/catalog`, both `GET /api/data/history?dataset=weather|discharge&limit=2`, `GET /api/data/events?type=earthquake|forest_fire&limit=2`, and `GET /api/data/assessment?lat=27.3389&lon=88.6065`. Validation checks for an unsupported dataset, missing assessment coordinates, and unsupported event type return HTTP 400. History responses include original timestamp, normalized UTC timestamp when known, record type, source path, provenance, processing time and measurement units/values. Discharge forecasts are excluded by default and included only on explicit `includeForecast=true`.

The Gangtok-coordinate archive assessment was generated at `2026-10-11T07:17:33Z`, separately from source record times. The nearest weather point is about 4.93 km away and summarizes 840 archived hours (`2026-09-04`–`2026-10-08`): mean hourly precipitation 0.465 mm, max hourly precipitation 8.8 mm, total archive precipitation 390.3 mm, mean temperature 18.88 °C. The nearest discharge point is about 2.39 km away and summarizes 33 past-dated model-estimate records (`2026-09-09`–`2026-10-11`): mean estimated discharge 4.065 m³/s, maximum 6.52 m³/s. These are descriptive historical statistics, not a forecast, risk score, gauge measurement, or live reading.

### Application wiring and geographic limitations

- AI Monitor now shows archive load status/counts and a per-viewport `HISTORICAL ARCHIVE ASSESSMENT` with its assessment timestamp, source date range, nearest source distance, and explicit archive/model estimate labels. A failed API stays unavailable rather than rendering an empty/success-shaped result.
- Map Controls now contains a default-off `Historical earthquake references` layer. When enabled, it loads the SSDMA event API and displays historical markers in the 2D SVG overlay and Cesium 3D view. Markers are labeled with date/magnitude and “HISTORICAL”; they are explicitly not current alerts. Forest-fire events have no coordinates and are not mapped.
- The app exposes reference locations for Gangtok, Pakyong, Namchi, Soreng, Gyalshing and Mangan, plus the previously audited Sikkim towns/NH-10. This inventory did **not** find six district-specific measurement datasets or administrative boundary GeoJSON/shapefiles/GeoPackages. Consequently there is no verified district polygon coverage, and point records are not assigned to districts by guesswork. Darjeeling and Kalimpong remain labeled West Bengal.
- Flood forecasting remains unfit for warnings: the persisted model still underperforms the persistence baseline. Traffic remains not trained and no TomTom fetch was performed. No official live Sikkim flood, dam, river, landslide, incident, or closure feed was added by these archives.

### Verification

- `npm.cmd run process:data` — completed; 6 discharge locations, 372 discharge records, 840 weather records, 598 parsed historical event rows.
- `npm.cmd run load:historical-data` — completed; 1,212 observations and 598 events upserted; SQL grouped counts/date ranges agree with the source processing results.
- `npm.cmd test` — **23 passed, 0 failed, 0 skipped** after adding event parsing/provenance, suspect-date, history-query validation and public-route validation tests.
- `node --check scripts/process-datasets.js`, `node --check scripts/load-historical-data.js`, `node --check services/historicalData.js`, `node --check routes/data.js`, `node --check server.js` — passed.
- Browser at `file:///C:/projects/saferoute_3d/assets/cesium/Apps/HelloWorld.html` continued to report `2D map ready · 3D map ready`. AI Monitor rendered 840 weather records, 198 historical discharge estimates, 59 earthquake references, 539 forest-fire records, and a computed archive-only assessment sourced through PostgreSQL-backed APIs. Browser `fetch` to catalog and assessment returned HTTP 200.
- Backend restarted on `0.0.0.0:3000`; its new routes are served by the current process. The app remains 2D-first; no startup-mode change was made.

Remaining limits: the external Overpass provider has previously returned HTTP 406; no boundary/district datasets were present; most historical PDFs are not reliable event tables (two landslide PDFs have no extractable text and are byte-identical); no original source document has been OCR-geocoded; and historical/model-derived data do not make any monitoring feed live or establish a safety warning capability.

## 15. CWC river-discharge snapshot integration (2026-10-11)

### Source inspection and provenance

- Actual source: `backend/data/raw/cwc/cwc sk2026-2030.csv` (5,198,261 bytes; SHA-256 `468e5f020750e2370408c269b3d9e3c6906145796b9be95d60f97a83e46e4cba`). The original CSV was read only and left unchanged.
- The CSV header identifies `Agency=CWC`, Sikkim and a “Telemetry Hourly River Water Discharge (m3/sec)” field. No source URL, timezone field, file version history, or live CWC polling endpoint is supplied with this local copy. It is therefore described as a **CWC-labelled snapshot**, not an independently authenticated or live CWC feed.
- 45,061 source rows contain 43,829 accepted discharge records across three stations. **1,232** rows have a missing/non-numeric/negative discharge value and are excluded from numeric API/overlay records. Timestamps and coordinates validated for every accepted row; there are no duplicate station/timestamp pairs. Station coordinates are constant per station. No source rows name a river: the River field is `-` for all rows, so the UI does not infer Teesta or another river name.
- The source column is titled “hourly”, but consecutive sample timestamps show 15-minute sampling in ordinary intervals and occasional longer gaps. The persisted source timestamps are left exactly as supplied; UTC conversion explicitly assumes India Standard Time (`UTC+05:30`) because the source CSV does not specify a timezone. Both the unmodified source timestamp and normalized UTC timestamp are returned.
- Valid source date coverage is **2026-01-01 00:00 through 2026-08-08 08:45** in the assumed IST interpretation. Normalized UTC range: `2025-12-31T18:30:00Z` through `2026-08-08T03:15:00Z`.
- The local file modification time is `2026-10-11T07:39:49Z`, later than the latest valid sample by roughly two months. This filesystem timestamp does not advance any observation time and does not establish that the feed updated.

| Station | CSV district | Coordinates (lat, lon) | Accepted rows | Latest valid source reading |
|---|---|---|---:|---|
| Bakcha_1 | NORTH DISTRICT | 27.41749167, 88.63019722 | 12,516 | 42.87 m³/s at `07-07-2026 23:45` (normalized `2026-07-07T18:15:00Z`) |
| Melli_1 | NAMCHI | 27.08527778, 88.49926667 | 18,853 | 1,204.92 m³/s at `08-08-2026 08:45` (normalized `2026-08-08T03:15:00Z`) |
| Singtam_2 | GANGTOK DISTRICT | 27.23138889, 88.46643889 | 12,460 | 52.89 m³/s at `07-07-2026 23:45` (normalized `2026-07-07T18:15:00Z`) |

### Processing, persistence, and API

- `npm.cmd run process:data` generated `backend/data/processed/cwc_river_observations.json`, updated the recursive raw inventory and recorded the source hash, source-file mtime, source row count, accepted/invalid counts, station metadata, units and explicit timestamp/update limitations. The processor rejects invalid timestamps/coordinates/agency/state, non-numeric or negative discharge, and duplicate station/timestamp pairs; no invalid values are clamped or guessed.
- `npm.cmd run load:historical-data` applied the additive `002_cwc_river_observations.sql` migration and transactionally upserted the valid rows into `saferoute_historical_observations` as `dataset_id=cwc_river_observation`, `record_type=cwc_reported_discharge`. PostgreSQL returned 43,829 CWC records, three station coordinates, and the same UTC time range. Repeatable stable IDs make imports idempotent.
- `GET http://127.0.0.1:3000/api/data/catalog` returned HTTP 200 and reported 43,829 database-loaded CWC records, three locations, source row/valid/invalid counts, source hash and `sourceUpdatesVerified:false`.
- `GET http://127.0.0.1:3000/api/data/river-observations` returned HTTP 200 at `2026-10-11T08:10:56Z`, status `STALE`, three latest-per-station records, `latestObservedAtUtc=2026-08-08T03:15:00Z`, and `sourceUpdatesVerified:false`. At that check, Melli’s sample was about 64 days old; Bakcha and Singtam were about 95 days old. All were `STALE` against the six-hour threshold. A source snapshot that is within the threshold is classified `RECENT_SNAPSHOT_NOT_LIVE`, never `LIVE`.
- `GET /api/data/history?dataset=cwc&start=2026-08-08&end=2026-08-08&locationId=2&limit=3` returned HTTP 200 with three Melli records from the requested end date. This also verified inclusive end-date filtering for timestamped records. Unsupported datasets and `limit=0` both returned HTTP 400. Unit tests cover unavailable/missing, stale, recent-but-not-live, and future timestamps.
- `GET /health` returned HTTP 200 with PostgreSQL connected. The current database count is 43,829 CWC observations; no cache is used for this archive history endpoint.

### App integration and browser checks

- AI Monitor now displays a `CWC RIVER OBSERVATIONS · STALE` row with latest station values, source and normalized timestamps, freshness age, source file path/mtime, invalid-row count, timezone assumption, and the explicit unverified-update limitation. It distinguishes the CWC CSV from Open-Meteo modeled discharge and does not call it dam/reservoir state or an official flood warning.
- Map Controls adds a default-off `CWC river discharge stations` layer. Enabling it loads only the three latest validated station readings and draws labeled, gray/stale markers in both 2D and Cesium 3D. The 2D map shows station, value, units and `STALE`; marker titles and AI Monitor retain source-time/provenance details. The existing historical-earthquake layer behavior was preserved.
- Browser reload continued to start in 2D and reported `2D map ready · 3D map ready`. Enabling the station layer produced three 2D markers with readable station/value/freshness labels. In 3D, focusing the camera on Melli displayed `Melli_1 · 1204.9 m³/s · STALE`. The AI Monitor showed all three station readings, timestamp ages, and provenance limitations. No startup overlay load was added; the CWC API request occurs only after the user enables the optional layer or opens AI Monitor.
- External-provider side effects during the browser check included non-fatal Overpass HTTP 406 errors; map rendering and CWC API calls continued. Some Open-Meteo current-weather requests timed out during this reload, unrelated to CWC processing.

### Status and remaining limits

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Discover, validate and preserve downloaded CWC file | PASS | Actual local path/hash, 45,061 rows, 43,829 valid records, three station names/coordinates and source data range verified; source unchanged. |
| Normalize/import CWC history | PASS | Generated processed artifact and PostgreSQL rows; 43,829 imported, stable on repeat load. |
| CWC API, query filtering and freshness | PASS (snapshot only) | Catalog, latest station API and bounded history return correct HTTP 200 responses; invalid requests return 400; all latest station records correctly classify `STALE`. |
| AI Monitor and 2D/3D map overlay | PASS (snapshot display) | Browser displayed source timestamps/values and three correctly labeled station markers; layer is optional/default-off and retains 2D-first startup. |
| Current live CWC updates | UNVERIFIED / NOT CONNECTED | Only a local file snapshot exists. No source URL/API credentials, polling, subsequent version or update evidence was available. Filesystem modification time is not proof of a new measurement. |
| River identity | UNAVAILABLE IN SOURCE | River/Basin fields are `-`; no river name is inferred. |
| Dam, reservoir, flood warning or predictive model | NOT PROVIDED BY THIS DATASET | It contains discharge measurements only. No gates, reservoir levels, warning thresholds, official alerts or independently validated prediction model are inferred from these readings. CWC values are exposed to historical analysis APIs but were not used to retrain or change the underperforming flood model. |

### Validation commands

- `npm.cmd run process:data` — passed; 45,061 raw rows, 43,829 valid, 1,232 invalid, three stations.
- `npm.cmd run load:historical-data` — passed; 43,829 CWC rows plus the existing historical archives/events upserted.
- `npm.cmd test` — **25 passed, 0 failed, 0 skipped** after CWC processing, freshness and API validation changes.
- `node --check` on `scripts/process-datasets.js`, `scripts/load-historical-data.js`, `services/historicalData.js`, and `routes/data.js` — passed. All three inline browser scripts also compiled successfully.

## 14. Final browser verification and earthquake-layer toggle fix (2026-10-11)

### Confirmed implementation defect and correction

Browser inspection found that the historical-earthquake Map Controls toggle was controlling Cesium entity visibility but not the 2D SVG overlay. The layer was also not explicitly hidden on initial page load, so markers could appear despite the control reading `Hidden`. The source HTML now initializes the SVG group hidden and the shared layer-toggle function applies visibility to both the 2D group and Cesium entities. This does not change the layer's default-off behavior or its historical-only labeling.

### Evidence collected

- Browser reload at `file:///C:/projects/saferoute_3d/assets/cesium/Apps/HelloWorld.html` started in 2D and reported `2D map ready · 3D map ready`.
- A second reload at `2026-10-11T07:33:20.982Z` directly confirmed 2D mode, Cesium readiness, monitoring `CONNECTED`, and the default-off earthquake layer (`display:none`, zero markers before enabling).
- With the layer initially `Hidden`, the 2D SVG group was `display:none`. After enabling it, browser DOM inspection found 59 event markers and the group became visible. Hiding it again changed the group back to `display:none`; re-enabling retained all 59 markers. The API-backed records are dated SSDMA historical earthquake references, not current alerts.
- Switched to 3D with the historical layer enabled; the UI reported `3D map active · 2D state preserved`. The same toggle function sets visibility on the loaded Cesium entities. This verified 3D mode/readiness and the entity visibility code path; it does not establish coverage outside loaded historical records or prove every marker is in the current camera view.
- `GET http://127.0.0.1:3000/api/data/events?type=earthquake&limit=100` returned HTTP 200 with 59 geolocated events; example source date `2019-04-12`. Retrieval was checked at `2026-10-11T07:26:57.763Z`. API event records retain historical source dates; retrieval time is not represented as an event observation time.
- `GET http://127.0.0.1:3000/api/monitoring/status` returned HTTP 200 at `2026-10-11T07:30:36.092Z`. It reported traffic `CONFIGURED`, flood `MODEL`, and dam `UNAVAILABLE`; the browser's most recent monitoring poll (`2026-10-11T07:27:11.839Z`) displayed the same three states. Traffic `CONFIGURED` is not verified live traffic, and flood `MODEL` remains non-warning contextual output.
- The earlier transient browser monitoring timeout did not recur in this verification; the browser was `CONNECTED` at `2026-10-11T07:27:11.839Z`.
- `npm.cmd test` from `backend` after the UI fix: **23 passed, 0 failed, 0 skipped**. Browser script execution, map readiness, API fetch, and Map Controls interactions also completed without a JavaScript error. Non-fatal Overpass HTTP 406 errors continued to occur and remain an external places-data limitation.

No TomTom tile request was made; no live traffic validation is claimed. The earthquake references are historical and do not imply a live seismic feed. The map remains 2D-first, and neither these changes nor the successful checks establish government approval, a validated safety-critical model, or production readiness.

## 15. Owner-directed welcome, CWC freshness, and deployment check (2026-10-11)

### Welcome screen implementation

- Updated `assets/cesium/Apps/HelloWorld.html` with a branded first-screen dialog containing the requested SafeRoute 3D title, creator and owner/director identity, regional focus, exact description, and **Enter SafeRoute 3D** action.
- The dialog is layered above the existing page; the 2D map and background Cesium initialization are not gated by the welcome interaction. Dismissal is remembered using a single local-storage boolean. The existing reduced-motion rule applies, the dialog has a labelled modal role, and the keyboard focus handler keeps Tab within the visible dialog.
- Browser inspection at `file:///C:/projects/saferoute_3d/assets/cesium/Apps/HelloWorld.html` showed the exact requested text, focused the Enter button, and reported `2D map ready · 3D map ready` behind the dialog. The rendered desktop browser was approximately 714 × 607 pixels.
- **Acceptance status:** welcome content and map initialization are verified. The subsequent keyboard interaction test moved focus to the Explore navigation and opened its panel; it did not reliably exercise the Enter button. The focus handling was tightened afterward, but that final keyboard change was not reloaded in the browser. Mouse/touch activation, a returning-user reload, and a real mobile viewport remain **UNVERIFIED**. No screenshot file was saved; the browser URL and DOM text above are reproducible evidence.

### CWC observation freshness recheck

- The original source remains `backend/data/raw/cwc/cwc sk2026-2030.csv`, 5,198,261 bytes, SHA-256 `468e5f020750e2370408c269b3d9e3c6906145796b9be95d60f97a83e46e4cba`. Its modification time is `2026-10-11T07:39:49.190Z`; the modification time is not treated as an observation update.
- At `2026-10-11T08:42:00.948Z`, `GET http://127.0.0.1:3000/api/data/river-observations` returned HTTP 200, `status=STALE`, 43,829 valid rows from three stations, and `sourceUpdatesVerified=false`. Latest valid timestamps/values were Bakcha_1 `2026-07-07T18:15:00Z` (42.87 m³/s), Melli_1 `2026-08-08T03:15:00Z` (1,204.92 m³/s), and Singtam_2 `2026-07-07T18:15:00Z` (52.89 m³/s).
- The API check at `2026-10-11T08:10:56Z` documented the same latest source observation (`2026-08-08T03:15:00Z`); the later local API response shows no advancement. These are repeated reads of the local database, **not independent upstream retrievals**.
- The official India-WRIS River Basins portal, `https://www.indiawris.gov.in/wris/#/riverBasins`, was reachable (HTTP 200) and returned its general portal page. `https://cwc.gov.in` was also reachable (HTTP 200). Neither check identified an authorized, dataset-specific download/API endpoint for this CSV or exposed newer station observations. The CSV itself contains no source URL. Therefore the provider's update cadence and live updating status remain **UNVERIFIED / NOT CONNECTED**; no refresh/polling was added.
- The source still has three station locations rather than six-district coverage. It has no river names (source fields are `-`) and does not provide dam gate, reservoir-level, or warning data.

### Backend, model, browser, and deployment checks

- `GET /api/monitoring/status` returned HTTP 200 at `2026-10-11T08:41:58.946Z`: traffic `CONFIGURED`, weather `UNAVAILABLE`, flood `MODEL`, dam `UNAVAILABLE`. These states do not mean verified live traffic, flood warnings, or dam telemetry.
- `npm.cmd test` run at the project root failed because the root `package.json` has no `test` script. The correct command, `npm.cmd --prefix backend test`, passed **25 tests, 0 failures, 0 skipped** (duration 9.6 seconds). All four inline frontend script blocks passed `node --check` at `2026-10-11T08:41Z`.
- The project has no usable Git repository metadata: `git rev-parse --show-toplevel` failed and the `.git` directory is empty. `backend/docker-compose.yml` is a deployment template, not a configured hosting target; the backend README says self-hosted GraphHopper is not deployed. No production target, domain, or deployment credentials were found, so no deployment was attempted and no production URL is claimed.
- A client-side Cesium Ion access token is present in the frontend source and its `backend/dist/HelloWorld.html` build. Its value is intentionally omitted. Browser traffic also showed a provider credential on Google 3D tile requests. No token was rotated or altered because no owner-authorized replacement or provider restrictions were available, and removal could disable the existing token-backed 3D imagery. Treat the current client token as exposed: rotate/restrict it through the provider, then configure only an appropriately scoped browser token. **Deployment is blocked** until this is resolved and the production output is verified. The detected token was not copied into this report.
- Browser checks continued to log non-fatal OpenStreetMap Overpass HTTP 406 failures; map rendering continued. These remain an external Explore-data limitation.
- Flood model status and metrics are unchanged from Section 5: artifact 0.2.0 remains experimental and underperforms persistence (MAE 9.0978 versus 2.6505 m³/s). No retraining, warning promotion, or deployment was performed. The browser's page reload automatically initiated existing Google 3D tile requests; whether they were billable was not checked, and no deliberate paid-provider validation request was made.

### Current outcome

| Area | Status | Evidence |
|---|---|---|
| Welcome screen rendering | PASS | Browser showed exact requested content while the map initialized behind it. |
| Welcome action, keyboard/touch and mobile acceptance | UNVERIFIED | Browser focus test activated Explore instead of conclusively testing the CTA; mobile viewport was not exercised. |
| 2D-first/background 3D readiness | PASS (local browser) | UI reported `2D map ready · 3D map ready`; no production/device claim. |
| CWC imported snapshot | PASS (stale snapshot only) | HTTP 200, 43,829 records, three stations, source hash unchanged, all latest samples stale. |
| CWC upstream freshness/live refresh | UNVERIFIED / NOT CONNECTED | No dataset-specific authorized endpoint or later observations were found; local API reads do not prove upstream updates. |
| Current monitoring services | MIXED | API states: traffic `CONFIGURED`, weather `UNAVAILABLE`, flood `MODEL`, dam `UNAVAILABLE`. |
| AI flood warning capability | EXPERIMENTAL / NOT FOR WARNINGS | Persisted evaluation remains worse than persistence baseline; no retraining or promotion. |
| Credential/deployment readiness | BLOCKED | Client-side provider token needs owner rotation/restriction; no authorized deployment target or usable Git history. |

## 16. Follow-up: remove bundled 3D provider token and retest (2026-10-11)

- Removed the embedded Cesium Ion access token from `assets/cesium/Apps/HelloWorld.html`; regenerated `backend/dist/HelloWorld.html` with `npm.cmd --prefix backend run build:client`. Pattern checks against both app HTML files confirmed no literal Cesium Ion token assignment or Google API-key string. Credential values were not copied to logs or this report.
- Added an empty-by-default runtime hook, `window.__sr3dProviderConfig.cesiumIonAccessToken`, for an owner-supplied, browser-scoped provider token. No provider token is currently configured. `backend/README.md` documents the minimum-scope/referrer restriction requirement and now keeps the GraphHopper key backend-only in its sample route configuration.
- To prevent failing upstream authorization and preserve the existing 3D map controls safely, Google photorealistic mesh tiles and token-backed terrain are not requested unless a runtime token is supplied. Map Controls label terrain/buildings as unavailable. Cesium retains its WGS84 ellipsoid globe, route/marker/map overlays, and background readiness; no backend credential is exposed.
- Browser verification after the change: Cesium reported ready, switching to 3D changed status to `3D map active · 2D state preserved`, the 3D canvas became visible, and the 2D map was hidden only after selection. In-page checks found `Cesium.Ion.defaultAccessToken=""`, provider imagery disabled, and zero `tile.googleapis.com` resources. The 2D map remains the startup mode. This verifies the globe/overlay path, not restored photorealistic imagery or terrain.
- Rechecked first-run acceptance at 390×844: welcome card bounds were left 12/right 378 with no horizontal overflow; focus began at the CTA, Tab and Shift+Tab stayed on the CTA, and mouse activation closed the dialog, persisted dismissal, and left 2D usable with `2D map ready · 3D map ready`. This is browser emulation, not a physical mobile device test. Desktop text and CTA were also verified earlier.
- Fixed the browser's no-longer-applicable geocoder-hook log after disabling the Cesium built-in geocoder; SafeRoute's existing app search remains the destination interaction.
- Final checks: `npm.cmd --prefix backend test` — **25 passed, 0 failed, 0 skipped**; `npm.cmd --prefix backend run build:client` succeeded; all four source inline script blocks pass `node --check`; both generated and source app HTML passed token-pattern checks. The build script explicitly notes that minified output still needs a functional WebView pass; browser acceptance was performed on the source application, not the generated minified page.
- This change removes the previously detected frontend credential exposure from the two app HTML files. It does not rotate/revoke the provider token in the provider account, remove any other secrets that might exist outside these checked app outputs, or establish provider licensing. Owner should rotate/restrict the former token; keep imagery disabled until a safe browser-scoped token/configuration is ready.

### Updated outcome after token mitigation

| Area | Status | Evidence |
|---|---|---|
| First-run welcome desktop/mobile-emulated layout and action | PASS (browser emulation) | Exact identity/description, 390×844 layout, focus containment, CTA dismissal/persistence, and map-ready state verified. |
| 2D-first and Cesium 3D globe without provider credential | PASS (local browser) | 2D startup; Cesium ready; 3D switch shows globe canvas and preserves 2D state; no Google tiles requested. |
| Photorealistic buildings / token-backed terrain | UNAVAILABLE | Disabled pending owner-managed runtime browser token; Map Controls says unavailable. |
| App source and generated HTML embedded-token patterns | PASS (checked artifacts) | No literal Cesium Ion token assignment or Google API key in `HelloWorld.html` or `backend/dist/HelloWorld.html`. This is not a whole-repository secret scan. |
| CWC source freshness | UNVERIFIED / STALE | Latest sample remains `2026-08-08T03:15:00Z`; repeated local API read did not advance it; no authorized updating endpoint identified. |
| Production deployment | BLOCKED / NOT ATTEMPTED | No authorized deployment target/credentials, unusable Git metadata, and provider setup remains intentionally disabled. |

## 17. Map attribution styling and browser verification (2026-10-11)

- Styled the actual 2D OpenStreetMap attribution (`.sr-map-attribution`) in `assets/cesium/Apps/HelloWorld.html`: small 10px text, subtle readable background, and safe-area-aware bottom-right placement above the fixed navigation.
- Styled Cesium's generated `.cesium-viewer-bottom` credit container above the navigation at bottom-left, preserving the Cesium ion logo and credit text. The `Data attribution` control is explicitly made visible despite Cesium's inline hidden default and retains underline, keyboard focus indication, and click behavior. No required credit is hidden.
- Browser viewport matrix used the actual page at 1280×800, 390×844, and 360×640, with 2D and 3D selected at each size. In all six states, the relevant attribution stayed within the viewport and ended 8px above the navigation: at desktop the nav top was y=724 and both attributions ended at y=716; at 390×844 the nav top was y=768 and credits ended at y=760; at 360×640 the nav top was y=564 and credits ended at y=556. 2D showed `© OpenStreetMap contributors`; 3D showed the Cesium ion logo and readable 10px `Data attribution` link. Map Controls was opened during the small-screen check; the right-side control button was at y=190–242 and did not overlap the bottom-right OSM credit (y=534.5–556).
- Clicked `Data attribution` in 3D. Cesium's credit lightbox opened and displayed `Data provided by:`; the control is therefore both visible and operational. Screenshot inspection at 360×640 also confirmed the Cesium logo, text, and panel are legible above the bottom navigation.
- `Upgrade for commercial use` was not present in the inspected live DOM. The app has no configured Google photorealistic imagery provider; those tiles and token-backed terrain remain intentionally disabled pending an owner-managed runtime credential. No provider notice was fabricated or hidden. If commercial imagery is enabled later, verify and retain the provider's actual required attribution.
- Browser opened the source `assets/cesium/Apps/HelloWorld.html`, not the generated/minified client. A non-fatal OpenStreetMap Overpass HTTP 406 appeared in the browser console during these checks; it did not prevent the attribution/layout checks, but remains a separate live-place-search limitation. Size checks are browser emulation, not physical-device tests.
- `npm.cmd --prefix backend run build:client` succeeded and regenerated `backend/dist/HelloWorld.html` (source 277.0 KB, output 219.6 KB); the build itself warns that minified output is not functionally tested. `npm.cmd --prefix backend test` passed: 25 passed, 0 failed, 0 skipped. The generated client is not claimed to have received the same interactive WebView test.

| Area | Status | Evidence |
|---|---|---|
| 2D OSM attribution positioning/readability | PASS (browser emulation) | Visible, within viewport, 10px, 8px above navigation at all three tested sizes. |
| 3D Cesium credits and attribution control | PASS (browser emulation) | Cesium ion logo and link visible; link opens Cesium credit lightbox; 8px above navigation at all three sizes. |
| Controls / navigation overlap | PASS (browser emulation) | Attribution bounds checked against fixed navigation; Map Controls button checked at 360×640. |
| “Upgrade for commercial use” provider notice | NOT PRESENT / NOT APPLICABLE | No Google photorealistic imagery provider is enabled; no corresponding text appeared in the actual DOM. |
| Physical mobile-device rendering / generated-client WebView | UNVERIFIED | Browser viewport emulation and source page only. |

## 18. Welcome-screen completion and final local regression (2026-10-11)

### Changes made

- Updated `assets/cesium/Apps/HelloWorld.html` to complete the existing welcome screen rather than replace the app or map. It now has a custom, inline SVG Himalayan sunrise/mountain scene (no external image dependency), navy/teal/emerald colors, a clear title and tagline, route/location accent, responsive area chips, and a prominent gradient entry action.
- Added the requested distinct coverage labels: **Sikkim, India**, **Darjeeling, West Bengal, India**, and **Kalimpong, West Bengal, India**; added **Created by Shouvik Rai** and **Owner & Director: Shouvik Rai**. The exact tagline and regional description are present. Feature previews are limited to 2D/3D maps, route-planning UI explicitly labelled `provider unavailable`, geographic/environmental layers, and explicitly experimental AI-assisted analysis. A note says source freshness and availability vary and that map presence does not prove live monitoring.
- Kept the existing local-storage dismissal behavior, dialog focus trap, focus return to Map navigation, 2D-first map, and background Cesium setup. Added explicit initial focus to the entry action after mobile reload testing showed browser autofocus was not consistently applied. No attribution CSS or placement was changed. Existing reduced-motion CSS applies to the new screen; no external resources or continuous welcome animation were added.
- Fixed the generated-client asset path in `backend/build/minify-helloworld.js`: the generated `backend/dist/HelloWorld.html` now receives a relative `<base>` pointing at the source Cesium app assets. This addressed a reproduced `Cesium is not defined` error when opening the generated HTML, without changing the source app’s asset paths. Final rebuilt output is 223.5 KB (source 280.9 KB).

### Welcome and map browser evidence

- Tested the source page `file:///C:/projects/saferoute_3d/assets/cesium/Apps/HelloWorld.html` at 1280×800, 390×844, and 360×640. A clean-storage visit shows the welcome dialog before map interaction; the source 2D status and Cesium readiness were already `2D map ready · 3D map ready` beneath it. The dialog is labelled as a modal and the entry button receives initial focus.
- At all three sizes, the entry button was in view and at least 54 px high; no horizontal overflow was measured. At 360×640 the card scrolls vertically so all copy remains available while the primary action stays visible at y=335–389. Screenshot inspection confirmed the gradient illustration, focus ring, visible action, and scrollable small-screen layout.
- Mouse activation and keyboard activation (Tab then Enter) both closed the dialog, revealed the actual 2D map, and moved focus to `navMap`; keyboard focus had a visible 3 px gold outline. At 360×640 the button was also activated in the touch-sized viewport. This is browser-emulated sizing, not physical touch-device testing. With reduced motion emulated, the existing transition duration resolved to 0.00001 s.
- Verified the existing persistence contract: a cleared dismissal key shows the welcome again; after entering, `saferoute3d.welcome.dismissed=1` is set and a reload keeps the welcome dismissed. No new persistence mechanism was introduced.
- Map Controls changed to 3D (`3D map active · 2D state preserved`, Cesium visible) and back to 2D (`2D map active · 3D loading in background`, Cesium hidden). CWC was toggled on and off: three station records loaded, displayed `STALE` in 2D and as three Cesium entities in 3D; switching it off hid the layer.
- The AI Monitor connected to the backend and displayed source-qualified information: monitoring API `CONNECTED`, traffic `CONFIGURED` but not verified live, backend weather `UNAVAILABLE`, flood `MODEL` and experimental, dam `UNAVAILABLE`, historical archive `CONNECTED`, and CWC `STALE`. CWC showed three station values and timestamps. The Open-Meteo client observation was displayed as `LIVE`, 0.0 mm, age 598 seconds at the UI check (`2026-10-11T09:58:48Z`); this is rainfall context, not a flood alert or river/dam observation.
- The app’s Explore/OSM requests continued to receive a non-fatal Overpass HTTP 406 during browser reloads. The map and local backend API continued to work, but live place search/POI results are not verified. Final generated-client browser load had no Cesium initialization exception after the base-URL fix; Overpass 406 remained.

### Built-client and attribution verification

- Opened the actual rebuilt `backend/dist/HelloWorld.html` in the browser. It showed the welcome, reported both maps ready, entered the real map, and switched to/from Cesium. The generated base resolved to `../../assets/cesium/Apps/`; Cesium initialized successfully. This is desktop-browser testing of the generated file, not a Flutter WebView or physical mobile-device test.
- On the generated page, Cesium’s ion logo and visible 10 px “Data attribution” link remained at bottom-left with 8 px clearance above the desktop navigation; clicking it opened the Cesium `Data provided by:` panel. At 390×844, the OSM credit remained at bottom-right, 10 px, and 8 px above navigation. This confirms the generated asset base preserved the previous attribution behavior; no provider credit was hidden or invented.

### API, routing, data, models, and controls checked

| Subsystem / control | Result | Direct evidence and limitations |
|---|---|---|
| Local backend health | PASS (local services only) | `GET http://127.0.0.1:3000/health` returned HTTP 200 at `2026-10-11T09:47:26Z`; PostgreSQL and Redis reported connected. This does not establish production deployment. |
| Monitoring API to browser | PASS (status/data path) | `GET /api/monitoring/status` returned HTTP 200 at `2026-10-11T09:47:51Z`: traffic `CONFIGURED`, weather `UNAVAILABLE`, flood `MODEL`, dam `UNAVAILABLE`. Browser subsequently showed `CONNECTED` with those same feature statuses; no 401 was reproduced. |
| CWC API and overlay | PASS (stale snapshot only) | `GET /api/data/river-observations` returned `STALE`, three stations, `sourceUpdatesVerified=false`, newest sample `2026-08-08T03:15:00Z`. Browser overlay and AI Monitor retained the same timestamps and stale labels. Source CSV and counts are documented in Section 15; no live update was found. |
| Route endpoint | FAIL / BLOCKED | Valid Gangtok–Singtam coordinates returned HTTP 200 with `fallback=true`, `provider=self_hosted`, `reason=upstream_error`, `upstreamStatus=502`, and zero paths. Invalid latitude returned HTTP 400. Port 8989 accepted a listening socket but `/info`, `/health`, and `/route` returned no HTTP response. The UI’s no-route path is therefore not end-to-end operational in this environment; GraphHopper needs a responding service and loaded graph. No route was fabricated. |
| TomTom traffic | UNVERIFIED | Monitoring says `CONFIGURED`; UI says no fresh validated samples. No paid/provider tile fetch was initiated. `SafeRouteTrafficKMeans v0.1.0` artifact explicitly says `not_trained`, with no centers or evaluation. |
| Flood model | EXPERIMENTAL / NOT FOR WARNINGS | Persisted `SafeRouteFloodBaseline v0.2.0` remains 9.0978 m³/s MAE vs 2.6505 m³/s persistence baseline (−243.2491%); it was not retrained or promoted. Input is provider-derived discharge estimates, not verified gauge data. |
| Map Controls | MIXED / LABELLED | 2D/3D, place-name visibility, built-in hospital/police references, traffic toggle, dated earthquake references, CWC, and OSM POI category toggles were inspected. Satellite, terrain, buildings, separate road overlay, and air quality are visibly unavailable; their controls are disabled or labelled unavailable. No 3D terrain/buildings provider token is configured. |
| Safety, AI Monitor, profile, route card | MIXED / LABELLED | Safety and AI panels render explicit live/model/stale/unavailable statuses. Profile accurately marks accounts, route preferences, saved places, notifications, privacy policy, and connected SafeRoute AI as unavailable/not built. Taxi positions are explicitly demo/simulated and booking is not implied. Emergency and GPS data remain stale/unavailable references; device GPS permission behavior was not tested on a physical device. |
| Search/Explore | BLOCKED (external response) | Overpass returned HTTP 406 and the app logged the failure as non-fatal. Place-search success and POI coverage are unverified. |
| Security scan scope | PASS (narrow app check) | A value-free pattern check found zero Cesium `defaultAccessToken` assignments in the source and generated app HTML. The backend test also confirms no shipping app client-key header/credential. This was not a whole-repository secret scan; `.env` files were not read or copied. |
| Deployment | BLOCKED / NOT ATTEMPTED | `git rev-parse --show-toplevel` failed; no `.github` workflow files were found. `backend/deploy` contains self-hosting scripts and an empty Nginx sample, not an authorized hosting target/domain. No deployment URL or success is claimed. |

### Commands and test outcomes

- `npm.cmd --prefix backend test` — **25 passed, 0 failed, 0 skipped** on the final run.
- `npm.cmd --prefix backend run build:client` — **passed**; generated output now points to the correct project Cesium asset directory and was opened in-browser.
- `flutter test` — **not runnable**: the repository `test` directory contains no files matching Flutter’s required `*_test.dart` pattern. No Flutter/Dart source was changed.
- `npm.cmd test` at repository root is not configured as a test script; backend tests must use the command above.
- Frontend build/browser checks did not validate a physical device, production host, paid TomTom feed, or Flutter WebView. The backend environment still needs an operational self-hosted GraphHopper endpoint and graph; OSM search needs a working/authorized response path; live traffic and CWC updates require verified provider requests. Existing flood-model and traffic-model limitations remain as stated above.

## 19. Routing recovery and Explore follow-up (2026-10-11)

This section supersedes the route and Explore status rows in Section 18 for the checks performed below. Earlier results remain as historical evidence of the failure before repair.

### Routing: recovered locally; no fabricated success

- **Root cause:** the application was configured for self-hosted GraphHopper at `http://127.0.0.1:8998/route`, and the repository's Phase G configuration, graph cache, PBF, and startup script were present, but the GraphHopper process was not running. The expected service uses port 8998 (not 8989). The default PowerShell policy blocked direct script execution; `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\deploy\phase-g\start-graphhopper.ps1` started the existing script with a process-scoped policy bypass. The Node API was restarted with `npm.cmd --prefix backend start`. No cloud key was used.
- GraphHopper `/info` returned HTTP 200, version 11.0, `car` profile, and graph bounds of longitude 87.8754765–89.1702519 and latitude 26.389662–28.2054338. Its metadata reports `import_date=2026-10-09T19:20:10Z` and `data_date=1970-01-01T00:00:00Z`; the latter does not establish the underlying road extract's observation/update date. A direct Gangtok–Singtam request returned HTTP 200 with 1 path, 755 coordinates, 15 instructions, distance 26,200.444 m, and time 1,572,030 ms. The same request through the restarted backend `/api/route` returned HTTP 200 with the same route metrics. GraphHopper's travel time is a road-graph estimate, not a live-traffic-adjusted ETA.
- Browser-tested the generated client at `backend/dist/HelloWorld.html`: a selected Central Referral Hospital reference destination, from the Gangtok test location, produced a real GraphHopper route of 6,988.876 m and 419,333 ms, with 223 rendered 2D route points and 10 instructions. The destination remains labelled as a SafeRoute reference, not a verified live place. A prior browser pass confirmed that an NH10-area Gangtok–Singtam route retained its geometry when switching 2D → 3D → 2D; the 3D view remains an ellipsoid without a configured imagery token.
- A valid-coordinate request outside the loaded graph bounds received GraphHopper HTTP 400 with `Point 0 is out of bounds` and the graph's actual bounds. The backend now treats that condition as no route; `/api/route` returns HTTP 404 JSON (`route_not_found`) rather than an HTTP 200 fallback with empty paths. Malformed JSON is rejected as HTTP 502, upstream 502 as HTTP 502, timeout as HTTP 504, invalid client coordinates as HTTP 400, and an empty path response as HTTP 404.
- Browser-tested a synthetic upstream-502 case: the route panel showed a useful error and Retry; the browser issued a second request after Retry. Clear Route hid the panel and cleared geometry and active-route state. This tests UI failure handling, not the behavior of an unavailable external provider.
- Automated routing regressions cover valid geometry, empty paths, GraphHopper point-out-of-bounds, HTTP 502, timeout, malformed JSON, and invalid coordinates.

| Routing check | Result | Evidence |
|---|---|---|
| Local GraphHopper service | PASS (local) | Existing Phase G script started the configured 8998 service; `/info` and real `/route` geometry responded. The service is local to this workstation and is not a deployment claim. |
| Gangtok–Singtam API route | PASS | Backend HTTP 200; 1 path, 755 coordinates, 26.200444 km, 26.2-minute GraphHopper road-graph ETA estimate, 15 instructions. |
| Hospital reference → route | PASS (reference coordinate) | Generated-client browser route to Central Referral Hospital; 6.988876 km, 223 displayed 2D route points, 10 instructions. |
| Out-of-coverage route | PASS (truthful failure) | GraphHopper HTTP 400 identified exact out-of-bounds coordinates; backend now responds HTTP 404 `route_not_found`, never an empty successful route. |
| Retry and Clear Route UI | PASS (failure injected in browser) | A simulated HTTP 502 exposed Retry; second request was observed. Clear Route cleared route points, active route, and panel. |
| Voice guidance / live navigation marker | UNVERIFIED | Voice-toggle/TTS and GPS progress code exist, but speech output and physical device GPS were not tested. Route preview explicitly does not claim navigation started. |

### Explore / OpenStreetMap places

- Fixed a verified front-end gating bug: POI search previously checked the hidden Cesium camera height even when the active map was 2D, so an eligible 2D viewport could incorrectly return “Zoom in” without making any request. Search now uses the active 2D map view and its current viewport bounds; in 3D it continues to use the Cesium camera bounds.
- Moved category definitions, Overpass query generation, coordinate/category validation, response normalization, retryability, and error classification into `assets/cesium/Apps/poi-utils.js`. The initial 11 OSM categories were covered by tests; Section 20 adds the three separately labelled OSM hospital, police, and dam-reference categories and tests all 14. The map still uses the same Overpass endpoint and request method; no data source or result has been fabricated. A response is discarded with a specific “Map view changed during search” state if the viewport changes while it is pending, instead of being shown under “CURRENT MAP”. Cache keys remain category- and viewport-specific and cached results remain labelled.
- The generated-client browser test injected a clearly synthetic single cafe response only for UI-path verification. The current-bounds Overpass query was generated, one marker and a matching Explore entry appeared, and the source/category were identified as OpenStreetMap. This does not establish live OSM data.
- Captured one real request for tourist places from the 2D viewport (bbox `27.23,88.55,27.43,88.68`): POST to `https://overpass-api.de/api/interpreter`, form-encoded valid `[out:json]` query, `Accept: application/json`, form content type. The response was HTTP 406, `text/html; charset=iso-8859-1`, from Apache/2.4.68 at `overpass-api.de`; its body says “An appropriate representation of the requested resource could not be found”. Removing the explicit `Accept` header in one controlled retry still returned 406, so that header is not established as the cause. A bounded probe of `https://overpass.kumi.systems/api/interpreter` returned HTTP 500. A PowerShell probe through the separate HTTP path returned HTTP 504. No endpoint switch or fabricated fallback was made; upstream service/access remains the blocker.
- UI treats 406/500/network failures as non-fatal errors with a Retry action; HTTP 406 is not automatically retried. The browser showed “Couldn't load tourist places right now” and a Retry button for an injected 406. A deferred, synthetic hotel response was also rejected after the browser viewport changed during the request (`loading` → `view-changed`, zero map POIs), confirming that stale results are not displayed as “CURRENT MAP”. The one real tourist-place query failed, so live results and the individual live status of the remaining categories are **UNVERIFIED**. Category mapping/query construction and response/error handling have automated coverage; static hospital/police/dam references are separate from OSM and remain dated reference records.

| Explore check | Result | Evidence |
|---|---|---|
| 2D map bounds and query construction | PASS | Browser-generated current 2D bounds; request body decoded to a valid, category-specific Overpass query. |
| Category mappings and response normalization | PASS (automated) | The Section 19 run covered its then-current 11 OSM categories; Section 20 records the expanded 14-category test coverage, bounds, node/way/relation queries, invalid coordinates, errors, timeouts, and cancellation classification. |
| Explore success rendering | PASS (UI contract only) | Synthetic test response produced one corresponding cafe list row and map marker; explicitly not live evidence. |
| Current-map protection | PASS (browser-injected response) | Response viewport key was rechecked; a deferred result for an older viewport was discarded (`view-changed`, zero map POIs). |
| Live Overpass endpoint | BLOCKED | Real API 406; alternate instance 500; no live category coverage is claimed. OSM attribution and coverage caveat remain visible. |
| Hospital selection | PASS (dated local reference) | Browser selection of Central Referral Hospital routed to its existing stored coordinates; this is not a fresh Google Places verification. |

### Remaining live-status and imagery claims

- `GET http://127.0.0.1:3000/api/monitoring/status` returned HTTP 200 at `2026-10-11T10:27:41.335Z`: traffic `CONFIGURED`, weather `UNAVAILABLE`, flood `MODEL`, dam `UNAVAILABLE`. This is an API status response, not proof of live traffic/weather/water feeds.
- No TomTom tile request was made; no paid request was authorized. Traffic stays **CONFIGURED / UNVERIFIED**, and `SafeRouteTrafficKMeans v0.1.0` remains `not_trained`. CWC remains **STALE** at the previously verified newest observation `2026-08-08T03:15:00Z`; live source updates were not verified. The flood model remains experimental and underperforms the persisted baseline documented above.
- The generated browser showed a ready 2D map and ready Cesium runtime. No restricted Cesium Ion runtime credential or Google photorealistic tiles were enabled; the actual DOM has no “Upgrade for commercial use” text. OSM and Cesium attribution controls were not hidden or restyled in this change; previous desktop/mobile checks measured 8 px clearance above navigation and retained the clickable Data attribution control.

### Changed files and final validation

- Changed [HelloWorld.html](./assets/cesium/Apps/HelloWorld.html): corrected active-view gating, current-bounds query generation, stale-viewport response rejection, and truthful routing error display.
- Added [poi-utils.js](./assets/cesium/Apps/poi-utils.js): shared/testable OSM category/query/normalization/error helpers.
- Changed [graphhopper.js](./backend/services/graphhopper.js) and [route.js](./backend/routes/route.js): malformed-JSON handling, out-of-coverage no-route handling, and non-success HTTP statuses for unavailable/empty/invalid routes.
- Added [poi-utils.test.js](./backend/test/poi-utils.test.js) and [routing.test.js](./backend/test/routing.test.js).
- Updated [minify-helloworld.js](./backend/build/minify-helloworld.js) to remove stale session-specific build/test claims from its usage notes; build behavior is unchanged.
- `npm.cmd --prefix backend test` at this stage — **36 passed, 0 failed, 0 skipped**; Section 20 records the latest run.
- `npm.cmd --prefix backend run build:client` — **passed**, source 279.8 KB, generated `backend/dist/HelloWorld.html` 222.6 KB. Opened the generated client in the browser; Cesium reported ready, the external POI helper loaded, the 2D map and Explore success/error paths rendered, and a real local route rendered. Browser tests use desktop/mobile viewport emulation, not physical devices or Flutter WebView.
- Reproducible API probes: `GET /api/route?startLat=27.3389&startLon=88.6065&endLat=27.2346&endLon=88.5017` → HTTP 200 with geometry; an otherwise valid route outside the loaded graph bounds → HTTP 404 `route_not_found`.
- Deployment remains **NOT ATTEMPTED**. The local GraphHopper/Node processes and successful local API responses do not establish production availability.

## 20. Explore category completion, responsive credits, and navigation recheck (2026-10-11)

### OpenStreetMap Explore

- The generated client now exposes 14 current-map OSM categories: Hospitals, Police, Dams (OSM reference), Hotels, Food, Cafes, Fuel, Parking, Tourist places, Viewpoints, Attractions, Pharmacies, ATMs, and EV charging. The built-in July 2026 hospital/police/dam reference lists remain distinct; OSM dam search is labelled reference-only and is not a dam-operations feed.
- `backend/test/poi-utils.test.js` now checks each category's accepted OSM tag shape and that normalization only produces an OpenStreetMap result for the selected category. Query tests check the configured tag selectors against node, way, and relation query forms, with bounded current-view coordinates; invalid bounds, invalid coordinates, stale responses, timeout/cancellation classification, and non-retryable HTTP 406 handling remain covered.
- Browser inspection of the rebuilt Explore panel showed all 14 category buttons with the existing current-map scope/coverage caveat and visible OSM attribution. A real Cafe category click at approximately `2026-10-11T10:46:55Z` returned HTTP 406 and displayed “Couldn't load cafes right now” with a “Try again” action. No successful real OSM result or place-to-route from OSM was verified.
- A separate minimal valid cafe Overpass QL request was sent to the documented public interpreter, `https://overpass-api.de/api/interpreter`, as form-encoded POST. It returned HTTP 406 `text/html; charset=iso-8859-1` with an Apache 2.4.68 response and the body “An appropriate representation of the requested resource could not be found”; no `Via` header was observed. A controlled request without the explicit `Accept` header still returned 406. The browser was able to inspect the response, so this was not a browser CORS failure. Prior bounded probes returned HTTP 500 from `https://overpass.kumi.systems/api/interpreter` and HTTP 504 from a separate PowerShell path. These responses establish failure along the public endpoint/network path, but do not identify the remote server's internal cause.
- No open backend proxy was added: the application has no existing OSM proxy, and proxying the same request would not repair the observed remote 406. The endpoint is not blindly rotated or retried; 406 remains non-retryable. Automated mappings do not imply that all categories have live OSM coverage.

### Local GraphHopper routing and navigation UI

- Repeated a real route request through `GET http://127.0.0.1:3000/api/route?startLat=27.3314&startLon=88.6138&endLat=27.2296952&endLon=88.4946887`, using the built-in `District Hospital Singtam` reference coordinate and an explicitly emulated Gangtok test position. The local GraphHopper-backed API returned HTTP 200, one path, 27.343 km, 27.3 minutes estimated road-graph time, 780 coordinates, 16 instructions, and first instruction `Continue`. This is not live GPS, traffic-adjusted ETA, or a current hospital listing.
- In the generated-client browser, selecting the stored District Hospital Singtam reference rendered 780 2D route points and displayed 27.34 km / 27 min. A separate route from the same emulated test position to the stored Central Referral Hospital reference displayed 6.83 km / 7 min. The UI displays route context as inferred, with traffic `UNKNOWN`; neither ETA is based on live traffic.
- Starting navigation changed the route card from “Route preview (navigation not started)” to “Navigating”. With an explicitly injected test location at the route's start coordinate and a stub `SafeRouteTTS` bridge, the browser sent the route summary and first GraphHopper instruction (`Continue`) to the bridge. This verifies JavaScript event/state flow only: actual Android TextToSpeech audio and physical-device GPS remain **UNVERIFIED**.
- Clear Route was clicked in the generated browser; `window.__srActiveRoute` became null, the route panel became hidden, and the SVG route geometry became empty. A browser request without a location fix previously displayed “Enable location services and try again” and did not fabricate a route. The existing synthetic upstream-502 Retry test and GraphHopper out-of-coverage HTTP 404 regression remain as described in Section 19.
- Switching an active route between 2D and 3D and back retained route state. Cesium reported `3D map active · 2D state preserved`; the return reported `2D map active · 3D loading in background`. The route graph remains local and does not establish a public service.

### Attribution visibility and responsive layout

- Browser testing exposed that an active route card could cover required map credits on narrow screens. `assets/cesium/Apps/HelloWorld.html` now moves only an attribution element that geometrically intersects the route card or an open map sheet; it otherwise keeps the existing bottom-of-map position. The same overlap check covers OSM and Cesium attribution. It does not hide, clip, fade, or remove the credits.
- On generated-client browser sizes 1280×800, 390×844, and 360×640, both `© OpenStreetMap contributors` in 2D and the Cesium `Data attribution` control in 3D remained present and the topmost hit-tested elements after the route card and Map Controls sheet were open. At 390×844, the OSM credit had an 8 px gap above the route card when the map sheet was closed; when the sheet was open it moved above the sheet. At 360×640 both credits similarly remained hit-test visible and clear of the active route and bottom navigation. At 1280×800, the credits stayed at their normal bottom positions, outside the centered route card.
- Cesium ion attribution remained a visible, clickable link/control. The DOM did not contain “Upgrade for commercial use”; no Google commercial imagery provider was active, and this was not treated as a credit to remove. No paid TomTom request was made.

### Data and regression status

- The CWC layer was toggled on in the generated browser. It rendered the three previously imported station values (`Bakcha_1`, `Melli_1`, `Singtam_2`) with `STALE`; `latestObservedAtUtc` remained `2026-08-08T03:15:00Z`, and the API still reported `sourceUpdatesVerified=false`. These are historical snapshot readings, not live CWC updates, dam status, reservoir level, or flood warnings.
- Monitoring remains sourced as follows: TomTom traffic `CONFIGURED` but not verified by a provider request; CWC `STALE`; weather provider availability as shown by the latest monitoring response; flood output `MODEL` and experimental; dam telemetry `UNAVAILABLE`. The traffic clustering artifact remains untrained. Flood MAE remains 9.0978 m³/s versus the 2.6505 m³/s persistence baseline. No external live-feed or warning claim is made.
- Clean-storage browser check showed the welcome screen; clicking Enter revealed the 2D-first map. The generated page reported Cesium ready in the background, and switching modes succeeded. Desktop/mobile checks are browser viewport emulation, not physical device or Flutter WebView validation.

| Check | Result | Evidence |
|---|---|---|
| 14 OSM category mappings/query shapes | PASS (automated) | One test case per category plus node/way/relation query generation, coordinates and response normalization. |
| OSM live search results | BLOCKED | Real public interpreter request and browser Cafe search returned HTTP 406; no real results verified. Retry UI is visible; no open proxy or invented result. |
| Gangtok–Singtam route | PASS (local backend) | HTTP 200, 1 path, 27.343 km, 780 coordinates, 16 instructions. Test origin was emulated; ETA is a road-graph estimate. |
| Central Referral Hospital route | PASS (dated reference coordinates) | Generated browser rendered 6.83 km / 7 min from the emulated location; reference data may be outdated. |
| Navigation marker and voice state | PASS (UI state only) | 2D user marker computed blue `rgb(37, 99, 235)`; Cesium code uses `DODGERBLUE`. Stub bridge received summary and first direction; physical GPS/native speech are unverified. |
| Retry / Clear Route / mode switch | PASS / prior regression | Retry was verified with a synthetic 502 in Section 19; Clear Route cleared browser state; active route survived 2D/3D/2D. |
| Required attribution on desktop/mobile | PASS (browser emulation) | OSM and Cesium attribution hit-tested visible at all three sizes, including active route and Map Controls sheet overlays. |
| CWC observations | PASS (stale snapshot only) | Three station markers and STALE labels; newest remains `2026-08-08T03:15:00Z`, update verification false. |
| TomTom, official live flood/dam/hazard feeds | UNVERIFIED / UNAVAILABLE | No authorized TomTom call; dam state unavailable; no basis to elevate historical/model outputs to live feeds. |

### Final commands

- `npm.cmd --prefix backend test` — **37 passed, 0 failed, 0 skipped** (latest run after the 14-category, marker-color and attribution-layout changes).
- `npm.cmd --prefix backend run build:client` — **passed**, generated `backend/dist/HelloWorld.html` rebuilt and manually opened/tested in the browser.
- Local route request above returned HTTP 200 with usable geometry and turn instructions. A separate direct call using the exact built-in Central Referral Hospital coordinates was not substituted for the browser route evidence.
- No Flutter tests ran because there are no `*_test.dart` files. No deployment, production readiness, government approval, native Android speech, physical GPS, verified live traffic, or live CWC update is claimed.

## 21. Cesium raster imagery recovery and final browser verification (2026-10-11)

### Blue/purple 3D scene diagnosis and resolution

- The blank-color scene was reproduced in Cesium. The primary viewer had `baseLayer: false` and an ellipsoid terrain provider. After the client-side Cesium Ion token was removed (Section 16), no imagery provider remained; runtime inspection found no `window.__sr3dProviderConfig` token. Map Controls correctly reports satellite imagery, terrain, and photorealistic buildings as unavailable without owner-managed provider configuration.
- Added an OpenStreetMap raster imagery provider to the existing Cesium viewer: `https://tile.openstreetmap.org/`. It is draped on the ellipsoid; this is a raster road map, not satellite imagery, elevation terrain, or 3D buildings. The existing attribution link remains visible and clickable. No token or key was added. The README records attribution and tile-service constraints.
- Added imagery-load diagnostics: the internal status remains `REQUESTED` until Cesium has observed a non-empty tile queue and that queue drains, then becomes `LOADED`; provider tile errors set `ERROR` and are logged. A regression assertion covers the load-progress hook.

### Generated-client browser evidence

- Tested the rebuilt client at `http://127.0.0.1:8080/backend/dist/HelloWorld.html` over the existing local HTTP server. The generated page initialized the Cesium canvas, switched to `3D map active · 2D state preserved`, and visibly rendered the Gangtok OpenStreetMap road raster. At the final check the diagnostic reported `OpenStreetMap raster · LOADED`, no imagery error, 83 tile-resource entries (75 completed HTTP 200 at sampling time), and visible Cesium ion, OpenStreetMap, and Data attribution credits. A directly opened 256×256 tile was a valid rendered road map. This confirms raster imagery, not terrain/buildings.
- The 3D gesture check issued 59 new tile URLs after a drag and wheel zoom (144 entries before, 203 after); completed visible requests returned HTTP 200. The current Cesium camera is not exposed by the application as a test API, so gesture evidence is tile-request change plus the rendered browser view, not an instrumented camera-coordinate assertion.
- Real mouse drag and wheel zoom in the generated 2D client changed the viewport from `27.3389, 88.6065, zoom 13` to `27.3430873, 88.5970722, zoom 13.35`. The mode status remained correct.
- Programmatically centered both map modes at zoom 13 on each existing Sikkim town reference: Gangtok (27.3389, 88.6065), Pakyong (27.2306, 88.6138), Namchi (27.1663, 88.3639), Soreng (27.1683, 88.1874), Gyalshing (27.2896, 88.2597), and Mangan (27.5083, 88.5322). Each selected center and active mode were reflected by the app. This checks map navigation/coverage centers, not exhaustive per-tile quality or every road.
- Generated-client attribution/layout checks at 390×844 and 360×640 in both modes found the correct attribution visible within the viewport and above the navigation. Cesium credits and the Data attribution control remained present in 3D. “Upgrade for commercial use” was absent because no Google commercial imagery provider is configured; no required credit was hidden.

### Monitoring and other live-source checks

- The generated AI Monitor displayed the backend monitoring API as `CONNECTED`, TomTom as `CONFIGURED` but without validated samples (`TRAFFIC · UNAVAILABLE`), backend weather as unavailable, flood as experimental `MODEL`, and dam telemetry as unavailable. Its weather context separately showed a client-side Open-Meteo current precipitation observation of 0.0 mm, checked at `2026-10-11T11:15:43Z`, age 147 seconds at display time. This does not establish backend weather service availability or a flood observation.
- The flood panel/model text retained the actual holdout MAE of 9.0978 m³/s against the 2.6505 m³/s persistence baseline and explicitly disqualified the estimate from warnings. Hazard references remained dated/stale, not current incidents; GPS and active route were unavailable in that browser session.
- `GET /api/data/river-observations` returned HTTP 200 with `STALE`, three stations, `sourceUpdatesVerified=false`, and newest observation `2026-08-08T03:15:00Z`. The generated-client CWC overlay returned three markers, and AI Monitor displayed station readings, original source times, assumed UTC conversion, age, source file, and the stale/live limitation. Toggling the layer in 3D and 2D retained all three SVG/Cesium markers and the stale classification. This remains an imported CSV snapshot, not a live feed, dam status, or warning.
- Explore did not produce live places. The generated browser request failed with Overpass HTTP 504 at `2026-10-11T11:16:11Z`; earlier controlled tests are recorded in Section 20 (Overpass 406 and alternate instance 500). The app logged the error non-fatally and the map remained usable. The 14-category query and error-handling tests pass, but live results across the six districts are **BLOCKED / UNVERIFIED**.

### Changed files and validation

- `assets/cesium/Apps/HelloWorld.html` — OSM raster fallback, visible linked credit, explicit imagery error logging, and tile-queue load status.
- `backend/README.md` — imagery source, distinction from terrain/buildings, and tile-service/attribution notes.
- `backend/test/public-api.test.js` — regression checks for the provider, visible credit, no bundled Ion token, and imagery-load diagnostics.
- `backend/dist/HelloWorld.html` — regenerated output; opened and functionally checked in the browser as above.
- `npm.cmd --prefix backend run build:client` — passed; output 226.0 KB from 283.5 KB source. The build script itself warns that it does not functionally test output; the separate generated-client browser checks were performed.
- `npm.cmd --prefix backend test` — **37 passed, 0 failed, 0 skipped**.

| Area | Status | Evidence / remaining limitation |
|---|---|---|
| Previously blue/purple Cesium scene | **FIXED / PASS** | Generated browser rendered the OSM road raster; Cesium imagery diagnostic reached `LOADED`; current view had successful HTTP 200 tile responses. |
| 3D terrain and photorealistic buildings | **BLOCKED / UNAVAILABLE** | No authorized runtime Cesium Ion/provider token. Controls remain explicitly unavailable; no buildings or elevation are claimed. |
| 2D/3D switching, gestures, six Sikkim centers | **PASS (browser)** | Mode statuses, viewport recentering, 2D drag/wheel coordinates, 3D tile-request change, and six town centers verified. |
| Responsive map and required attribution | **PASS (browser emulation)** | Generated client, both modes at 390×844 and 360×640; attribution remained visible above navigation. Not a physical-device test. |
| CWC station overlay and AI Monitor | **PASS (stale snapshot only)** | Three markers/station rows; `STALE`, newest `2026-08-08T03:15:00Z`, source updates unverified. |
| Live Explore/Overpass | **BLOCKED / UNVERIFIED** | Latest browser response HTTP 504; previous controlled 406/500 evidence remains in Section 20. No live POIs are claimed. |
| Traffic, dam, official live flood/hazard monitoring | **UNVERIFIED / UNAVAILABLE** | No verified TomTom samples or dam telemetry; flood model fails the persistence baseline; hazard references are not live alerts. |
| Build and backend tests | **PASS** | Client build succeeded; 37/37 backend tests passed. No production deployment or physical device test was performed. |

### Current runtime verification (2026-10-11)

This verification pass was performed directly against the live workspace at `C:\projects\saferoute_3d` and the running services in this environment.

- Project root: `C:\projects\saferoute_3d`
- Generated client URL served for browser validation: `http://127.0.0.1:8000/backend/dist/HelloWorld.html`
- HTTP response: `200 OK` for the generated client page
- Backend URL: `http://127.0.0.1:3000`
- Backend health: `GET /health` returned HTTP 200 with `status: "ok"`, `routing.selfHostedConfigured: true`, `redis.connected: true`, and `database.connected: true`
- Backend readiness: `GET /ready` returned HTTP 200 with `"status":"ready"`
- Runtime route check: `GET /api/route?...` returned the truthful app-level error `{"error":"upstream_error","message":"The configured routing provider is reachable but rejected or failed this request, so no real route geometry is available."}`. A direct check against the configured self-hosted GraphHopper endpoint at `http://127.0.0.1:8998/route` returned `Unable to connect to the remote server`, confirming the route dependency was not running in this environment. This is a deployment/runtime issue, not an app-code route-rendering success.
- Browser console/network status: the generated client loaded successfully and reported `2D map ready · 3D map ready`; a non-fatal Overpass 504 was logged while the app continued to render. This matches the app’s configured behaviour of keeping the map available while marking live POI results as unavailable.
- Monitoring API status confirmed the app’s honest labels: `traffic.status = CONFIGURED`, `weather.status = UNAVAILABLE`, `flood.status = MODEL`, `dam.status = UNAVAILABLE`.
- Browser advocacy remains conservative: no live flood warnings, official dam telemetry, or traffic samples were claimed or fabricated. The app continues to present experimental and unavailable states rather than live operational alerts.
- Saved evidence files: `test-evidence/desktop-2d-initial.png`, `desktop-2d-zoomed.png`, `desktop-3d-overview.png`, `desktop-3d-zoomed.png`, `desktop-2d-3d-switch.png`, `desktop-route-result.png`, `desktop-explore-result.png`, `desktop-cwc-status.png`, `mobile-390x844.png`, and `mobile-360x640.png`.

### Verification outcome

- Backend test suite: PASS (`37 passed, 0 failed`)
- Client build: PASS (`npm.cmd --prefix backend run build:client`)
- Live generated client page: PASS (`200 OK` over HTTP)
- Route functionality: BLOCKED / UNVERIFIED because the configured upstream GraphHopper service is not running in this environment
- Explore/Overpass functionality: BLOCKED / UNVERIFIED because the live public Overpass path is returning HTTP 504 and the app reports it non-fatally
- Monitoring classification: PASS in the sense of honest status labeling (`CONFIGURED`, `UNAVAILABLE`, `MODEL`), with no fabrication of live alerts

The project is therefore ready for honest reporting and deployment preparation, but not for claiming verified live route, traffic, official flood, or live POI coverage in the current environment.

### Historical visual verification blocker (2026-10-11; superseded below)

This section records the earlier attempt only. Its blocked status is superseded by the completed direct-Chrome verification dated 2026-10-12 below.

The requested eight-location, two-mode visual verification pass could not be completed in this environment without fabrication.

Actual blocker observed:
- The generated client page rendered successfully in the VS Code browser tool at `http://127.0.0.1:8000/backend/dist/HelloWorld.html` and showed the real app UI with `2D map ready · 3D map ready`.
- A direct Chrome DevTools headless navigation to the same URL failed with `ERR_CONNECTION_REFUSED` and a Chrome page stating “This site can’t be reached” (`test-evidence/gangtok-2d-1280x800.png`).
- A separate local Python HTTP server used for the same URL was not stable across repeated launches, so the CLI-driven CDP automation could not be relied on for the mandatory district-by-district map navigation and screenshot matrix.
- Map interactions through the browser automation layer were also unstable: clicks were intercepted by floating overlays or timed out before the map could be navigated reliably, preventing the required 8 × 2 location automation pass.

Therefore, the following remains explicitly unverified in this session:
- Gangtok 2D/3D screenshot matrix
- Mangan 2D/3D screenshot matrix
- Namchi 2D/3D screenshot matrix
- Gyalshing 2D/3D screenshot matrix
- Pakyong 2D/3D screenshot matrix
- Soreng 2D/3D screenshot matrix
- Rangpo 2D/3D screenshot matrix
- Singtam 2D/3D screenshot matrix
- automated place search and district-specific map zoom/pan verification

What was actually completed validly:
- direct HTTP and backend readiness verification
- one browser-rendered live page capture from the integrated browser tool (`test-evidence/verification-browser-current.png`)
- source inspection of the real map-control and search code in `assets/cesium/Apps/HelloWorld.html`
- documentation of the actual runtime blockers: no live GraphHopper upstream (`127.0.0.1:8998/route` unreachable), non-fatal Overpass 504, and the inability to complete the region-by-region browser automation without fabricated evidence

Historical note: the statement above described the 2026-10-11 attempt. The current browser results follow.

## Direct Chrome visual verification (2026-10-12)

This pass used the actual generated client in local Chrome through Chrome DevTools Protocol (CDP). It supersedes the earlier incomplete browser-verification status above. No application source, styling, backend configuration, route architecture, branding, welcome screen, or existing feature was changed.

### Test environment and deterministic smoke test

- URL: `http://127.0.0.1:8000/backend/dist/HelloWorld.html`; the generated client returned HTTP 200 during the run.
- The loopback-only Python HTTP server remained on `127.0.0.1:8000` for the tests. Chrome and the CDP driver ran on the same Windows host; the driver connected to `127.0.0.1:9223`.
- At the start of this pass ports 8000 and 9222 were not listening, and the pre-existing ordinary Chrome process had no DevTools endpoint. The earlier refusal was therefore consistent with connecting to a stopped server/non-CDP Chrome instance; its exact prior process teardown cause could not be recovered. This pass started and verified a loopback server and dedicated local CDP Chrome instance, avoiding any cross-environment `127.0.0.1` assumption.
- Browser: local Chrome 154.0.8037.99. The page title was `SafeRoute 3D`; the rendered UI reported `2D map ready · 3D map ready`.
- Reusable test driver: [`test-evidence/run-chrome-matrix.cjs`](test-evidence/run-chrome-matrix.cjs), using Node's built-in WebSocket/CDP support; no Playwright or Puppeteer dependency was added.
- Smoke results: [`chrome-smoke-results-20261012104510.json`](test-evidence/chrome-smoke-results-20261012104510.json); inspected genuine screenshots: [2D](test-evidence/chrome-smoke-2d-20261012104510.png) and [3D](test-evidence/chrome-smoke-3d-20261012104510.png), each 1280×800.
- The smoke driver opened the generated client, read the viewport and title, clicked the existing map-mode controls, switched 2D → 3D → 2D, and sent real wheel and drag input. In 2D the zoom changed from 12 to 12.35 and back to 12, and the drag changed the center. The screenshots show the matching active-mode status.
- The complete eight-place run and machine-readable interaction/network results are in [`chrome-matrix-results-20261012104611.json`](test-evidence/chrome-matrix-results-20261012104611.json). Each 2D view was centered to within 0.001° of its requested reference coordinate; 2D zoom changed 14 → 14.35 → 14, and panning changed the center for all eight places. Each 3D view reported the active 3D state and received two wheel events plus pointer-down/move events. The user-visible 2D control was restored after each place.
- Separate Gangtok 3D evidence shows the actual zoom-in, zoom-out, and post-drag frames: [before zoom](test-evidence/chrome-matrix-gangtok-3d-before-zoom-20261012104611.png), [zoomed in](test-evidence/chrome-matrix-gangtok-3d-zoom-in-20261012104611.png), [zoomed out](test-evidence/chrome-matrix-gangtok-3d-zoom-out-20261012104611.png), and [after drag](test-evidence/chrome-matrix-gangtok-3d-rotate-20261012104611.png). The wheel and drag events were delivered; the harness could not read a public Cesium camera heading/pitch, so a numeric camera-rotation delta is not claimed.

### Eight-place visual matrix

All 16 files below are genuine CDP captures, verified to exist at 1280×800, and opened for visual inspection. The visible place marker/label and map extent correspond to the named place. 2D road/raster rendering was visible in all eight 2D captures. The 3D captures show the active Cesium mode with OSM map content; they do not establish satellite, terrain elevation, or extruded 3D buildings.

| Location | 2D screenshot inspected | 3D screenshot inspected | Center and actual observations |
|---|---|---|---|
| Gangtok | [2D PNG](test-evidence/chrome-matrix-gangtok-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-gangtok-3d-20261012104611.png) | Center 27.3389, 88.6065. Road labels and town marker visible in 2D and 3D. |
| Mangan | [2D PNG](test-evidence/chrome-matrix-mangan-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-mangan-3d-20261012104611.png) | Center 27.5083, 88.5322. Roads/river context and town marker visible; 3D view has sparser detail. |
| Namchi | [2D PNG](test-evidence/chrome-matrix-namchi-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-namchi-3d-20261012104611.png) | Center 27.1663, 88.3639. Road network and town marker visible; the 3D OSM rendering includes footprint-like map symbols, not verified 3D geometry. |
| Gyalshing | [2D PNG](test-evidence/chrome-matrix-gyalshing-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-gyalshing-3d-20261012104611.png) | Center 27.2896, 88.2597. Roads, place marker, and hospital/police map labels are visible; 3D footprints remain flat map symbols. |
| Pakyong | [2D PNG](test-evidence/chrome-matrix-pakyong-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-pakyong-3d-20261012104611.png) | Center 27.2306, 88.6138. 2D road/airport-area map and marker visible. 3D frame is dominated by green land-cover symbols with limited road detail. |
| Soreng | [2D PNG](test-evidence/chrome-matrix-soreng-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-soreng-3d-20261012104611.png) | Center 27.1683, 88.1874. Road/stream context and town marker visible; 3D local detail is sparse. |
| Rangpo | [2D PNG](test-evidence/chrome-matrix-rangpo-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-rangpo-3d-20261012104611.png) | Center 27.1761, 88.5287. Town/road/river context visible; 3D contains road and footprint-like symbols. |
| Singtam | [2D PNG](test-evidence/chrome-matrix-singtam-2d-20261012104611.png) | [3D PNG](test-evidence/chrome-matrix-singtam-3d-20261012104611.png) | Center 27.2340, 88.5014. NH-10/Teesta corridor and town marker visible in both modes. |

The map did not appear blank in these captures. Rendering and map-data density varied by place and zoom; this eight-point sample does not establish complete road, building, or POI coverage across Sikkim.

### Responsive layout checks

The generated client was separately opened at desktop 1280×800 and mobile-emulated 390×844 and 360×640. Both 2D and 3D mode screenshots were captured and inspected at each mobile size. The bottom navigation, map controls, and attribution remained visible; the 3D status and attribution wrap onto multiple lines at the narrower widths. These are browser-emulation checks, not physical-device tests.

- 390×844: [2D](test-evidence/chrome-layout-2d-20261012105755.png), [3D](test-evidence/chrome-layout-3d-20261012105755.png), [results](test-evidence/chrome-layout-results-20261012105755.json).
- 360×640: [2D](test-evidence/chrome-layout-2d-20261012105819.png), [3D](test-evidence/chrome-layout-3d-20261012105819.png), [results](test-evidence/chrome-layout-results-20261012105819.json).

### Search, POI, network, and routing results

- The existing Explore search selected all eight Sikkim reference places by name and navigated the rendered map to the recorded coordinates. This verifies the app's built-in Sikkim reference-place search/navigation path; it is not evidence of independent live geocoding.
- Hospitals returned six entries and police returned seven entries in the app's built-in reference lists. The UI identifies these as SafeRoute/Google Places reference data dated July 2026 and warns it may be outdated; these results are not live-service verification. Inspected captures: [hospitals](test-evidence/chrome-poi-hospital-20261012110106.png) and [police](test-evidence/chrome-poi-police-20261012110106.png).
- A genuine current-view OpenStreetMap cafe query returned HTTP 200 with seven named results, including Coffee cafe day, Café Fiction, Sikkim Coffee & roastery, Café Yarphel, Zongri Bakery and Cafe, and Cave Cafe. The app displayed the results without distance estimates because no user location was available. Inspected capture: [cafes](test-evidence/chrome-poi-cafes-20261012110106.png).
- A genuine current-view Overpass Attractions query returned HTTP 504. The app displayed “attractions search timed out. Try again.” and zero results; this is a failure, not a successful attraction search. Inspected failure capture: [attractions timeout](test-evidence/chrome-poi-attractions-20261012110106.png). Other app-originated Overpass requests in this run included HTTP 200 and HTTP 504 responses. The observed 504 is from `overpass-api.de`; its underlying cause (provider load versus query-specific delay) was not independently determined.
- Browser logs also recorded `ERR_CONNECTION_REFUSED` for `http://127.0.0.1:3000/api/monitoring/status`. Some OpenStreetMap tile requests were aborted while views changed; road tiles nevertheless rendered in the inspected captures. The raw CDP records are in [`chrome-poi-results-20261012110106.json`](test-evidence/chrome-poi-results-20261012110106.json) and the matrix JSON linked above.
- The configured GraphHopper endpoint `127.0.0.1:8998/route` was unreachable, and the app backend on port 3000 was not listening. The existing graph cache and GraphHopper 11.0 JAR were present. For a safe independent check, the repository's existing loopback-only replacement config was started on ports 8997/8996, both bound to `127.0.0.1`. Its health check returned HTTP 200 and a genuine direct route request returned one path: 67,713.104 m, 4,062,792 ms, 2,355 geometry coordinates. The response's road-data timestamp is `1970-01-01T00:00:00Z`, so freshness is not established. Raw response: [`graphhopper-route-response-20261012.json`](test-evidence/graphhopper-route-response-20261012.json). This route was produced directly by the test instance on port 8997; it does not mean the application route through its configured port 8998 was working. The temporary test service was shut down after the route check. No routing architecture/configuration was changed.

### Capability distinctions and remaining limits

- **2D road tiles:** visibly rendered in all eight 2D captures.
- **3D mode:** the Cesium view was active and showed OSM map content. The viewer is configured with `globe: false`; the captures show no curved globe surface. Elevation and terrain are not verified.
- **Satellite imagery:** not verified or observed.
- **Terrain elevation:** not verified; no elevation surface is claimed.
- **Building footprints:** footprint-like symbols appear in some detailed OSM views; these are map-rendered footprints/symbols only.
- **Actual 3D building geometry:** not verified and not claimed.
- **Backend automated tests/client build:** no application code or build inputs changed in this testing-only pass. The prior report's 37 passing backend tests and successful client build remain historical results; they were not rerun here.

## 10. Physical Android verification over Wireless ADB (2026-10-12)

### Device, install, and deterministic WebView test

- `adb devices -l` showed one authorized Samsung SM-A166P Android 16/API 36 device over Wireless Debugging. The test used that wireless connection; USB was not used.
- Rebuilt the current source with `flutter build apk --debug` (successful), installed the APK with `adb install -r`, and launched `com.example.saferoute_3d/.MainActivity`.
- Reattached CDP port 9222 to the new WebView process, reloaded the page, and ran [`android-device-debug.cjs`](test-evidence/android-device-debug.cjs). It reads the rendered DOM/status and WebGL renderer, clicks the real map-mode controls, sends pinch/drag touch events, records console/network responses and captures phone screenshots.
- WebView page title: `SafeRoute 3D`. CSS viewport: 384×748 at DPR 2.8125. Physical screenshots are 1080×2340; CDP surface captures are cropped to the 1080×2107 WebView content area.
- WebGL reports WebGL 2.0 / Mali-G57 MC2. The bounded 1.25 renderer scale produces a 480×935 drawing buffer.
- The reload diagnostics contain no `activeRoute` temporal-dead-zone `ReferenceError`. This verifies the JavaScript readiness guard in the rebuilt APK; it does not address the separate previously observed native location-permission denial.
- Machine-readable fresh-run diagnostics: [`android-device-results-20261012141231.json`](test-evidence/android-device-results-20261012141231.json).

### Map modes and rendering

| Test | Result | Evidence and observation |
|---|---|---|
| 2D mode | **PASS** | After explicitly selecting 2D, CDP reported mode `2d`, `aria-pressed=true`, a visible 2D map layer and a 384×748 viewport. The inspected physical capture shows Gangtok roads and labels: [`android-verified-2d-20261012141702.png`](test-evidence/android-verified-2d-20261012141702.png) (1080×2340). CDP capture: [`android-verified-2d-webview-20261012141702.png`](test-evidence/android-verified-2d-webview-20261012141702.png) (1080×2107). OSM tiles returned HTTP 200. |
| 3D mode | **FAIL — provider tiles unavailable in this run** | The app entered its 3D state, but the inspected physical capture is black/noisy with overlays rather than geographic imagery: [`android-3d-tilt-20261012141231.png`](test-evidence/android-3d-tilt-20261012141231.png) (1080×2340). CDP recorded `tile.googleapis.com/v1/3dtiles/root.json` HTTP 429 and `PHOTOREALISTIC TILES FAILED TO LOAD`. The actual underlying provider reason (quota, rate limit, key restriction, or transient upstream response) was not established; no application/backend configuration was changed. |
| 2D/3D switching and zoom/rotation/tilt | **PARTIAL** | The harness invoked the controls and touch gestures. Prior to the latest 429 response, actual photorealistic imagery rendered on the same device/build, with separate 3D captures for the view, zoom-out and tilt: [`android-map-3d-20261012140156.png`](test-evidence/android-map-3d-20261012140156.png), [`android-3d-zoom-out-20261012140156.png`](test-evidence/android-3d-zoom-out-20261012140156.png), and [`android-3d-tilt-20261012140156.png`](test-evidence/android-3d-tilt-20261012140156.png). Camera diagnostics from that run showed height/heading change and tilt from −90° to −82.3°. Current-run 3D imagery was unavailable, so current visual camera response could not be independently confirmed. |

The current-run fresh-load console/network evidence also includes Overpass HTTP 504 and 200 responses (the automatic responses were not tied to a particular selected category), traffic-manager/geocoder warnings, and `ERR_CONNECTION_REFUSED` for local requests. Some script aborts occurred during view transitions. The 3D 429 is the directly observed blocker for the current black/noisy 3D surface; the earlier transient blank physical capture recovered after a control interaction and remains separately unexplained.

### Search, Explore, Safety, routing, and voice

- **Search:** entering Gangtok displayed and selected the built-in SafeRoute reference location and centered the map. This verifies local reference-place search, not live geocoding: [`android-phone-search-gangtok-20261012134255.png`](test-evidence/android-phone-search-gangtok-20261012134255.png).
- **Explore:** Cafes did not produce verified genuine results on the phone. The observed Overpass failure was HTTP 504; an unrelated/automatic HTTP 200 in the fresh-run network log is not represented as a successful category search. Capture: [`android-phone-explore-cafes-final-20261012_185620.png`](test-evidence/android-phone-explore-cafes-final-20261012_185620.png).
- **Safety:** the screen displayed 0.0 mm/hr values, Flood `Unavailable`, and Landslide `Requires data integration`; prior Open-Meteo 503 errors mean those zero values were not independently verified as fresh observations. Capture: [`android-phone-safety-20261012_185745.png`](test-evidence/android-phone-safety-20261012_185745.png).
- **Routing:** the configured app backend at `127.0.0.1:3000/api/route` returned `ERR_CONNECTION_REFUSED`; GraphHopper at the configured `127.0.0.1:8998/route` was not listening. In a separate controlled test, the real in-app route flow succeeded through a temporary loopback-only backend and the existing GraphHopper replacement on port 8997, producing a 52.25 km / 52 min route preview: [`android-phone-route-success-visible-20261012134012.png`](test-evidence/android-phone-route-success-visible-20261012134012.png). Those temporary services and the ADB reverse mapping were stopped/removed. This was not a successful request to the configured 8998 endpoint. Navigation UI was started, but GPS movement and a complete turn-by-turn trip were not verified: [`android-phone-navigation-tts-20261012134114.png`](test-evidence/android-phone-navigation-tts-20261012134114.png).
- **TTS:** Voice Guidance was enabled and the native Android bridge recorded two speak invocations without a speak failure. Audible output was not independently confirmed.
- **Location permission:** a prior Flutter log recorded `User denied permissions to access the device's location.` Permission handling was not changed; live location-dependent behavior remains limited.

### Data-type distinctions and test status

- 2D road tiles: **verified** around Gangtok.
- Google Photorealistic imagery: **rendered in the earlier capture**, but **failed in the later fresh-load run** with HTTP 429; current availability is not verified.
- Satellite mode: the app labels it unavailable/not configured.
- Terrain elevation and actual extruded 3D building geometry: **not verified**. The 3D mode label, WebGL context, or marker overlays are not proof of terrain/building data.
- The latest Flutter debug APK build passed. Backend tests were not rerun; earlier test counts/results in this report remain historical. No backend configuration, routing architecture, UI, branding, or existing feature was changed for this verification pass.

## 11. Final Wireless Android verification (2026-10-12)

### Device, build, and repeatable run

- `adb devices -l` showed exactly one authorized device: Samsung SM-A166P over Android Wireless Debugging, Android 16/API 36. The latest debug APK was installed over that wireless connection; USB was not used.
- Rebuilt the client and APK after a small no-token geocoder `change`-event guard in [`HelloWorld.html`](assets/cesium/Apps/HelloWorld.html). The existing local Gangtok search fallback is retained; no UI, routing, backend, or map architecture was changed.
- Re-ran [`android-device-debug.cjs`](test-evidence/android-device-debug.cjs) against the visible `SafeRoute 3D` WebView through its refreshed CDP forwarding. It exercised the welcome/profile settings, search, Safety and Explore tabs, map-mode controls, and touch gestures. Machine-readable output: [`android-device-results-20261012155022.json`](test-evidence/android-device-results-20261012155022.json); harness log: [`android-final-harness-20261012_212021.txt`](test-evidence/android-final-harness-20261012_212021.txt).
- WebView viewport: **384×748 CSS px**, DPR **2.8125**; the WebGL context reported **WebGL 2.0 / Mali-G57 MC2**. Physical phone captures are **1080×2340**; the corresponding map WebView captures are **1080×2107**. Each capture path listed below was checked for existence; final physical captures are 1080×2340.
- Sanitized device log: [`android-logcat-final-20261012_212232.txt`](test-evidence/android-logcat-final-20261012_212232.txt). Coordinates and credential-like values were redacted before saving.

### Current phone rendering and interaction results

| Test | Result | Inspected evidence and observation |
|---|---|---|
| 2D map at Gangtok | **PASS** | [`android-map-2d-20261012155022.png`](test-evidence/android-map-2d-20261012155022.png) and [`android-webview-map-2d-20261012155022.png`](test-evidence/android-webview-map-2d-20261012155022.png). Real OpenStreetMap road raster and labels are visible around Gangtok; multiple tile requests returned HTTP 200. |
| 3D switch | **BLOCKED — imagery not configured** | [`android-map-3d-unavailable-20261012155022.png`](test-evidence/android-map-3d-unavailable-20261012155022.png) and [`android-webview-map-3d-unavailable-20261012155022.png`](test-evidence/android-webview-map-3d-unavailable-20261012155022.png). The 3D control was clicked, but the state remained `mode: 2d`; the UI reported “3D imagery unavailable · provider token not configured · 2D map remains available.” The inspected image is still the 2D road map, not 3D imagery. With no restricted browser token configured, the client correctly made no photorealistic-tile request. This run therefore did **not** reproduce a noisy 3D surface; it also does not verify any 3D globe surface, terrain, building footprints, or 3D building geometry. The earlier HTTP 429 remains historical evidence, not the result of this run. |
| 2D zoom and pan | **PASS / partial** | [`android-2d-zoom-in-20261012155022.png`](test-evidence/android-2d-zoom-in-20261012155022.png), [`android-2d-zoom-out-20261012155022.png`](test-evidence/android-2d-zoom-out-20261012155022.png), and [`android-2d-pan-20261012155022.png`](test-evidence/android-2d-pan-20261012155022.png). Pinch-in changed reported zoom from 14 to 14.585; pinch-out returned it to 14. The inspected captures show a changed map framing after the drag. |
| Search | **PARTIAL** | [`android-search-gangtok-20261012155022.png`](test-evidence/android-search-gangtok-20261012155022.png). The existing local reference fallback selected Gangtok and reported the map at zoom 14. This is not live geocoding. One unhandled JavaScript promise was still logged as `Uncaught (in promise) [object Object]`; its origin was not resolved, so search is not reported as console-clean. |
| Explore cafes | **PASS for returned live results** | [`android-explore-cafes-20261012155022.png`](test-evidence/android-explore-cafes-20261012155022.png). The UI displayed five OpenStreetMap cafe results: Coffee cafe day, Café Fiction, Sikkim Coffee & roastery, Café Yarphel, and Zongri Bakery and Cafe. Three Overpass requests returned HTTP 200 during the run. A separate automatic/current-view request failed once with `TypeError: Failed to fetch`; no HTTP 504 occurred in this run. The list showed `0 m away` for these items, which is not validated as a real device-location distance. |
| Hospitals and police | **PASS for built-in reference lists only** | [`android-explore-hospitals-reference-20261012155022.png`](test-evidence/android-explore-hospitals-reference-20261012155022.png) and [`android-explore-police-reference-20261012155022.png`](test-evidence/android-explore-police-reference-20261012155022.png). The UI explicitly labels these SafeRoute reference records and warns that they may be outdated; these are not live POI search results. |
| Safety | **PARTIAL** | [`android-safety-20261012155022.png`](test-evidence/android-safety-20261012155022.png). Five Open-Meteo requests returned HTTP 200 and the screen showed current-hour precipitation values. This is weather context only, not an official warning, gauge reading, or verified flood/landslide alert. |
| Profile settings and voice | **PASS for toggle/bridge; audible output unverified** | [`android-profile-settings-20261012155022.png`](test-evidence/android-profile-settings-20261012155022.png). Distance-unit formatting was toggled and restored to km; voice guidance was toggled and restored to off. Logcat records native TTS initialization, “Voice guidance on” being spoken, utterance completion, and stop. The physical audio output was not independently listened to. |

The harness also saved the initial and welcome-dismissed screens: [`android-initial-20261012155022.png`](test-evidence/android-initial-20261012155022.png) and [`android-welcome-dismissed-20261012155022.png`](test-evidence/android-welcome-dismissed-20261012155022.png). The final run exercised Gangtok only on the phone; it does not establish Android coverage for the other districts or towns.

### Current blockers and diagnostics

- **3D imagery:** no restricted provider token is configured in the installed client, and its viewer is configured with `globe: false`. The 3D request is intentionally skipped; only 2D OSM raster roads were visually verified. Do not infer terrain or 3D buildings from WebGL readiness or the mode control.
- **Routing:** neither the configured local backend port **3000** nor GraphHopper port **8998** was listening on the test host. The configured route flow was not submitted and no route/navigation success is claimed. Earlier port 8997 evidence is separate and does not show the configured service working.
- **Network/console:** OSM tiles and five Open-Meteo calls returned HTTP 200; three Overpass calls returned HTTP 200, alongside one failed automatic Overpass fetch. The monitoring request failed with `ERR_CONNECTION_REFUSED`; traffic-manager resources were unavailable (including a missing `traffic/vectorTileDecoder.bundle.js` request), and the traffic manager reported unavailable. Several `ERR_ABORTED` resources coincided with WebView reload/navigation. The generic unhandled promise rejection noted above remains unresolved.
- **Live location and 3D gestures:** no valid GPS position or live device-location behavior was established. 3D zoom/rotation/tilt could not be tested because the app stayed in 2D when imagery was unavailable.

### Final automated validation

- `npm.cmd --prefix backend test`: **37 passed, 0 failed**; log: [`backend-tests-20261012_211623.txt`](test-evidence/backend-tests-20261012_211623.txt).
- `npm.cmd --prefix backend run build:client`: passed; generated `backend/dist/HelloWorld.html`.
- `flutter analyze`: passed with no issues; the final guard edit was HTML-only.
- `flutter build apk --debug`: passed; the rebuilt APK was installed and tested on the wireless phone.
- `node --check` passed for the Android harness and all nine non-empty inline application scripts.

These automated results are separate from the inspected physical-phone captures above. No public deployment was attempted.

## 22. 3D imagery root-cause investigation (2026-10-12)

### Finding

There are **two distinct failures**, not one:

1. **Current “3D imagery unavailable” is confirmed to be caused by a source/configuration change.** The retained pre-change app HTML backups contain a non-empty `Cesium.Ion.defaultAccessToken`; the current [`HelloWorld.html`](assets/cesium/Apps/HelloWorld.html) assigns it an empty string at line 1548. The current startup guard at lines 2916–2918 exits before invoking `Cesium.createGooglePhotorealistic3DTileset`. The catch marks 3D `FAILED`, selects/keeps 2D, and hides the Cesium canvas. The generated [`backend/dist/HelloWorld.html`](backend/dist/HelloWorld.html) matches this behavior. This is why the latest phone reports unavailable and makes **zero** Google 3D Tiles requests; it is not evidence of an invalid token, a license rejection, or an Android WebGL failure.
2. **The earlier black/noisy screen after a 3D tilt is most consistent with the camera moving off the finite 3D tileset into Cesium’s star field, but the exact camera angle was not recorded.** In the 14:01 phone run, the normal 3D and zoom-out screenshots show real Gangtok imagery; the screenshot taken after the tilt gesture is black/star-filled with only overlays. The same run recorded 236 Google 3D Tiles HTTP 200 responses and zero failed network requests. WebGL 2.0 on Mali-G57 MC2 was available. Thus the first observed failure in that interaction was after the tilt gesture, not during image download. Since the viewer is configured with `globe: false`, no ellipsoid or imagery surface remains beneath/around the tileset if the view turns away. Camera pitch/heading were not instrumented, so this is the best-supported explanation, **not a numerically confirmed camera diagnosis**. This screenshot is not proof of GPU corruption.

A separate cold-start run on the earlier credential-bearing build did confirm a provider-side failure: `https://tile.googleapis.com/v1/3dtiles/root.json` returned **HTTP 429**, followed by `PHOTOREALISTIC TILES FAILED TO LOAD` and a black/noisy capture. The stored evidence does not include the provider’s error body, so it cannot distinguish rate limiting from quota/billing or another Google-side policy. It is separate from the 14:01 post-tilt black view, where all recorded tile requests succeeded.

### Configuration and credential path

- Active Flutter startup in [`main.dart`](lib/main.dart) serves `assets/cesium` and loads the local `Apps/HelloWorld.html`; it does not inject a provider token. The project `.env` is empty. The previously documented `window.__sr3dProviderConfig.cesiumIonAccessToken` runtime hook is **not present in the current source or Android loader**.
- The active Cesium viewer uses `globe: false` and does not configure an imagery or terrain provider on the globe. It calls `Cesium.createGooglePhotorealistic3DTileset()` without an explicit `key`.
- The bundled Cesium helper first uses `options.key` / `Cesium.GoogleMaps.defaultApiKey`; with neither set, this Cesium version falls back to **Cesium Ion asset 2275207**. That path requires a Cesium Ion access token authorized for that asset. The former populated Ion token enabled that path; the historical HTTP 200 tiles prove it worked at that time. A direct Google Maps Platform 3D Tiles API key is an alternate helper path if configured. The 429 evidence does **not** prove that a paid upgrade is required; no current billing/licensing denial was recorded.
- Git history could not be used: the workspace `.git` directory has no entries and Git reports “not a git repository.” The pre-change source backups are [`HelloWorld.before-final-merge.html`](assets/cesium/Apps/HelloWorld.before-final-merge.html) and [`HelloWorld.html.pre-traffic-audit.bak`](assets/cesium/Apps/HelloWorld.html.pre-traffic-audit.bak). Both retain the old populated token; its value is intentionally omitted here. The separate legacy `CesiumScreen` uses a `YOUR_CESIUM_TOKEN` placeholder and is not the active Android page.

### Fresh Android reproduction after the credential-removal change

Two separate force-stop/cold launches were run over Wireless ADB on the SM-A166P (Android 16/API 36, WebView 155.0.8059.30). Each run selected 2D, selected 3D, returned to 2D, and repeated zoom-in/out and pan checks. The harness results are [`android-device-results-20261012162628.json`](test-evidence/android-device-results-20261012162628.json) and [`android-device-results-20261012162824.json`]; saved console/harness logs are [`android-root-cause-run1-20261012_215628.txt`](test-evidence/android-root-cause-run1-20261012_215628.txt) and [`android-root-cause-run2-20261012_215824.txt`](test-evidence/android-root-cause-run2-20261012_215824.txt). Sanitized Android logcat from the second launch is [`android-root-cause-logcat-20261012_220328.txt`](test-evidence/android-root-cause-logcat-20261012_220328.txt).

| Check | Cold launch 1 | Cold launch 2 |
|---|---|---|
| Actual visible viewport / renderer | 384×748 CSS px, DPR 2.8125; WebGL 2 / Mali-G57 MC2 | Same |
| 2D OSM map | Visible; 35 tile responses HTTP 200 | Visible; 35 tile responses HTTP 200 |
| 3D control attempt | Remained `mode: 2d`; `threeDState=FAILED`; no Google tile requests | Same |
| 2D zoom/pan after failed 3D attempt | Zoom 14 → 14.585 → 14; drag changed map framing | Same |
| Physical 2D / attempted-3D captures (1080×2340) | [`android-map-2d-20261012162628.png`](test-evidence/android-map-2d-20261012162628.png), [`android-map-3d-unavailable-20261012162628.png`](test-evidence/android-map-3d-unavailable-20261012162628.png) | [`android-map-2d-20261012162824.png`](test-evidence/android-map-2d-20261012162824.png), [`android-map-3d-unavailable-20261012162824.png`](test-evidence/android-map-3d-unavailable-20261012162824.png) |

The current app logged “Photorealistic imagery was not requested: no restricted browser token is configured.” It made zero Google 3D Tiles requests. Neither cold launch showed a current 3D tile status or geographical 3D surface. OSM roads remained visible in the 2D captures. The phone log contains vendor `GPUAUX ... Null anb` messages but no recorded Chromium WebGL context-loss event; this does not establish an Android renderer defect.

### Resolution, safety, and remaining action

- **No provider credential was restored or copied from the backups.** Those backups contain a client-side credential and are not a safe source for rebuilding/distributing the app; the owner should rotate/restrict the former Cesium Ion token. The current early guard and 2D fallback were retained, so the app does not present the black 3D canvas as a successful map.
- **No actual 3D imagery fix is claimed.** The current missing-provider path is fully explained, but restoring geographic 3D needs an owner-managed, rotated Cesium Ion token authorized for asset 2275207, or a correctly enabled/restricted Google Maps Platform 3D Tiles API key. Because the former token is exposed in local historical files and no safe runtime injection path exists in the active Android app, adding it back to HTML/APK would be unsafe. The separate post-tilt camera-angle diagnosis also needs camera-pitch instrumentation and an authorized imagery run to validate a camera clamp/fallback change.
- Corrected the optional imagery description in [`backend/README.md`](backend/README.md): it now reflects the actual `globe: false` / 2D fallback behavior and the helper’s Cesium Ion versus direct Google key paths. No application source or routing/UI behavior was changed in this investigation.
- This task therefore confirms the root cause of the current unavailable state, records two evidenced historical causes for black/noisy captures (a likely camera-to-sky view and an actual Google HTTP 429), and leaves restoration of 3D imagery **BLOCKED pending safe provider configuration**. No subscription purchase or public deployment was attempted.

## 23. Local Cesium authorization inventory follow-up (2026-10-12)

- Rechecked process, user, and machine environment-variable **names only**; no Cesium/Ion provider variable is configured. The root `.env` is empty. The existing `backend/.env` has GraphHopper and TomTom setting names but no Cesium Ion or Google 3D Tiles setting; credential values were not read into output or recorded.
- Checked Android local build configuration names without printing values: `local.properties` contains Flutter version settings, `gradle.properties` contains Gradle/Android build flags, and `key.properties` contains Android signing settings. None is an existing Cesium authorization source.
- The only non-empty Ion assignments located remain in the two historical HTML backups noted above. Their presence does not prove they are current, authorized, or restricted to asset 2275207; they remain unsuitable for restoration. The separate [`CesiumScreen`](lib/screens/cesium_screen.dart) contains only the literal `YOUR_CESIUM_TOKEN` placeholder and is not used by the active loader.
- The active [`main.dart`](lib/main.dart) serves the local Cesium assets and loads `Apps/HelloWorld.html`; the active HTML initializes the Ion token as empty, and no supported local token-injection hook exists. Its no-token guard is the first confirmed failure: it prevents the helper from requesting Ion asset 2275207, marks imagery unavailable, and preserves the working 2D map.
- No application or Android build change was made, no credential was copied from backup, and no provider was changed. Wireless ADB still lists the SM-A166P as connected. Existing cold-launch evidence remains the actual before/after verification for the current source; this configuration inventory did not claim a new imagery test.
- **Current status: 2D usable; geographic Cesium 3D imagery remains BLOCKED.** Restoring the original path requires an owner-managed, rotated Cesium Ion browser token explicitly authorized for asset 2275207. This is a provider authorization requirement, not evidence that a paid plan is required. Keep the fallback until such a token is supplied through secure local configuration; do not send it in chat. The active loader must first receive an explicit, tested local configuration path, followed by a real Android imagery retest before any fix is claimed.

## 24. Live validation of the user-supplied Cesium Ion token (2026-10-12)

### Provider authorization and asset

- The active source HTML now has a non-empty `Cesium.Ion.defaultAccessToken` assignment supplied by the owner. The value is intentionally omitted from this report, console summaries, and saved diagnostic JSON. No direct `Cesium.GoogleMaps.defaultApiKey` is configured.
- The active call is `Cesium.createGooglePhotorealistic3DTileset()` without a `key`. The bundled Cesium helper therefore uses the Ion path. The observed request `api.cesium.com/v1/assets/2275207/endpoint` identifies the actual asset as **2275207**; it is not inferred from the UI label.
- In the live browser run, the asset endpoint returned HTTP 200 twice, the Ion asset host returned HTTP 200, and **357** Google 3D Tiles requests returned HTTP 200. No Cesium/Google imagery request returned 401, 403, or 429. This confirms that the supplied token can access the configured asset and that the provider delivered tiles. The earlier 429 belongs to the separate historical run and was not reproduced here.

### Actual rendering checks

The source HTML was served directly from `assets/cesium` by a loopback-only test server at port 8001. This avoided rebuilding or copying the supplied token into `backend/dist` or an APK. Chrome's existing CDP-controlled page used a 1264×705 CSS viewport at DPR 1 with WebGL 2 on the Intel HD Graphics renderer.

| Test | Result | Evidence |
|---|---|---|
| Source 2D startup | PASS — OSM roads and Gangtok labels rendered; mode `2d`, state `READY`; screenshot 1264×705 | [`cesium-ion-retest-2d-20261012173637.png`](test-evidence/cesium-ion-retest-2d-20261012173637.png) |
| 3D provider authorization | PASS — asset 2275207 endpoint HTTP 200; 357 Google 3D Tiles HTTP 200 responses in the retest | [`cesium-ion-retest-20261012173637.json`](test-evidence/cesium-ion-retest-20261012173637.json) |
| 3D visual rendering | PASS with an intermittent blank first frame — a later controlled run visibly rendered Gangtok rooftops, roads, vegetation, and existing police overlays; screenshots 1264×705 | [`cesium-ion-render-without-extra-sync-20261012173902.png`](test-evidence/cesium-ion-render-without-extra-sync-20261012173902.png), [`cesium-ion-desktop-3d-tilt-20261012173337.png`](test-evidence/cesium-ion-desktop-3d-tilt-20261012173337.png) |
| 3D to 2D return | PASS — mode returned to `2d`, status remained ready, and OSM roads rendered; screenshot 1264×705 | [`cesium-ion-retest-return-2d-20261012173637.png`](test-evidence/cesium-ion-retest-return-2d-20261012173637.png) |
| Physical-phone source-page check | PASS — current source HTML opened on the connected SM-A166P through a temporary ADB reverse loopback mapping; 2D OSM and 3D photorealistic imagery were both visible in the phone browser; screenshots 1080×2340 | [`cesium-ion-android-chrome-source-20261012.png`](test-evidence/cesium-ion-android-chrome-source-20261012.png), [`cesium-ion-android-map-controls-20261012.png`](test-evidence/cesium-ion-android-map-controls-20261012.png) |

One screenshot taken shortly after selecting 3D showed a blank scene even though the app state was `READY` and provider requests were successful. In a controlled repeat, the 3D imagery was visible after 15 seconds without an extra camera-sync call; a second screenshot after an additional sync had the same image hash. This points to a transient first-frame/tile-render delay, but the intermittent blank capture was not fully explained and no camera or rendering code change is claimed. A right-button drag left the imagery visible; an oblique view sufficient to independently verify building-height geometry was not established. The imagery is a photorealistic 3D Tiles surface, not a separate terrain-elevation provider.

The phone check used the current source page in Chrome via the temporary loopback route, not a rebuilt Flutter APK. The installed app's WebView DevTools socket was unavailable, and the APK was not rebuilt because doing so would copy the exposed token into another artifact. Thus this is genuine on-device browser rendering of the current HTML, not a claim that the installed APK was updated.

### Errors, correction, and security

- Non-provider errors during the static-source run were: `127.0.0.1:3000/api/monitoring/status` connection refused because the backend was not started, and Overpass returned HTTP 504. Cesium also logged a non-blocking Google-geocoder configuration warning. None prevented the tested tiles from loading.
- Corrected one stale Map Controls description in [`HelloWorld.html`](assets/cesium/Apps/HelloWorld.html): it no longer says that no token is configured. No layout, branding, control, provider, backend, or routing behavior was changed.
- The diagnostic JSON was checked against the exact and URL-encoded source token; neither was present. The token was not copied into generated client output, the APK, logs, or this report. No build or backend test was run; the changed application line is display-only, and the direct-source browser retest confirmed the text, 2D startup, 3D state, and return to 2D.
- **Security action required:** the token was pasted into chat and is in the source HTML, so treat it as compromised and revoke/rotate it promptly in Cesium Ion. Replace it only with a new browser token restricted to asset 2275207 and any origin/referrer restrictions and expiry controls the provider supports. Browser tokens are visible to the client by design; they cannot be kept secret in a distributed app. Do not paste the replacement into chat or commit it. The active Flutter loader has no secure local-token injection mechanism yet, so the source assignment is not a safe long-term configuration. Keep the 2D fallback and do not rebuild/distribute this token-bearing source until the replacement and local configuration path are addressed.

## 25. Follow-up: generated-page token mismatch (2026-10-12)

- **Confirmed source of the “token not configured” discrepancy:** [`assets/cesium/Apps/HelloWorld.html`](assets/cesium/Apps/HelloWorld.html) has a non-empty Ion token assignment, while [`backend/dist/HelloWorld.html`](backend/dist/HelloWorld.html) has an empty assignment and still contains the old Map Controls copy saying no token is configured. The previously successful imagery test served the source HTML directly; it did not validate the generated `backend/dist` page.
- The check in both pages is `if (!Cesium.Ion.defaultAccessToken)`. It correctly refuses to request the tileset when the value is empty. The generated file reports unavailable because its own token value is empty; changing this check to accept a missing token would falsely mark imagery available and was not done. The active Map Controls source copy was already corrected; the generated copy is stale.
- The build script [`minify-helloworld.js`](backend/build/minify-helloworld.js) reads the source HTML and minifies its inline scripts while preserving the surrounding HTML. Therefore running `build:client` now would copy the exposed source credential into `backend/dist/HelloWorld.html`. It was not run. The existing `.env` is not read by this client build or the active Flutter loader.
- The Flutter app serves `assets/cesium` from the installed app bundle, not `backend/dist`. At this check, the phone was connected but its foreground activity was WhatsApp and SafeRoute had no running process; the controlled desktop Chrome tab was a previously loaded `http://127.0.0.1:8001/Apps/HelloWorld.html` source-test page, not a current app launch. Port 8000's old server returned an empty reply. Accordingly, no currently running SafeRoute app page was available for an honest live retest, and no claim is made that the current installed APK now shows imagery.
- No application, generated-client, token-detection, or provider change was made in this follow-up. The only file changed is this report. No credential value was printed, copied, regenerated, or used for a new network test.
- **Required local next step:** revoke the token pasted into chat and create a replacement Cesium Ion browser token authorized to read asset 2275207, restricted as tightly as the Ion account permits. After rotation, replace the value locally on the existing `Cesium.Ion.defaultAccessToken` assignment in the source HTML, then review and run the intended build for the target: `npm.cmd --prefix backend run build:client` for the generated client, or rebuild the Flutter app to embed the updated asset. Do not put the replacement in chat or a privileged server `.env`. Both generated HTML and an APK are client-readable artifacts; use only a restricted browser token. The safe stopping point is before either build, until the replacement is present locally. Afterward, test the exact generated page or freshly installed app, including asset 2275207's HTTP response, visible imagery, and 2D↔3D switching.
