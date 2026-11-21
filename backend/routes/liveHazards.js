"use strict";

const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { getLiveHazards } = require("../services/liveHazards");

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

module.exports = router;
