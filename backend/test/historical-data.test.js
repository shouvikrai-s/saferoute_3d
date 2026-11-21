"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyCwcFreshness, validateHistoryFilters } = require("../services/historicalData");

function validFilters(overrides = {}) {
  return {
    dataset: "weather",
    includeForecast: false,
    limit: 100,
    offset: 0,
    ...overrides,
  };
}

test("historical data API accepts bounded archive queries", () => {
  assert.doesNotThrow(() => validateHistoryFilters(validFilters({
    start: "2026-09-01",
    end: "2026-10-01",
    locationId: "0",
  })));
  assert.doesNotThrow(() => validateHistoryFilters(validFilters({
    dataset: "discharge",
    includeForecast: true,
    limit: 500,
    offset: 1000,
  })));
  assert.doesNotThrow(() => validateHistoryFilters(validFilters({
    dataset: "cwc",
    limit: 500,
  })));
});

test("historical data API rejects unsupported datasets and malformed date ranges", () => {
  assert.throws(() => validateHistoryFilters(validFilters({ dataset: "traffic" })), {
    statusCode: 400,
    message: "dataset must be weather, discharge, or cwc.",
  });
  assert.throws(() => validateHistoryFilters(validFilters({ start: "2026-02-30" })), {
    statusCode: 400,
    message: "start must be a valid calendar date.",
  });
  assert.throws(() => validateHistoryFilters(validFilters({
    start: "2026-10-02",
    end: "2026-10-01",
  })), { statusCode: 400 });
  assert.throws(() => validateHistoryFilters(validFilters({ includeForecast: null })), {
    statusCode: 400,
  });
});

test("CWC snapshot freshness never claims a live updating feed", () => {
  const now = Date.parse("2026-10-11T07:45:00.000Z");
  assert.deepEqual(classifyCwcFreshness("2026-08-08T03:15:00.000Z", now), {
    status: "STALE",
    ageSeconds: 5545800,
  });
  assert.equal(classifyCwcFreshness("2026-10-11T07:44:00.000Z", now).status, "RECENT_SNAPSHOT_NOT_LIVE");
  assert.equal(classifyCwcFreshness("2026-10-11T08:00:00.000Z", now).status, "FUTURE_TIMESTAMP");
  assert.equal(classifyCwcFreshness(null, now).status, "UNAVAILABLE");
});
