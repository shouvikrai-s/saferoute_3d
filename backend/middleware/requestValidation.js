// Validates the four required route parameters before anything else runs.
// Keeps calculateRoute() on the client dumb and safe: malformed requests
// never reach the GraphHopper call or the cache.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// SECURITY FIX (Phase 11, Step 5 — confirmed bug): Number("") === 0,
// and "" !== undefined, so `?startLat=` (present but empty) previously
// sailed past the `=== undefined` check and silently became a "valid"
// latitude of 0 — a real coordinate near the equator, nowhere close to
// Sikkim, but not rejected. Whitespace-only values had the same hole
// (Number("   ") is also 0). Now explicitly rejected before parsing.
function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function validateRouteQuery(req, res, next) {
  const { startLat, startLon, endLat, endLon } = req.query;

  const missing = [];
  if (startLat === undefined || isBlank(startLat)) missing.push("startLat");
  if (startLon === undefined || isBlank(startLon)) missing.push("startLon");
  if (endLat === undefined || isBlank(endLat)) missing.push("endLat");
  if (endLon === undefined || isBlank(endLon)) missing.push("endLon");

  if (missing.length > 0) {
    return res.status(400).json({
      error: "missing_parameters",
      message: `Missing or empty required parameter(s): ${missing.join(", ")}`,
    });
  }

  const parsed = {
    startLat: Number(startLat),
    startLon: Number(startLon),
    endLat: Number(endLat),
    endLon: Number(endLon),
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (!isFiniteNumber(value)) {
      return res.status(400).json({
        error: "invalid_parameter",
        message: `Parameter "${key}" must be a valid number.`,
      });
    }
  }

  if (parsed.startLat < -90 || parsed.startLat > 90 || parsed.endLat < -90 || parsed.endLat > 90) {
    return res.status(400).json({
      error: "invalid_range",
      message: "Latitude values must be between -90 and 90.",
    });
  }

  if (parsed.startLon < -180 || parsed.startLon > 180 || parsed.endLon < -180 || parsed.endLon > 180) {
    return res.status(400).json({
      error: "invalid_range",
      message: "Longitude values must be between -180 and 180.",
    });
  }

  // Reject a start/end pair that is identical to 5 decimal places
  // (~1m) — not an error, just nothing useful for GraphHopper to do.
  if (
    parsed.startLat.toFixed(5) === parsed.endLat.toFixed(5) &&
    parsed.startLon.toFixed(5) === parsed.endLon.toFixed(5)
  ) {
    return res.status(400).json({
      error: "identical_points",
      message: "Start and end coordinates are effectively identical.",
    });
  }

  req.routeParams = parsed;
  next();
}

module.exports = { validateRouteQuery };