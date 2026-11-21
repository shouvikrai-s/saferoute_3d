"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAirQuality,
  classifyAirQuality,
  classifyLandslide,
  fetchPointTelemetry,
  sumRecentPrecipitation
} = require("../services/liveHazards");

test("air quality tiers use US AQI thresholds and preserve missing samples", () => {
  assert.equal(classifyAirQuality(50), "GOOD");
  assert.equal(classifyAirQuality(51), "MODERATE");
  assert.equal(classifyAirQuality(101), "SENSITIVE");
  assert.equal(classifyAirQuality(151), "UNHEALTHY");
  assert.equal(classifyAirQuality(null), "NO SAMPLE");

  const quality = buildAirQuality({ us_aqi: null, pm2_5: null, pm10: 12, ozone: 24 });
  assert.equal(quality.us_aqi, null);
  assert.equal(quality.pm2_5, null);
  assert.equal(quality.pm10, 12);
  assert.equal(quality.ozone, 24);
  assert.equal(quality.advisory_tier, "NO SAMPLE");
  assert.match(quality.visibility_impact, /visibility itself is not measured/);
});

test("recent precipitation sums only valid measurements inside the requested window", () => {
  const now = Date.parse("2026-11-21T12:30:00Z");
  const result = sumRecentPrecipitation({
    time: [
      "2026-11-18T11:00",
      "2026-11-20T11:00",
      "2026-11-21T11:00",
      "2026-11-21T12:00",
      "2026-11-21T13:00"
    ],
    precipitation: [100, 8, 2.5, 1.25, 50]
  }, 24, now);
  assert.equal(result, 3.75);
});

test("landslide classification stays unknown when both observations are absent", () => {
  assert.equal(classifyLandslide({ precipitationSum: null }, null), "UNKNOWN");
  assert.equal(classifyLandslide({ precipitationSum: 0 }, null), "LOW");
});

test("point telemetry combines current weather, air pollutants, and GloFAS discharge", async () => {
  const originalFetch = global.fetch;
  const now = Date.now();
  const observed = new Date(now - 60 * 60 * 1000).toISOString();
  global.fetch = async (url) => {
    let body;
    if (url.includes("air-quality-api")) {
      body = {
        current: {
          time: observed,
          us_aqi: 72,
          european_aqi: 38,
          pm2_5: 11.2,
          pm10: 17.4,
          ozone: 62,
          nitrogen_dioxide: 4.1,
          carbon_monoxide: 164
        }
      };
    } else if (url.includes("flood-api")) {
      body = { daily: { river_discharge: [123.4] } };
    } else {
      body = {
        current: {
          time: observed,
          temperature_2m: 12.5,
          precipitation: 0.4,
          relative_humidity_2m: 78,
          wind_speed_10m: 6.2
        },
        hourly: {
          time: [new Date(now - 25 * 60 * 60 * 1000).toISOString(), observed],
          precipitation: [1.5, 2.5],
          soil_moisture_27_to_81cm: [0.31, 0.34]
        }
      };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const snapshot = await fetchPointTelemetry(27.3389, 88.6065);
    assert.equal(snapshot.weather.precipitation_1h_mm, 0.4);
    assert.equal(snapshot.weather.precipitation_24h_mm, 2.5);
    assert.equal(snapshot.weather.precipitation_72h_mm, 4);
    assert.equal(snapshot.weather.soil_moisture_27_to_81cm, 0.34);
    assert.equal(snapshot.air_quality.us_aqi, 72);
    assert.equal(snapshot.air_quality.european_aqi, 38);
    assert.equal(snapshot.air_quality.ozone, 62);
    assert.equal(snapshot.air_quality.nitrogen_dioxide, 4.1);
    assert.equal(snapshot.air_quality.carbon_monoxide, 164);
    assert.equal(snapshot.flood.river_discharge_m3s, 123.4);
    assert.deepEqual(snapshot.sourceStatus, {
      weather: "LIVE",
      air_quality: "LIVE",
      flood: "LIVE"
    });
  } finally {
    global.fetch = originalFetch;
  }
});
