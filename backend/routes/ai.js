"use strict";

const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { inferTraffic } = require("../services/trafficModel");
const { inferFloodForecast } = require("../services/floodModel");
const { classify } = require("../services/safeRouteModels");

const router = express.Router();

router.post("/ai/analyze", rateLimit, (req, res) => {
  if (!req.body || typeof req.body.task !== "string") {
    return res.status(400).json({
      error: "invalid_request",
      message: "An AI analysis task is required.",
    });
  }

  try {
    const result = req.body.task === "traffic"
      ? inferTraffic(req.body)
      : req.body.task === "flood"
        ? inferFloodForecast(req.body)
        : classify(req.body);
    return res.status(200).json({
      status: "ok",
      result,
    });
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) {
      console.error(`[ai] traffic inference failed code=${error.code || "UNKNOWN"}`);
    }
    return res.status(status).json({
      error: error.code || "ai_inference_error",
      message: status >= 500
        ? "AI inference is temporarily unavailable."
        : error.message,
    });
  }
});

module.exports = router;
