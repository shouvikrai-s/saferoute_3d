"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { classify } = require("../services/safeRouteModels");
const { inferTraffic, loadPersistedModel, validateArtifact, resolveArtifactPath } = require("../services/trafficModel");

function fetchMonitoringStatus() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use("/api", require("../routes/monitoring"));
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/api/monitoring/status",
        method: "GET",
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          server.close(() => {
            try {
              resolve({ statusCode: res.statusCode, json: JSON.parse(body) });
            } catch (error) {
              reject(error);
            }
          });
        });
      });
      req.on("error", (error) => {
        server.close(() => reject(error));
      });
      req.end();
    });
  });
}

test("feature rules identify their inferred, unverified input status", () => {
  const result = classify({
    task: "weather",
    features: { precipitation: 2 },
    dataQuality: "LIVE",
    sourceCount: 99,
    dataState: "LIVE",
    inputTimestamp: "2099-01-01T00:00:00.000Z",
  });

  assert.equal(result.status, "INFERRED");
  assert.equal(result.model, "SafeRouteDeterministicRules");
  assert.equal(result.modelType, "deterministic-feature-weighted-rules");
  assert.equal(result.features.precipitation, 2);
  assert.equal("confidence" in result, false);
  assert.equal("dataState" in result, false);
  assert.equal("inputTimestamp" in result, false);
  assert.match(result.explanation, /provenance was not independently verified/);
});

test("feature rules reject out-of-range risks and invalid counts", () => {
  assert.throws(
    () => classify({ task: "safety", features: {
      trafficRisk: 1.2,
      weatherRisk: 0,
      hazardRisk: 0,
      resourceCount: 0,
    } }),
    { code: "invalid_input" }
  );
  assert.throws(
    () => classify({ task: "tourism", features: { placeCount: -1, weatherRisk: 0 } }),
    { code: "invalid_input" }
  );
});

test("traffic clustering returns an inference without fabricated confidence or verified provenance", () => {
  const result = inferTraffic({
    task: "traffic",
    source: "TomTom Traffic Flow",
    observedAt: new Date().toISOString(),
    observations: [
      { relativeSpeed: 0.2 },
      { relativeSpeed: 0.5 },
      { relativeSpeed: 0.9 },
    ],
    inputTimestamp: "2099-01-01T00:00:00.000Z",
  });

  assert.equal(result.status, "INFERRED");
  assert.equal(result.provenanceVerified, false);
  assert.equal(result.modelType, "per-request-unsupervised-kmeans");
  assert.equal(result.sampleCount, 3);
  assert.equal("confidence" in result, false);
  assert.equal("inputTimestamp" in result, false);
  assert.match(result.explanation, /not inference from a previously trained or persisted model/);
});

test("traffic clustering rejects unsupported source claims", () => {
  assert.throws(
    () => inferTraffic({
      task: "traffic",
      source: "unknown",
      observations: [
        { relativeSpeed: 0.2 },
        { relativeSpeed: 0.5 },
        { relativeSpeed: 0.9 },
      ],
    }),
    { code: "invalid_input" }
  );
});

test("traffic clustering rejects stale, future, and out-of-range relative speeds", () => {
  const observations = [
    { relativeSpeed: 0.2 },
    { relativeSpeed: 0.5 },
    { relativeSpeed: 0.9 },
  ];
  assert.throws(
    () => inferTraffic({ task: "traffic", source: "TomTom Traffic Flow", observedAt: "2000-01-01T00:00:00.000Z", observations }),
    { code: "insufficient_data" }
  );
  assert.throws(
    () => inferTraffic({ task: "traffic", source: "TomTom Traffic Flow", observedAt: new Date(Date.now() + 60000).toISOString(), observations }),
    { code: "insufficient_data" }
  );
  assert.throws(
    () => inferTraffic({ task: "traffic", source: "TomTom Traffic Flow", observedAt: new Date().toISOString(), observations: [
      { relativeSpeed: 0.2 }, { relativeSpeed: 1.2 }, { relativeSpeed: 0.9 },
    ] }),
    { code: "insufficient_data" }
  );
});

test("persisted traffic artifact is validated and used when present", () => {
  const artifactState = loadPersistedModel();
  assert.ok(artifactState && typeof artifactState === "object");
  assert.equal(artifactState.artifact.modelName, "SafeRouteTrafficKMeans");
  assert.equal(artifactState.artifact.modelVersion, "0.1.0");
  assert.ok(resolveArtifactPath().endsWith("saferoute-traffic-kmeans-0.1.0.json"));
  assert.equal(validateArtifact(artifactState.artifact), true);
  assert.ok(["missing", "not_trained"].includes(artifactState.status));
});

test("monitoring status reports model-based flood data and explicit unavailable external providers", async () => {
  const result = await fetchMonitoringStatus();
  assert.equal(result.statusCode, 200);
  assert.equal(result.json.flood.status, "MODEL");
  assert.equal(result.json.flood.classification, "UNKNOWN");
  assert.equal(result.json.flood.freshness, null);
  assert.ok(result.json.flood.inputDataAsOf);
  assert.equal(result.json.dam.status, "UNAVAILABLE");
  assert.equal(result.json.traffic.status, "UNAVAILABLE");
  assert.equal(result.json.providerHealth.tomtomTraffic.status, "UNAVAILABLE");
  assert.equal(result.json.providerHealth.officialDam.status, "UNAVAILABLE");
  assert.match(result.json.flood.summary, /not eligible to generate a warning|not verified live gauge observations/i);
  assert.match(result.json.dam.summary, /no verified dam|unavailable/i);
});
