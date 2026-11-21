#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA_DIR, "raw");
const PROCESSED_DIR = path.join(DATA_DIR, "processed");

function parseCsvLine(rawLine) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    if (char === '"') {
      if (inQuotes && rawLine[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsvText(text) {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];
  const rows = cleaned.split("\n");
  if (rows.length < 2) return [];
  const headers = parseCsvLine(rows[0]);
  return rows.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] !== undefined ? values[index] : "";
    });
    return row;
  });
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function computeTimeRange(items, field) {
  const values = items.map((item) => item[field]).filter(Boolean).sort();
  if (!values.length) return null;
  return { start: values[0], end: values[values.length - 1] };
}

function readFloodData() {
  const floodFile = path.join(RAW_DIR, "open meteo", "sikkim flood data .csv.csv");
  const text = fs.readFileSync(floodFile, "utf8");
  const sections = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const locations = parseCsvText(sections[0]);
  const series = parseCsvText(sections[1]);

  const normalizedLocations = locations.map((entry) => ({
    location_id: toNumber(entry.location_id),
    latitude: toNumber(entry.latitude),
    longitude: toNumber(entry.longitude),
    elevation_m: toNumber(entry.elevation),
    utc_offset_seconds: toNumber(entry.utc_offset_seconds),
    timezone: entry.timezone,
    timezone_abbreviation: entry.timezone_abbreviation,
  }));

  const normalizedSeries = series.map((entry) => ({
    location_id: toNumber(entry.location_id),
    time: entry.time,
    river_discharge_m3_s: toNumber(entry["river_discharge (m³/s)"]),
    river_discharge_mean_m3_s: toNumber(entry["river_discharge_mean (m³/s)"]),
    river_discharge_max_m3_s: toNumber(entry["river_discharge_max (m³/s)"]),
  }));

  const timeRange = computeTimeRange(normalizedSeries, "time");
  return {
    file: floodFile,
    datasetType: "provider_modeled_discharge",
    source: "Open-Meteo provider-derived river-discharge estimates for Sikkim; not in-situ gauge observations",
    location_count: normalizedLocations.length,
    record_count: normalizedSeries.length,
    time_range: timeRange,
    units: {
      river_discharge_m3_s: "m³/s",
    },
    locations: normalizedLocations,
    series: normalizedSeries,
  };
}

function readWeatherData() {
  const weatherFile = path.join(RAW_DIR, "isro_nrsc", "open-meteo-27.38N88.59E1588m.csv");
  const text = fs.readFileSync(weatherFile, "utf8");
  const sections = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const metadata = parseCsvText(sections[0] || "")[0] || {};
  const series = parseCsvText(sections[1] || "").map((entry) => ({
    time: entry.time,
    temperature_2m_c: toNumber(entry["temperature_2m (°C)"]),
    precipitation_mm: toNumber(entry["precipitation (mm)"]),
    rain_mm: toNumber(entry["rain (mm)"]),
    soil_temperature_0_to_7cm_c: toNumber(entry["soil_temperature_0_to_7cm (°C)"]),
    wind_gusts_10m_kmh: toNumber(entry["wind_gusts_10m (km/h)"]),
  }));

  const precipitationValues = series.map((entry) => entry.precipitation_mm).filter((value) => value !== null);
  return {
    file: weatherFile,
    datasetType: "provider_weather_archive",
    source: "Open-Meteo hourly weather archive; not a live runtime feed",
    latitude: toNumber(metadata.latitude),
    longitude: toNumber(metadata.longitude),
    elevation_m: toNumber(metadata.elevation),
    record_count: series.length,
    time_range: computeTimeRange(series, "time"),
    valid_record_count: series.filter((entry) => entry.time && Number.isFinite(entry.precipitation_mm)).length,
    units: {
      precipitation_mm: "mm",
      temperature_2m_c: "°C",
      wind_gusts_10m_kmh: "km/h",
    },
    max_precipitation_mm: precipitationValues.length ? Math.max(...precipitationValues) : null,
    series,
  };
}

function parseCwcTimestamp(value) {
  const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return null;
  const sourceLocal = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    sourceLocal.getUTCFullYear() !== year
    || sourceLocal.getUTCMonth() !== month - 1
    || sourceLocal.getUTCDate() !== day
  ) return null;
  return new Date(sourceLocal.getTime() - 330 * 60 * 1000).toISOString();
}

function readCwcData() {
  const file = path.join(RAW_DIR, "cwc", "cwc sk2026-2030.csv");
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const sourceRows = parseCsvText(text);
  const stations = new Map();
  const records = [];
  const invalid = { timestamp: 0, value: 0, coordinates: 0, station: 0, agency: 0, state: 0 };
  const seenStationTimestamps = new Set();
  let duplicateCount = 0;

  for (const row of sourceRows) {
    const timestamp = parseCwcTimestamp(row["Data Acquisition Time"]);
    const value = toNumber(row["Telemetry Hourly River Water Discharge (m3/sec)"]);
    const latitude = toNumber(row.Latitude);
    const longitude = toNumber(row.Longitude);
    const station = (row.Station || "").trim();
    let valid = true;

    if (!timestamp) { invalid.timestamp += 1; valid = false; }
    if (value === null || value < 0) { invalid.value += 1; valid = false; }
    if (latitude === null || latitude < -90 || latitude > 90 || longitude === null || longitude < -180 || longitude > 180) {
      invalid.coordinates += 1;
      valid = false;
    }
    if (!station) { invalid.station += 1; valid = false; }
    if (row.Agency !== "CWC") { invalid.agency += 1; valid = false; }
    if (row.State !== "Sikkim") { invalid.state += 1; valid = false; }
    if (!valid) continue;

    const stationTimestamp = `${station}|${timestamp}`;
    if (seenStationTimestamps.has(stationTimestamp)) {
      duplicateCount += 1;
      continue;
    }
    seenStationTimestamps.add(stationTimestamp);
    if (!stations.has(station)) {
      stations.set(station, {
        station,
        latitude,
        longitude,
        district: row.District || null,
        districtLgdCode: toNumber(row["District LGD Code"]),
        river: row.River && row.River !== "-" ? row.River : null,
        basin: row.Basin && row.Basin !== "-" ? row.Basin : null,
        agency: row.Agency,
        state: row.State,
      });
    }
    records.push({
      sourceRecordId: row._id || row.SlNo,
      station,
      latitude,
      longitude,
      district: row.District || null,
      districtLgdCode: toNumber(row["District LGD Code"]),
      river: row.River && row.River !== "-" ? row.River : null,
      basin: row.Basin && row.Basin !== "-" ? row.Basin : null,
      sourceTimestamp: row["Data Acquisition Time"],
      observedAtUtc: timestamp,
      dischargeM3s: value,
    });
  }

  const timestamps = records.map((record) => record.observedAtUtc).sort();
  const sourceStat = fs.statSync(file);
  return {
    file,
    datasetType: "cwc_reported_river_discharge_snapshot",
    source: "CWC-labelled CSV snapshot; agency field is CWC. The file is a local snapshot, not a connected or verified updating feed.",
    timestampSemantics: "Source timestamp is retained as written. UTC normalization assumes Asia/Kolkata (UTC+05:30); the CSV has no timezone column.",
    sourceModifiedAt: sourceStat.mtime.toISOString(),
    sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    row_count: sourceRows.length,
    valid_record_count: records.length,
    invalid_record_count: sourceRows.length - records.length,
    invalid_counts: invalid,
    duplicate_station_timestamp_count: duplicateCount,
    time_range: timestamps.length ? { start: timestamps[0], end: timestamps[timestamps.length - 1] } : null,
    units: { discharge: "m³/s" },
    station_count: stations.size,
    stations: Array.from(stations.values()).sort((a, b) => a.station.localeCompare(b.station)),
    records,
  };
}

function listRawFiles() {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const contents = fs.readFileSync(fullPath);
      const stats = fs.statSync(fullPath);
      const relativePath = path.relative(RAW_DIR, fullPath);
      files.push({
        kind: relativePath.split(path.sep)[0],
        name: entry.name,
        path: path.relative(ROOT, fullPath),
        size_bytes: stats.size,
        file_type: path.extname(entry.name).toLowerCase().replace(".", "") || "unknown",
        sha256: crypto.createHash("sha256").update(contents).digest("hex"),
      });
    }
  };
  visit(RAW_DIR);
  return files;
}

function buildPdfSummary() {
  const rawPdfFiles = listRawFiles().filter((entry) => entry.file_type === "pdf");
  if (!rawPdfFiles.length) {
    return { files: [], note: "No PDF datasets detected in backend/data/raw." };
  }

  const script = `
from pypdf import PdfReader
from pathlib import Path
import datetime, json, re, sys
base = Path(r"${RAW_DIR}")
items = []
for pdf in sorted(base.rglob('*.pdf')):
    try:
        reader = PdfReader(str(pdf))
        sample = ''
        for page in reader.pages[:1]:
            sample = (page.extract_text() or '')
        items.append({
            'path': str(pdf.relative_to(base.parent)),
            'name': pdf.name,
            'pages': len(reader.pages),
            'sample_text': ' '.join((sample or '').split())[:500]
        })
    except Exception as exc:
        items.append({
            'path': str(pdf.relative_to(base.parent)),
            'name': pdf.name,
            'pages': None,
            'sample_text': f'PDF read failed: {exc}'
        })

def extract_text(filename):
    reader = PdfReader(str(base / filename))
    return '\\n'.join(page.extract_text() or '' for page in reader.pages)

events = []
earthquake_file = 'ssdma/Earthquake_DATA_New sikkim.pdf'
earthquake_text = ' '.join(extract_text(earthquake_file).split())
date_pattern = re.compile(r'[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}')
date_matches = list(date_pattern.finditer(earthquake_text))
for index, match in enumerate(date_matches):
    segment = earthquake_text[match.start():(date_matches[index + 1].start() if index + 1 < len(date_matches) else len(earthquake_text))]
    time_match = re.search(r'[0-9]{1,2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?', segment)
    latitude_match = re.search(r'([0-9]+(\\.[0-9]+)?)[^A-Za-z0-9]*[oO]?[ ]*[Nn]\\b', segment)
    longitude_match = re.search(r'([0-9]+(\\.[0-9]+)?)[^A-Za-z0-9]*[oO]?[ ]*[Ee]\\b', segment)
    if not (time_match and latitude_match and longitude_match):
        continue
    trailing = re.findall(r'[0-9]+(?:\\.[0-9]+)?', segment[longitude_match.end():])
    if len(trailing) < 2:
        continue
    date_text = match.group(0)
    event_date = (datetime.datetime.strptime(date_text, '%Y-%m-%d').date()
                  if '-' in date_text else datetime.datetime.strptime(date_text, '%d/%m/%Y').date())
    time_text = time_match.group(0)
    time_value = datetime.datetime.strptime(time_text, '%H:%M:%S.%f' if '.' in time_text else '%H:%M:%S').time()
    region = re.sub(r'\\s+', ' ', segment[longitude_match.end():]).strip()
    region = re.sub(r'^[0-9]+(?:\\.[0-9]+)?\\s+[0-9]+(?:\\.[0-9]+)?\\s*', '', region)
    events.append({
        'id': f'ssdma-earthquake:{event_date.isoformat()}:{time_value.isoformat()}:{index}',
        'type': 'earthquake',
        'sourceDate': date_text,
        'eventDate': event_date.isoformat(),
        'occurredAtUtc': datetime.datetime.combine(event_date, time_value, tzinfo=datetime.timezone.utc).isoformat(),
        'latitude': float(latitude_match.group(1)),
        'longitude': float(longitude_match.group(1)),
        'depthKm': float(trailing[0]),
        'magnitude': float(trailing[1]),
        'region': region[:300],
        'sourcePath': earthquake_file,
        'provenance': 'Historical earthquake table in the supplied SSDMA PDF; parsed numeric fields, not a current alert.',
    })

fire_file = 'ssdma/hISTORY_FOREST_FIRE sikkim.pdf'
fire_lines = [line.strip() for line in extract_text(fire_file).splitlines() if line.strip()]
fire_pattern = re.compile(r'^([0-9]+)\\s+([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})\\b')
fire_starts = [index for index, line in enumerate(fire_lines) if fire_pattern.search(line)]
for index, line_index in enumerate(fire_starts):
    line = fire_lines[line_index]
    match = fire_pattern.search(line)
    try:
        event_date = datetime.datetime.strptime(match.group(2), '%d/%m/%Y').date()
    except ValueError:
        continue
    date_is_plausible = event_date.year >= 1900
    end = fire_starts[index + 1] if index + 1 < len(fire_starts) else min(line_index + 5, len(fire_lines))
    excerpt = ' '.join(fire_lines[line_index:end])
    location = line[match.end():].strip(' -\\t')[:160] or None
    events.append({
        'id': f'ssdma-forest-fire:{index}:{event_date.isoformat()}',
        'type': 'forest_fire',
        'sourceDate': match.group(2),
        'eventDate': event_date.isoformat() if date_is_plausible else None,
        'dateQuality': 'VALID' if date_is_plausible else 'SUSPECT_SOURCE_DATE',
        'occurredAtUtc': None,
        'latitude': None,
        'longitude': None,
        'locationText': location,
        'sourceExcerpt': excerpt[:500],
        'sourcePath': fire_file,
        'provenance': 'Historical forest-fire table in the supplied SSDMA PDF; date and source excerpt retained, coordinates not provided.',
    })

print(json.dumps({'files': items, 'historicalEvents': events}, ensure_ascii=True))
`;

  const output = execFileSync("python", ["-c", script], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  return {
    files: parsed.files,
    historicalEvents: parsed.historicalEvents,
    note: "PDF metadata and explicitly parseable SSDMA historical-event tables extracted where possible.",
  };
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function main() {
  const flood = readFloodData();
  const weather = readWeatherData();
  const cwc = readCwcData();
  const rawFiles = listRawFiles();
  const pdfSummary = buildPdfSummary();
  const processedAt = new Date().toISOString();

  const inventory = {
    generatedAt: processedAt,
    root: path.relative(ROOT, DATA_DIR),
    raw_file_count: rawFiles.length,
    raw_files: rawFiles,
    pdf_summary: pdfSummary,
    flood,
    weather,
    cwc: {
      file: cwc.file,
      datasetType: cwc.datasetType,
      source: cwc.source,
      sourceModifiedAt: cwc.sourceModifiedAt,
      sourceSha256: cwc.sourceSha256,
      row_count: cwc.row_count,
      valid_record_count: cwc.valid_record_count,
      invalid_record_count: cwc.invalid_record_count,
      invalid_counts: cwc.invalid_counts,
      duplicate_station_timestamp_count: cwc.duplicate_station_timestamp_count,
      time_range: cwc.time_range,
      units: cwc.units,
      station_count: cwc.station_count,
      stations: cwc.stations,
    },
    validation: {
      flood_csv_sections: 2,
      flood_locations_valid: flood.locations.every((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude)),
      weather_csv_has_meta: Boolean(weather.latitude && weather.longitude),
      flood_series_is_numeric: flood.series.every((entry) => Number.isFinite(entry.river_discharge_m3_s)),
      weather_series_is_numeric: weather.series.every((entry) => Number.isFinite(entry.precipitation_mm)),
      weather_series_has_valid_time: weather.series.every((entry) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entry.time)),
      cwc_valid_record_count_matches: cwc.valid_record_count === cwc.records.length,
      cwc_station_coordinates_consistent: cwc.stations.every((station) =>
        cwc.records.filter((record) => record.station === station.station)
          .every((record) => record.latitude === station.latitude && record.longitude === station.longitude)),
      cwc_discharge_values_nonnegative: cwc.records.every((record) => Number.isFinite(record.dischargeM3s) && record.dischargeM3s >= 0),
      cwc_utc_timestamps_valid: cwc.records.every((record) => Number.isFinite(Date.parse(record.observedAtUtc))),
      cwc_source_updates_verified: false,
    },
  };

  writeJson(path.join(PROCESSED_DIR, "dataset_inventory.json"), inventory);
  writeJson(path.join(PROCESSED_DIR, "flood_normalized.json"), {
    source: flood.file,
    generatedAt: inventory.generatedAt,
    location_count: flood.location_count,
    record_count: flood.record_count,
    time_range: flood.time_range,
    locations: flood.locations,
    series: flood.series,
  });
  writeJson(path.join(PROCESSED_DIR, "weather_normalized.json"), {
    source: weather.file,
    datasetType: weather.datasetType,
    provenance: weather.source,
    processedAt,
    timestampSemantics: "Original hourly archive timestamp; source metadata timezone is retained.",
    latitude: weather.latitude,
    longitude: weather.longitude,
    elevation_m: weather.elevation_m,
    record_count: weather.record_count,
    time_range: weather.time_range,
    units: weather.units,
    series: weather.series,
  });
  writeJson(path.join(PROCESSED_DIR, "historical_events.json"), {
    processedAt,
    note: "Historical source events only. Missing coordinates are preserved as null; records are not current alerts.",
    record_count: pdfSummary.historicalEvents.length,
    events: pdfSummary.historicalEvents,
  });
  writeJson(path.join(PROCESSED_DIR, "cwc_river_observations.json"), {
    datasetType: cwc.datasetType,
    source: cwc.source,
    sourcePath: path.relative(DATA_DIR, cwc.file),
    sourceSha256: cwc.sourceSha256,
    sourceModifiedAt: cwc.sourceModifiedAt,
    processedAt,
    timestampSemantics: cwc.timestampSemantics,
    sourceTimestampTimezone: "not specified in source; Asia/Kolkata assumed only for normalized UTC timestamps",
    units: cwc.units,
    sourceRowCount: cwc.row_count,
    validRecordCount: cwc.valid_record_count,
    invalidRecordCount: cwc.invalid_record_count,
    invalidCounts: cwc.invalid_counts,
    duplicateStationTimestampCount: cwc.duplicate_station_timestamp_count,
    timeRange: cwc.time_range,
    stationCount: cwc.station_count,
    stations: cwc.stations,
    sourceUpdatesVerified: false,
    updateLimitation: "One local CSV snapshot was processed; no source URL, polling history, or subsequent file version is available to verify ongoing updates.",
    records: cwc.records,
  });

  console.log(JSON.stringify({
    floodLocationCount: flood.location_count,
    floodRecordCount: flood.record_count,
    weatherRecordCount: weather.record_count,
    cwcSourceRowCount: cwc.row_count,
    cwcValidRecordCount: cwc.valid_record_count,
    cwcInvalidRecordCount: cwc.invalid_record_count,
    cwcStationCount: cwc.station_count,
    cwcTimeRange: cwc.time_range,
    inventoryPath: path.join(PROCESSED_DIR, "dataset_inventory.json"),
    floodPath: path.join(PROCESSED_DIR, "flood_normalized.json"),
    weatherPath: path.join(PROCESSED_DIR, "weather_normalized.json"),
    historicalEventCount: pdfSummary.historicalEvents.length,
  }, null, 2));
}

if (require.main === module) main();

module.exports = { parseCsvLine, parseCsvText, parseCwcTimestamp, readCwcData };
