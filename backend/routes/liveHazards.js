"use strict";

const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { getLiveHazards, getPointTelemetry } = require("../services/liveHazards");

const router = express.Router();

router.get("/hazards/live", rateLimit, async (_req, res) => {
  res.set("Cache-Control", "public, max-age=900, stale-while-revalidate=900");
  const result = await getLiveHazards();
  if (!result.snapshot) {
    return res.status(503).json({
      error: "hazards_unavailable",
      message: "Live hazard snapshot is temporarily unavailable.",
      stale: false
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
    return res.status(503).json({
      error: "point_telemetry_unavailable",
      message: "Point telemetry feeds did not return usable data."
    });
  }
});

module.exports = router;
