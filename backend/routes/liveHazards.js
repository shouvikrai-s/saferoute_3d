"use strict";

const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { getLiveHazards, getPointTelemetry } = require("../services/liveHazards");
const regionalFallback = require("../services/regionalFallback");

const router = express.Router();

router.get("/hazards/live", rateLimit, async (_req, res) => {
  res.set("Cache-Control", "public, max-age=900, stale-while-revalidate=900");
  const result = await getLiveHazards();
  if (!result.snapshot) {
    const snapshot = regionalFallback.nearby("nearby-hazards", {
      lat: 27.3389, lon: 88.6065, radius: 50000, limit: 1, offset: 0
    });
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      source: snapshot.source,
      mode: "REGIONAL_REFERENCE_FALLBACK",
      corridors: [],
      tourism: [],
      regionalScreening: snapshot.regionalContext,
      cache: { hit: false, stale: false }
    });
  }
  if (result.stale) res.set("X-SafeRoute-Stale", "true");
  return res.status(200).json({
    ...result.snapshot,
    cache: {
      hit: result.cached,
      stale: result.stale
    }
  });
});

router.get("/hazards/point", rateLimit, async (req, res) => {
  const lat = req.query.lat === undefined || req.query.lat === "" ? NaN : Number(req.query.lat);
  const lon = req.query.lon === undefined || req.query.lon === "" ? NaN : Number(req.query.lon);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lon) || lon < -180 || lon > 180
  ) {
    return res.status(400).json({
      error: "invalid_request",
      message: "lat and lon are required valid geographic coordinates."
    });
  }
  try {
    const result = await getPointTelemetry(lat, lon);
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=300");
    if (result.stale) res.set("X-SafeRoute-Stale", "true");
    return res.status(200).json({
      ...result.snapshot,
      cache: {
        hit: result.cached,
        stale: result.stale
      }
    });
  } catch (error) {
    console.error("[hazards-point] telemetry request failed:", error.message);
    const context = regionalFallback.assessment(lat, lon);
    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      status: "regional_reference_fallback",
      generatedAt: new Date().toISOString(),
      coordinates: { lat, lon },
      weather: null,
      air_quality: null,
      flood: null,
      landslide_risk: "UNASSESSED",
      sourceStatus: { weather: "UNAVAILABLE", air_quality: "UNAVAILABLE", flood: "UNAVAILABLE" },
      regionalScreening: context.regionalScreening,
      cache: { hit: false, stale: false }
    });
  }
});

module.exports = router;
