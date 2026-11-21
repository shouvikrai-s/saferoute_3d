"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  loadPersistedModel,
  validateArtifact,
  inferFloodForecast,
  buildMonitoringStatus,
  ARTIFACT_PATH,
  persistModel,
  trainFloodModel,
} = require("../services/floodModel");

const TEMP_ARTIFACT = path.join(__dirname, "..", "data", "model-artifacts", "temp-flood-model-check.json");

test("flood model artifact can be loaded from the persisted training output", () => {
  const state = loadPersistedModel();
  assert.equal(state.status, "trained");
  assert.ok(state.artifact && state.artifact.status === "trained");
  assert.equal(validateArtifact(state.artifact), true);
  assert.ok(ARTIFACT_PATH.endsWith("saferoute-flood-baseline-0.2.0.json"));
});

test("flood inference returns a numeric forecast with a proper limitation statement", () => {
  const result = inferFloodForecast({
    task: "flood",
    location_id: 0,
    history: [4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.8, 5.1, 5.2],
  });

  assert.equal(result.task, "flood");
  assert.equal(result.model, "SafeRouteFloodBaseline");
  assert.equal(result.modelVersion, "0.2.0");
  assert.equal(typeof result.forecast.value, "number");
  assert.ok(Number.isFinite(result.forecast.value));
  assert.equal(result.provenanceVerified, false);
  assert.equal(result.sourceStatus, "MODEL");
  assert.equal(result.forecast.risk, "UNKNOWN");
  assert.equal(result.forecast.evaluation.status, "UNDERPERFORMS_BASELINE");
  assert.equal(result.forecast.evaluation.eligible_as_warning, false);
  assert.match(result.explanation, /input provenance is not independently verified/i);
  assert.ok(result.explanation.match(/not an official flood alert/i));
});

test("flood inference rejects invalid histories and unsupported locations", () => {
  assert.throws(
    () => inferFloodForecast({ task: "flood", location_id: 0, history: [1, 2, 3] }),
    { code: "insufficient_data" }
  );

  assert.throws(
    () => inferFloodForecast({ task: "flood", location_id: 99, history: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] }),
    { code: "insufficient_data" }
  );
});

test("flood model persists and fails gracefully when a missing artifact is requested", () => {
  const artifact = trainFloodModel();
  const saved = persistModel(artifact, TEMP_ARTIFACT);
  const state = loadPersistedModel({ path: TEMP_ARTIFACT, createDefault: false });
  assert.equal(state.status, "trained");
  assert.equal(validateArtifact(state.artifact), true);
  assert.ok(saved.endsWith("temp-flood-model-check.json"));

  const missingState = loadPersistedModel({ path: path.join(__dirname, "..", "missing-artifact.json"), createDefault: false });
  assert.equal(missingState.status, "missing");
  assert.equal(missingState.artifact, null);

  try {
    if (fs.existsSync(TEMP_ARTIFACT)) fs.unlinkSync(TEMP_ARTIFACT);
  } catch (_error) {
    // ignore cleanup errors in the test environment
  }
});

test("flood training excludes future-dated inputs and records the as-of boundary", () => {
  const dataset = {
    time_range: { start: "2026-01-01", end: "2026-02-10" },
    locations: [{ location_id: 0 }],
    series: Array.from({ length: 40 }, (_, index) => ({
      location_id: 0,
      time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      river_discharge_m3_s: 10 + index,
    })),
  };
  const artifact = trainFloodModel({ dataset, asOfDate: "2026-01-30" });

  assert.equal(artifact.modelVersion, "0.2.0");
  assert.equal(artifact.trainingWindow.asOfDate, "2026-01-30");
  assert.equal(artifact.trainingWindow.end, "2026-01-30");
  assert.match(artifact.trainingDataType, /not verified in-situ gauge observations/);
});

test("flood training rejects an invalid as-of date", () => {
  assert.throws(
    () => trainFloodModel({ asOfDate: "2026-02-30" }),
    { code: "invalid_input" }
  );
});

test("flood monitoring excludes future-dated records from its current input", () => {
  const dataset = {
    locations: [{ location_id: 0 }],
    series: Array.from({ length: 40 }, (_, index) => ({
      location_id: 0,
      time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      river_discharge_m3_s: 10 + index,
    })),
  };
  const status = buildMonitoringStatus({ dataset, asOfDate: "2026-01-30" });

  assert.equal(status.status, "MODEL");
  assert.equal(status.inputDataAsOf, "2026-01-30");
  assert.equal(status.severity, "UNKNOWN");
  assert.equal(status.model.eligibleAsWarning, false);
  assert.match(status.summary, /not verified live gauge observations/i);
});
