"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const inventoryPath = path.join(__dirname, "..", "data", "processed", "dataset_inventory.json");
const floodPath = path.join(__dirname, "..", "data", "processed", "flood_normalized.json");
const weatherPath = path.join(__dirname, "..", "data", "processed", "weather_normalized.json");
const eventsPath = path.join(__dirname, "..", "data", "processed", "historical_events.json");
const { parseCwcTimestamp, readCwcData } = require("../scripts/process-datasets");

test("dataset inventory captures the real flood and weather sources", () => {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  assert.ok(inventory.flood);
  assert.ok(inventory.weather);
  assert.equal(inventory.flood.location_count >= 6, true);
  assert.equal(inventory.flood.record_count > 100, true);
  assert.equal(inventory.weather.record_count > 100, true);
  assert.equal(inventory.weather.valid_record_count, inventory.weather.record_count);
  assert.ok(inventory.weather.time_range.start);
  assert.ok(inventory.weather.time_range.end);
  assert.match(inventory.weather.source, /not a live runtime feed/i);
  assert.equal(inventory.validation.flood_locations_valid, true);
  assert.equal(inventory.validation.weather_csv_has_meta, true);
  assert.equal(inventory.validation.weather_series_is_numeric, true);
  assert.equal(inventory.validation.weather_series_has_valid_time, true);
});

test("flood normalized output preserves validated geometry and time range", () => {
  const flood = JSON.parse(fs.readFileSync(floodPath, "utf8"));
  assert.equal(flood.locations.length >= 6, true);
  assert.ok(Array.isArray(flood.series));
  assert.ok(flood.time_range);
  assert.ok(flood.time_range.start);
  assert.ok(flood.time_range.end);
  assert.equal(flood.series.every((entry) => Number.isFinite(entry.river_discharge_m3_s)), true);
  const uniqueLocations = new Set(flood.series.map((entry) => entry.location_id));
  assert.equal(uniqueLocations.size >= 6, true);
});

test("flood discharge provenance is not classified as verified live gauge telemetry", () => {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  assert.equal(inventory.flood.datasetType, "provider_modeled_discharge");
  assert.match(inventory.flood.source, /not in-situ gauge observations/i);
});

test("raw inventory recursively records file fingerprints and normalized weather timestamps", () => {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const weather = JSON.parse(fs.readFileSync(weatherPath, "utf8"));
  assert.equal(inventory.raw_file_count, 10);
  assert.equal(inventory.raw_files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
  assert.equal(inventory.raw_files.filter((file) => file.file_type === "pdf").length, 7);
  assert.equal(weather.datasetType, "provider_weather_archive");
  assert.equal(weather.series.length, inventory.weather.record_count);
  assert.equal(weather.latitude, inventory.weather.latitude);
  assert.equal(weather.longitude, inventory.weather.longitude);
  assert.equal(weather.series.every((row) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.time)), true);
});

test("CWC CSV validates station metadata, timestamps, values, and stale snapshot provenance", () => {
  const cwc = readCwcData();
  assert.equal(cwc.row_count, 45061);
  assert.equal(cwc.station_count, 3);
  assert.equal(cwc.valid_record_count, 43829);
  assert.equal(cwc.invalid_record_count, 1232);
  assert.equal(cwc.duplicate_station_timestamp_count, 0);
  assert.equal(cwc.stations.every((station) => station.agency === "CWC"), true);
  assert.equal(cwc.stations.every((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude)), true);
  assert.equal(cwc.stations.every((station) => station.river === null), true);
  assert.equal(cwc.records.every((record) => record.dischargeM3s >= 0 && record.observedAtUtc.endsWith("Z")), true);
  assert.equal(cwc.time_range.end, "2026-08-08T03:15:00.000Z");
  assert.equal(cwc.source.includes("not a connected or verified updating feed"), true);
  assert.equal(parseCwcTimestamp("31-02-2026 10:00"), null);
  assert.equal(parseCwcTimestamp("08-08-2026 12:45"), "2026-08-08T07:15:00.000Z");
});

test("structured historical PDF events preserve provenance and reject implausible source dates", () => {
  const normalized = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
  const earthquakes = normalized.events.filter((event) => event.type === "earthquake");
  const fires = normalized.events.filter((event) => event.type === "forest_fire");
  assert.equal(earthquakes.length, 59);
  assert.equal(earthquakes.every((event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude) && Number.isFinite(event.magnitude)), true);
  assert.equal(earthquakes[0].eventDate, "2006-02-03");
  assert.equal(earthquakes.at(-1).eventDate, "2019-04-12");
  assert.equal(fires.length, 539);
  assert.equal(fires.every((event) => event.latitude === null && event.longitude === null), true);
  const suspect = fires.find((event) => event.dateQuality === "SUSPECT_SOURCE_DATE");
  assert.equal(suspect.sourceDate, "20/3/0211");
  assert.equal(suspect.eventDate, null);
  assert.equal(typeof suspect.sourceExcerpt, "string");
  assert.equal(fires.filter((event) => event.eventDate).length, 538);
});
