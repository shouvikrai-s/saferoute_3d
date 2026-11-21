"use strict";

// A deliberately conservative integration boundary.  SafeRoute does not
// manufacture water/flood telemetry; deployments can attach a verifier here
// after contracting an official provider.  Until then, clients receive an
// explicit, source-labelled UNAVAILABLE state.
const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { buildMonitoringStatus } = require("../services/floodModel");

const router = express.Router();

function unavailable(kind, message) {
  return {
    status: "UNAVAILABLE",
    classification: null,
    freshness: null,
    sourceStatus: "UNAVAILABLE",
    sources: [],
    summary: message,
    kind,
  };
}

function providerStatus(name, status, detail, configured = false) {
  return {
    name,
    status,
    configured,
    detail,
    freshness: null,
  };
}

router.get("/monitoring/status", rateLimit, (_req, res) => {
  res.set("Cache-Control", "no-store");
  const floodStatus = buildMonitoringStatus();
  const trafficConfigured = Boolean(process.env.TOMTOM_API_KEY);
  const weatherConfigured = Boolean(process.env.OPEN_METEO_API_KEY || process.env.OPEN_METEO_BASE_URL);
  const providerHealth = {
    tomtomTraffic: providerStatus(
      "TomTom Traffic Flow",
      trafficConfigured ? "CONFIGURED" : "UNAVAILABLE",
      trafficConfigured
        ? "TomTom key is present; live traffic tiles must still verify with the upstream provider before being treated as current."
        : "No TomTom API key is configured. Traffic is unavailable until a valid provider credential is provided.",
      trafficConfigured
    ),
    openMeteo: providerStatus(
      "Open-Meteo current precipitation",
      weatherConfigured ? "CONFIGURED" : "UNAVAILABLE",
      weatherConfigured
        ? "Weather provider is configured. Current precipitation is contextual evidence only and is not an official alert feed."
        : "No backend weather API is configured. Browser-side current-precipitation checks may still use the public Open-Meteo endpoint when the client is connected.",
      weatherConfigured
    ),
    officialFlood: providerStatus(
      "Official flood/discharge feed",
      "UNAVAILABLE",
      "No verified official flood or river-discharge feed is configured for this deployment.",
      false
    ),
    officialDam: providerStatus(
      "Official dam/reservoir feed",
      "UNAVAILABLE",
      "No verified dam or reservoir feed is configured for this deployment.",
      false
    ),
    hazardReference: providerStatus(
      "Hazard reference data",
      "REFERENCE_ONLY",
      "Hazard zones are reference data and not live incident feeds. They do not establish current conditions.",
      true
    ),
  };

  const weatherStatus = {
    status: "UNAVAILABLE",
    classification: null,
    freshness: null,
    sourceStatus: "UNAVAILABLE",
    sources: [],
    summary: "No backend weather provider is configured. Current rainfall is contextual evidence only when retrieved client-side from an external source.",
    kind: "weather",
  };

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    providerHealth,
    traffic: {
      status: trafficConfigured ? "CONFIGURED" : "UNAVAILABLE",
      classification: null,
      freshness: null,
      sourceStatus: trafficConfigured ? "CONFIGURED" : "UNAVAILABLE",
      sources: trafficConfigured ? ["TomTom Traffic Flow"] : [],
      summary: trafficConfigured
        ? "TomTom traffic is configured but still requires a real fetch and validation before it is rendered as live traffic."
        : "No live TomTom traffic provider is configured; traffic tiles remain unavailable.",
      kind: "traffic",
    },
    weather: weatherStatus,
    flood: {
      ...floodStatus,
      kind: "flood",
      status: floodStatus.status || "UNAVAILABLE",
      classification: floodStatus.classification || "UNKNOWN",
      freshness: null,
      inputDataAsOf: floodStatus.inputDataAsOf || null,
      inputDataAgeDays: floodStatus.inputDataAgeDays ?? null,
      sourceStatus: floodStatus.sourceStatus || "UNAVAILABLE",
      area: floodStatus.area || "Sikkim",
      summary: floodStatus.summary || "Flood model output is unavailable; no flood status is inferred.",
      sources: floodStatus.sources || [],
      model: floodStatus.model || {},
    },
    dam: unavailable("dam", "DAM LIVE DATA UNAVAILABLE: no verified dam or reservoir feed is configured."),
  });
});

module.exports = router;
