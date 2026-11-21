#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const db = require("../services/db");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROCESSED_DIR = path.join(DATA_DIR, "processed");
const MIGRATION_PATHS = [
  path.join(__dirname, "..", "migrations", "001_historical_observations.sql"),
  path.join(__dirname, "..", "migrations", "002_cwc_river_observations.sql"),
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, file), "utf8"));
}

function buildRows() {
  const flood = readJson("flood_normalized.json");
  const inventory = readJson("dataset_inventory.json");
  const cwc = readJson("cwc_river_observations.json");
  const weather = inventory.weather;
  const processedAt = new Date().toISOString();
  const rows = [];

  for (const item of weather.series) {
    const timestamp = `${item.time}:00Z`;
    const at = new Date(timestamp);
    if (!Number.isFinite(at.getTime()) || at.toISOString().slice(0, 16) !== item.time) {
      throw new Error(`Invalid UTC archive timestamp: ${item.time}`);
    }
    rows.push({
      recordId: `weather:${item.time}`,
      datasetId: "weather_archive",
      recordType: "historical_weather_archive",
      observedAt: item.time,
      observedAtUtc: at.toISOString(),
      locationId: null,
      latitude: weather.latitude,
      longitude: weather.longitude,
      measurements: {
        temperature_2m_c: item.temperature_2m_c,
        precipitation_mm: item.precipitation_mm,
        rain_mm: item.rain_mm,
        soil_temperature_0_to_7cm_c: item.soil_temperature_0_to_7cm_c,
        wind_gusts_10m_kmh: item.wind_gusts_10m_kmh,
      },
      sourcePath: path.relative(DATA_DIR, weather.file),
      provenance: weather.source,
      processedAt,
    });
  }

  for (const item of flood.series) {
    const location = flood.locations.find((entry) => entry.location_id === item.location_id);
    const at = new Date(`${item.time}T00:00:00.000Z`);
    if (!location || !Number.isFinite(at.getTime()) || at.toISOString().slice(0, 10) !== item.time) {
      throw new Error(`Invalid discharge record at location ${item.location_id}, time ${item.time}`);
    }
    const isForecast = item.time > new Date().toISOString().slice(0, 10);
    rows.push({
      recordId: `discharge:${item.location_id}:${item.time}`,
      datasetId: "discharge_estimate",
      recordType: isForecast ? "forecast_estimate" : "historical_model_estimate",
      observedAt: item.time,
      observedAtUtc: null,
      locationId: item.location_id,
      latitude: location.latitude,
      longitude: location.longitude,
      measurements: {
        river_discharge_m3_s: item.river_discharge_m3_s,
        river_discharge_mean_m3_s: item.river_discharge_mean_m3_s,
        river_discharge_max_m3_s: item.river_discharge_max_m3_s,
      },
      sourcePath: path.relative(DATA_DIR, flood.source),
      provenance: flood.source ? "Open-Meteo provider-derived discharge estimates; not verified in-situ gauge observations." : "Provider-derived discharge estimates; gauge provenance not independently verified.",
      processedAt,
    });
  }

  const stationIds = new Map(cwc.stations.map((station, index) => [station.station, index + 1]));
  for (const item of cwc.records) {
    const station = cwc.stations.find((entry) => entry.station === item.station);
    if (!station || !Number.isFinite(Date.parse(item.observedAtUtc)) || !Number.isFinite(item.dischargeM3s) || item.dischargeM3s < 0) {
      throw new Error(`Invalid CWC river observation for station ${item.station}, record ${item.sourceRecordId}`);
    }
    rows.push({
      recordId: `cwc:${item.station}:${item.observedAtUtc}`,
      datasetId: "cwc_river_observation",
      recordType: "cwc_reported_discharge",
      observedAt: item.observedAtUtc,
      observedAtUtc: item.observedAtUtc,
      locationId: stationIds.get(item.station),
      latitude: item.latitude,
      longitude: item.longitude,
      measurements: {
        station: item.station,
        river: item.river,
        basin: item.basin,
        district: item.district,
        district_lgd_code: item.districtLgdCode,
        discharge_m3_s: item.dischargeM3s,
        units: "m³/s",
        source_timestamp: item.sourceTimestamp,
        source_record_id: item.sourceRecordId,
      },
      sourcePath: cwc.sourcePath,
      provenance: `${cwc.source} Source timestamp timezone is absent; UTC conversion assumes Asia/Kolkata (UTC+05:30).`,
      processedAt: cwc.processedAt,
    });
  }

  return rows;
}

function buildEvents() {
  const document = readJson("historical_events.json");
  return document.events.map((event) => ({
    ...event,
    processedAt: document.processedAt,
  }));
}

async function main() {
  const migrations = MIGRATION_PATHS.map((migrationPath) => fs.readFileSync(migrationPath, "utf8"));
  const rows = buildRows();
  const events = buildEvents();
  const client = await db.connect();
  let insertedOrUpdated = 0;
  try {
    await client.query("BEGIN");
    for (const migration of migrations) await client.query(migration);
    const sql = `
      INSERT INTO saferoute_historical_observations (
        record_id, dataset_id, record_type, observed_at, observed_at_utc,
        location_id, latitude, longitude, measurements, source_path,
        provenance, processed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
      ON CONFLICT (record_id) DO UPDATE SET
        dataset_id = EXCLUDED.dataset_id,
        record_type = EXCLUDED.record_type,
        observed_at = EXCLUDED.observed_at,
        observed_at_utc = EXCLUDED.observed_at_utc,
        location_id = EXCLUDED.location_id,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        measurements = EXCLUDED.measurements,
        source_path = EXCLUDED.source_path,
        provenance = EXCLUDED.provenance,
        processed_at = EXCLUDED.processed_at
    `;
    const batchSize = 400;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const values = [];
      const placeholders = batch.map((row, index) => {
        const base = index * 12;
        values.push(
          row.recordId, row.datasetId, row.recordType, row.observedAt,
          row.observedAtUtc, row.locationId, row.latitude, row.longitude,
          JSON.stringify(row.measurements), row.sourcePath, row.provenance, row.processedAt
        );
        return `(${Array.from({ length: 12 }, (_, offset) => `$${base + offset + 1}`).join(", ")})`;
      });
      const result = await client.query(`
        INSERT INTO saferoute_historical_observations (
          record_id, dataset_id, record_type, observed_at, observed_at_utc,
          location_id, latitude, longitude, measurements, source_path,
          provenance, processed_at
        ) VALUES ${placeholders.join(", ")}
        ON CONFLICT (record_id) DO UPDATE SET
          dataset_id = EXCLUDED.dataset_id,
          record_type = EXCLUDED.record_type,
          observed_at = EXCLUDED.observed_at,
          observed_at_utc = EXCLUDED.observed_at_utc,
          location_id = EXCLUDED.location_id,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          measurements = EXCLUDED.measurements,
          source_path = EXCLUDED.source_path,
          provenance = EXCLUDED.provenance,
          processed_at = EXCLUDED.processed_at
      `, values);
      insertedOrUpdated += result.rowCount;
    }
    for (const event of events) {
      await client.query(`
        INSERT INTO saferoute_historical_events (
          event_id, event_type, event_date, occurred_at_utc, latitude,
          longitude, location_text, details, source_path, provenance,
          processed_at
        ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
        ON CONFLICT (event_id) DO UPDATE SET
          event_type = EXCLUDED.event_type,
          event_date = EXCLUDED.event_date,
          occurred_at_utc = EXCLUDED.occurred_at_utc,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          location_text = EXCLUDED.location_text,
          details = EXCLUDED.details,
          source_path = EXCLUDED.source_path,
          provenance = EXCLUDED.provenance,
          processed_at = EXCLUDED.processed_at
      `, [
        event.id,
        event.type,
        event.eventDate,
        event.occurredAtUtc,
        event.latitude,
        event.longitude,
        event.locationText || event.region || null,
        JSON.stringify(event),
        path.relative(DATA_DIR, path.join(DATA_DIR, "raw", event.sourcePath)),
        event.provenance,
        event.processedAt,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const counts = await db.query(`
    SELECT dataset_id, record_type, COUNT(*)::integer AS record_count,
           MIN(observed_at) AS range_start, MAX(observed_at) AS range_end
    FROM saferoute_historical_observations
    GROUP BY dataset_id, record_type
    ORDER BY dataset_id, record_type
  `);
  const eventCounts = await db.query(`
    SELECT event_type, COUNT(*)::integer AS record_count,
           MIN(event_date)::text AS range_start, MAX(event_date)::text AS range_end,
           COUNT(*) FILTER (WHERE latitude IS NOT NULL)::integer AS geolocated_count
    FROM saferoute_historical_events
    GROUP BY event_type
    ORDER BY event_type
  `);
  console.log(JSON.stringify({
    status: "ok",
    processedAt: new Date().toISOString(),
    upsertedRows: insertedOrUpdated,
    datasets: counts.rows,
    historicalEvents: eventCounts.rows,
    upsertedEvents: events.length,
    cwcSourceUpdatesVerified: false,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[load-historical-data] failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
