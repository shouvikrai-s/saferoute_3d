"use strict";

const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const historicalData = require("../services/historicalData");

const router = express.Router();

function sendError(res, error, scope) {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 503;
  if (status >= 500) {
    console.error(`[${scope}] data request failed:`, error.message);
  }
  return res.status(status).json({
    error: status === 400 ? "invalid_request" : "historical_data_unavailable",
    message: status === 400 ? error.message : "Historical dataset service is temporarily unavailable.",
  });
}

router.get("/data/catalog", rateLimit, async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.status(200).json(await historicalData.getCatalog());
  } catch (error) {
    return sendError(res, error, "data-catalog");
  }
});

router.get("/data/river-observations", rateLimit, async (_req, res) => {
  try {
    const response = await historicalData.getRiverObservations();
    res.set("Cache-Control", "no-store");
    return res.status(200).json(response);
  } catch (error) {
    return sendError(res, error, "cwc-river-observations");
  }
});

router.get("/data/history", rateLimit, async (req, res) => {
  const includeForecast = req.query.includeForecast === undefined
    ? false
    : req.query.includeForecast === "true"
      ? true
      : req.query.includeForecast === "false"
        ? false
        : null;
  try {
    const response = await historicalData.getHistory({
      dataset: req.query.dataset,
      start: req.query.start,
      end: req.query.end,
      locationId: req.query.locationId,
      includeForecast,
      limit: Number(req.query.limit === undefined ? 100 : req.query.limit),
      offset: Number(req.query.offset === undefined ? 0 : req.query.offset),
    });
    res.set("Cache-Control", "no-store");
    return res.status(200).json(response);
  } catch (error) {
    return sendError(res, error, "data-history");
  }
});

router.get("/data/assessment", rateLimit, async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lon) || lon < -180 || lon > 180
  ) {
    return res.status(400).json({
      error: "invalid_request",
      message: "lat and lon are required valid geographic coordinates.",
    });
  }
  try {
    const response = await historicalData.getAssessment(lat, lon);
    res.set("Cache-Control", "no-store");
    return res.status(200).json(response);
  } catch (error) {
    return sendError(res, error, "data-assessment");
  }
});

router.get("/data/events", rateLimit, async (req, res) => {
  try {
    const response = await historicalData.getEvents({
      type: req.query.type,
      start: req.query.start,
      end: req.query.end,
      minLat: req.query.minLat,
      maxLat: req.query.maxLat,
      minLon: req.query.minLon,
      maxLon: req.query.maxLon,
      limit: Number(req.query.limit === undefined ? 100 : req.query.limit),
      offset: Number(req.query.offset === undefined ? 0 : req.query.offset),
    });
    res.set("Cache-Control", "no-store");
    return res.status(200).json(response);
  } catch (error) {
    return sendError(res, error, "historical-events");
  }
});

module.exports = router;
