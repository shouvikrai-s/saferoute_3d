"use strict";

const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");

const DATA_DIR = path.join(__dirname, "..", "data");
const INVENTORY_PATH = path.join(DATA_DIR, "processed", "dataset_inventory.json");
const VALID_DATASETS = new Set(["weather", "discharge", "cwc"]);
const MAX_ASSESSMENT_DISTANCE_METERS = 100000;
const CWC_FRESHNESS_LIMIT_HOURS = 6;

function readInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getCatalog() {
  const inventory = readInventory();
  const [result, eventResult] = await Promise.all([db.query(`
    SELECT dataset_id, record_type, COUNT(*)::integer AS record_count,
           MIN(observed_at) AS range_start, MAX(observed_at) AS range_end,
           GREATEST(COUNT(DISTINCT location_id), COUNT(DISTINCT (latitude, longitude)))::integer AS location_count,
           COUNT(DISTINCT (latitude, longitude))::integer AS coordinate_count
    FROM saferoute_historical_observations
    GROUP BY dataset_id, record_type
    ORDER BY dataset_id, record_type
  `), db.query(`
    SELECT event_type, COUNT(*)::integer AS record_count,
           MIN(event_date)::text AS range_start, MAX(event_date)::text AS range_end,
           COUNT(*) FILTER (WHERE latitude IS NOT NULL)::integer AS geolocated_count
    FROM saferoute_historical_events
    GROUP BY event_type
    ORDER BY event_type
  `)]);
  const roadFiles = [
    "data/sikkim-kalimpong.osm.pbf",
    "data/replacement-20261010/north-east-roads.osm.pbf",
    "data/replacement-20261010/east-zone-roads.osm.pbf",
    "data/replacement-20261010/sikkim-network-expanded-20261010.osm.pbf",
  ].map((relativePath) => {
    const fullPath = path.join(DATA_DIR, relativePath.replace(/^data[\\/]/, ""));
    const exists = fs.existsSync(fullPath);
    return {
      path: relativePath,
      exists,
      sizeBytes: exists ? fs.statSync(fullPath).size : null,
      dataType: "OpenStreetMap road-network extract; routing/map reference, not traffic observations",
    };
  });

  return {
    status: "ok",
    generatedAt: new Date().toISOString(),
    processedAt: inventory.generatedAt,
    datasets: result.rows.map((row) => ({
      id: row.dataset_id,
      recordType: row.record_type,
      recordCount: row.record_count,
      timeRange: { start: row.range_start, end: row.range_end },
      locationCount: row.location_count,
      coordinateCount: row.coordinate_count,
      status: "DATABASE_LOADED",
    })),
    historicalEvents: eventResult.rows.map((row) => ({
      id: row.event_type,
      recordCount: row.record_count,
      timeRange: { start: row.range_start, end: row.range_end },
      geolocatedCount: row.geolocated_count,
      status: "HISTORICAL_REFERENCE_ONLY",
    })),
    rawFiles: inventory.raw_files.map((file) => {
      const pdf = inventory.pdf_summary.files.find((entry) => entry.name === file.name && entry.path === file.path.replace(/^data[\\/]/, ""));
      return {
        kind: file.kind,
        name: file.name,
        path: file.path,
        format: file.file_type,
        sizeBytes: file.size_bytes,
        sha256: file.sha256,
        ingestion: file.file_type === "csv" ? "NORMALIZED_AND_DATABASE_LOADED" : "CATALOGUED_REFERENCE_ONLY",
        ...(pdf ? {
          pages: pdf.pages,
          extractableTextSample: pdf.sample_text,
          textExtractionStatus: pdf.sample_text ? "SAMPLE_EXTRACTED_NOT_EVENT_INGESTED" : "NO_TEXT_EXTRACTED",
        } : {}),
      };
    }),
    cwcSnapshot: inventory.cwc ? {
      source: inventory.cwc.source,
      sourcePath: path.relative(DATA_DIR, inventory.cwc.file),
      sourceModifiedAt: inventory.cwc.sourceModifiedAt,
      sourceSha256: inventory.cwc.sourceSha256,
      sourceRowCount: inventory.cwc.row_count,
      validRecordCount: inventory.cwc.valid_record_count,
      invalidRecordCount: inventory.cwc.invalid_record_count,
      stationCount: inventory.cwc.station_count,
      timeRange: inventory.cwc.time_range,
      sourceUpdatesVerified: false,
      updateLimitation: "Single local file snapshot; no feed polling or successive source versions were available to verify ongoing updates.",
    } : null,
    roadNetworkFiles: roadFiles,
    geographicCoverage: {
      districtBoundaryFilesFound: inventory.raw_files.some((file) => ["geojson", "shp", "gpkg", "kml"].includes(file.file_type)),
      note: "Town markers and routing coverage are references, not administrative boundary data. District-level attribution is not inferred from point coordinates.",
    },
  };
}

function classifyCwcFreshness(observedAtUtc, now = Date.now()) {
  const observedAt = Date.parse(observedAtUtc);
  if (!Number.isFinite(observedAt)) return { status: "UNAVAILABLE", ageSeconds: null };
  const ageSeconds = Math.floor((now - observedAt) / 1000);
  if (ageSeconds < -300) return { status: "FUTURE_TIMESTAMP", ageSeconds };
  if (ageSeconds > CWC_FRESHNESS_LIMIT_HOURS * 3600) return { status: "STALE", ageSeconds };
  return { status: "RECENT_SNAPSHOT_NOT_LIVE", ageSeconds: Math.max(0, ageSeconds) };
}

async function getRiverObservations() {
  const inventory = readInventory();
  const snapshot = inventory.cwc;
  const generatedAt = new Date().toISOString();
  const now = Date.now();
  const result = await db.query(`
    SELECT DISTINCT ON (location_id)
           location_id, latitude, longitude, observed_at, observed_at_utc,
           measurements, source_path, provenance, processed_at
    FROM saferoute_historical_observations
    WHERE dataset_id = 'cwc_river_observation'
      AND record_type = 'cwc_reported_discharge'
    ORDER BY location_id, observed_at_utc DESC, record_id DESC
  `);
  const stations = result.rows.map((row) => {
    const freshness = classifyCwcFreshness(row.observed_at_utc, now);
    return {
      station: row.measurements.station,
      locationId: row.location_id,
      district: row.measurements.district,
      river: row.measurements.river,
      basin: row.measurements.basin,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      dischargeM3s: Number(row.measurements.discharge_m3_s),
      units: row.measurements.units,
      sourceTimestamp: row.measurements.source_timestamp,
      observedAtUtc: row.observed_at_utc,
      ageSeconds: freshness.ageSeconds,
      freshness: freshness.status,
      source: row.source_path,
      provenance: row.provenance,
      processedAt: row.processed_at,
    };
  });
  const latestTimestamp = stations.reduce((latest, station) =>
    !latest || station.observedAtUtc > latest ? station.observedAtUtc : latest, null);
  const freshness = latestTimestamp ? classifyCwcFreshness(latestTimestamp, now).status : "UNAVAILABLE";
  return {
    status: freshness,
    dataset: "cwc_river_observation",
    generatedAt,
    snapshotProcessedAt: snapshot ? inventory.generatedAt : null,
    source: snapshot ? snapshot.source : "CWC river-discharge dataset has not been processed.",
    sourcePath: snapshot ? path.relative(DATA_DIR, snapshot.file) : null,
    sourceModifiedAt: snapshot ? snapshot.sourceModifiedAt : null,
    sourceRowCount: snapshot ? snapshot.row_count : 0,
    validRecordCount: snapshot ? snapshot.valid_record_count : 0,
    invalidRecordCount: snapshot ? snapshot.invalid_record_count : 0,
    sourceTimestampTimezone: "Timezone is not specified in the CSV; normalized UTC timestamps assume Asia/Kolkata (UTC+05:30).",
    units: "m³/s",
    freshnessThresholdHours: CWC_FRESHNESS_LIMIT_HOURS,
    latestObservedAtUtc: latestTimestamp,
    sourceUpdatesVerified: false,
    updateLimitation: "This API reads one imported local CSV snapshot. No live CWC connection, polling, or source-version history is configured; a recent snapshot must not be labeled LIVE.",
    stationCount: stations.length,
    stations,
  };
}

function validDateParameter(name, value) {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${name} must be an ISO calendar date (YYYY-MM-DD).`);
    error.statusCode = 400;
    throw error;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    const error = new Error(`${name} must be a valid calendar date.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function validBound(name, value, minimum, maximum) {
  if (value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    const error = new Error(`${name} must be between ${minimum} and ${maximum}.`);
    error.statusCode = 400;
    throw error;
  }
  return numeric;
}

async function getEvents(filters) {
  if (!["earthquake", "forest_fire"].includes(filters.type)) {
    const error = new Error("type must be earthquake or forest_fire.");
    error.statusCode = 400;
    throw error;
  }
  const start = validDateParameter("start", filters.start);
  const end = validDateParameter("end", filters.end);
  if (start && end && start > end) {
    const error = new Error("start must be on or before end.");
    error.statusCode = 400;
    throw error;
  }
  const minLat = validBound("minLat", filters.minLat, -90, 90);
  const maxLat = validBound("maxLat", filters.maxLat, -90, 90);
  const minLon = validBound("minLon", filters.minLon, -180, 180);
  const maxLon = validBound("maxLon", filters.maxLon, -180, 180);
  if (minLat !== null && maxLat !== null && minLat > maxLat) {
    const error = new Error("minLat must not exceed maxLat.");
    error.statusCode = 400;
    throw error;
  }
  if (minLon !== null && maxLon !== null && minLon > maxLon) {
    const error = new Error("minLon must not exceed maxLon.");
    error.statusCode = 400;
    throw error;
  }
  const limit = filters.limit;
  const offset = filters.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) {
    const error = new Error("limit must be 1..500 and offset must be 0..1000000.");
    error.statusCode = 400;
    throw error;
  }
  const result = await db.query(`
    SELECT event_id, event_type, event_date::text AS event_date,
           occurred_at_utc, latitude, longitude, location_text, details,
           details->>'sourceDate' AS source_date,
           source_path, provenance, processed_at
    FROM saferoute_historical_events
    WHERE event_type = $1
      AND ($2::date IS NULL OR event_date >= $2::date)
      AND ($3::date IS NULL OR event_date <= $3::date)
      AND ($4::double precision IS NULL OR latitude >= $4)
      AND ($5::double precision IS NULL OR latitude <= $5)
      AND ($6::double precision IS NULL OR longitude >= $6)
      AND ($7::double precision IS NULL OR longitude <= $7)
    ORDER BY event_date DESC, event_id ASC
    LIMIT $8 OFFSET $9
  `, [filters.type, start || null, end || null, minLat, maxLat, minLon, maxLon, limit, offset]);
  return {
    status: "ok",
    type: filters.type,
    generatedAt: new Date().toISOString(),
    eventSemantics: "Historical events parsed from archived authority/source documents; these are not current incidents or warnings.",
    count: result.rows.length,
    limit,
    offset,
    events: result.rows.map((row) => ({
      id: row.event_id,
      type: row.event_type,
      sourceDate: row.source_date,
      normalizedEventDate: row.event_date,
      occurredAtUtc: row.occurred_at_utc,
      latitude: row.latitude,
      longitude: row.longitude,
      locationText: row.location_text,
      details: row.details,
      source: row.source_path,
      provenance: row.provenance,
      processedAt: row.processed_at,
    })),
  };
}

function validateHistoryFilters({ dataset, start, end, locationId, includeForecast, limit, offset }) {
  if (!VALID_DATASETS.has(dataset)) {
    const error = new Error("dataset must be weather, discharge, or cwc.");
    error.statusCode = 400;
    throw error;
  }
  for (const [name, date] of [["start", start], ["end", end]]) {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const error = new Error(`${name} must be an ISO calendar date (YYYY-MM-DD).`);
      error.statusCode = 400;
      throw error;
    }
    if (date !== undefined) {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        const error = new Error(`${name} must be a valid calendar date.`);
        error.statusCode = 400;
        throw error;
      }
    }
  }
  if (start && end && start > end) {
    const error = new Error("start must be on or before end.");
    error.statusCode = 400;
    throw error;
  }
  if (locationId !== undefined && (!/^\d+$/.test(String(locationId)) || Number(locationId) > 100000)) {
    const error = new Error("locationId must be a non-negative integer.");
    error.statusCode = 400;
    throw error;
  }
  if (typeof includeForecast !== "boolean") {
    const error = new Error("includeForecast must be a boolean.");
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    const error = new Error("limit must be between 1 and 500.");
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) {
    const error = new Error("offset must be between 0 and 1000000.");
    error.statusCode = 400;
    throw error;
  }
}

async function getHistory(filters) {
  validateHistoryFilters(filters);
  const datasetId = filters.dataset === "weather"
    ? "weather_archive"
    : filters.dataset === "discharge" ? "discharge_estimate" : "cwc_river_observation";
  const types = filters.dataset === "weather"
    ? ["historical_weather_archive"]
    : filters.dataset === "discharge"
      ? filters.includeForecast
        ? ["historical_model_estimate", "forecast_estimate"]
        : ["historical_model_estimate"]
      : ["cwc_reported_discharge"];
  const query = await db.query(`
    SELECT record_id, dataset_id, record_type, observed_at, observed_at_utc,
           location_id, latitude, longitude, measurements, source_path,
           provenance, processed_at
    FROM saferoute_historical_observations
    WHERE dataset_id = $1
      AND record_type = ANY($2::text[])
      AND ($3::date IS NULL OR observed_at >= $3::text)
      AND ($4::date IS NULL OR observed_at < ($4::date + 1)::text)
      AND ($5::integer IS NULL OR location_id = $5)
    ORDER BY observed_at ASC, location_id ASC
    LIMIT $6 OFFSET $7
  `, [
    datasetId,
    types,
    filters.start || null,
    filters.end || null,
    filters.locationId === undefined ? null : Number(filters.locationId),
    filters.limit,
    filters.offset,
  ]);
  return {
    status: "ok",
    dataset: filters.dataset,
    recordTypes: types,
    generatedAt: new Date().toISOString(),
    timeSemantics: filters.dataset === "weather"
      ? "Hourly historical archive; observed_at_utc is normalized from source metadata timezone GMT."
      : filters.dataset === "discharge"
        ? "Provider-derived daily model estimates, not gauge observations. Future-dated items are excluded unless includeForecast=true."
        : "CWC-labelled source CSV observations. Original Data Acquisition Time text is preserved in measurements.source_timestamp; observed_at_utc assumes Asia/Kolkata because the CSV does not specify a timezone. These records are from one local snapshot, not a verified live-updating feed.",
    count: query.rows.length,
    limit: filters.limit,
    offset: filters.offset,
    records: query.rows.map((row) => ({
      id: row.record_id,
      dataset: row.dataset_id,
      recordType: row.record_type,
      sourceTimestamp: row.observed_at,
      observedAtUtc: row.observed_at_utc,
      locationId: row.location_id,
      latitude: row.latitude,
      longitude: row.longitude,
      measurements: row.measurements,
      source: row.source_path,
      provenance: row.provenance,
      processedAt: row.processed_at,
    })),
  };
}

async function getAssessment(lat, lon) {
  const generatedAt = new Date().toISOString();
  const [weatherResult, dischargeResult] = await Promise.all([
    db.query(`
      SELECT location_id, latitude, longitude, COUNT(*)::integer AS record_count,
             MIN(observed_at) AS range_start, MAX(observed_at) AS range_end,
             COUNT(measurements->>'precipitation_mm')::integer AS precipitation_count,
             AVG((measurements->>'precipitation_mm')::double precision) AS mean_precipitation_mm,
             MAX((measurements->>'precipitation_mm')::double precision) AS max_hourly_precipitation_mm,
             SUM((measurements->>'precipitation_mm')::double precision) AS total_precipitation_mm,
             AVG((measurements->>'temperature_2m_c')::double precision) AS mean_temperature_c,
             MAX(observed_at_utc) AS source_latest_timestamp
      FROM saferoute_historical_observations
      WHERE dataset_id = 'weather_archive'
      GROUP BY location_id, latitude, longitude
    `),
    db.query(`
      SELECT location_id, latitude, longitude, COUNT(*)::integer AS record_count,
             MIN(observed_at) AS range_start, MAX(observed_at) AS range_end,
             AVG((measurements->>'river_discharge_m3_s')::double precision) AS mean_discharge_m3_s,
             MAX((measurements->>'river_discharge_m3_s')::double precision) AS max_discharge_m3_s
      FROM saferoute_historical_observations
      WHERE dataset_id = 'discharge_estimate'
        AND record_type = 'historical_model_estimate'
      GROUP BY location_id, latitude, longitude
    `),
  ]);

  function nearest(rows) {
    const candidates = rows.rows.map((row) => ({
      ...row,
      distanceMeters: distanceMeters(lat, lon, Number(row.latitude), Number(row.longitude)),
    })).sort((a, b) => a.distanceMeters - b.distanceMeters);
    const candidate = candidates[0];
    return candidate && candidate.distanceMeters <= MAX_ASSESSMENT_DISTANCE_METERS ? candidate : null;
  }

  const weather = nearest(weatherResult);
  const discharge = nearest(dischargeResult);
  return {
    status: "ok",
    assessmentType: "HISTORICAL_ARCHIVE_CONTEXT",
    generatedAt,
    requestedLocation: { latitude: lat, longitude: lon },
    limitations: [
      "Descriptive statistics from archived records only; this is not a live observation or forecast.",
      "Nearest source points are used only within 100 km; no district association is inferred without boundary data.",
      "Open-Meteo-derived discharge values are model estimates, not verified river-gauge measurements.",
    ],
    weather: weather ? {
      sourceType: "historical_weather_archive",
      distanceMeters: Math.round(weather.distanceMeters),
      recordCount: weather.record_count,
      precipitationRecordCount: weather.precipitation_count,
      sourceTimeRange: { start: weather.range_start, end: weather.range_end },
      sourceLatestTimestamp: weather.source_latest_timestamp,
      meanHourlyPrecipitationMm: Number(weather.mean_precipitation_mm),
      maxHourlyPrecipitationMm: Number(weather.max_hourly_precipitation_mm),
      totalArchivedPrecipitationMm: Number(weather.total_precipitation_mm),
      meanTemperatureC: Number(weather.mean_temperature_c),
    } : null,
    discharge: discharge ? {
      sourceType: "historical_model_estimate",
      distanceMeters: Math.round(discharge.distanceMeters),
      locationId: discharge.location_id,
      recordCount: discharge.record_count,
      sourceTimeRange: { start: discharge.range_start, end: discharge.range_end },
      meanEstimatedDischargeM3s: Number(discharge.mean_discharge_m3_s),
      maxEstimatedDischargeM3s: Number(discharge.max_discharge_m3_s),
    } : null,
    inferenceTimestamp: generatedAt,
  };
}

module.exports = {
  getCatalog,
  getHistory,
  getAssessment,
  getEvents,
  getRiverObservations,
  classifyCwcFreshness,
  validateHistoryFilters,
};
