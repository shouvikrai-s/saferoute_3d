// Spatial "nearby" API family: locations, emergency facilities,
// tourism places, hazards, and roads. All five follow one consistent
// pattern (shared validation, shared response shape, shared
// protections) so the API is predictable to build against.
//
// Table schemas as provided in the SafeRoute 3D master architecture
// prompt (saferoute_locations, saferoute_roads, saferoute_hazards,
// saferoute_emergency_facilities, saferoute_tourism) — NOT independently
// verified against the live database from this environment (no DB
// access here). Verify with the psql commands given in the delivery
// notes before trusting this against production data.
//
// These public app data endpoints use input validation and per-IP rate
// limiting. A credential embedded in the shipped browser/mobile app is
// public, not authentication; confidential callers should use a separate
// server-to-server integration.

const express = require("express");
const db = require("../services/db");
const metrics = require("../services/metrics");
const regionalFallback = require("../services/regionalFallback");
const { rateLimit } = require("../middleware/rateLimit");

const router = express.Router();

const MAX_RADIUS_METERS = 50000; // 50km — matches the existing /api/nearby/locations cap
const DEFAULT_RADIUS_METERS = 5000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

// Shared lat/lon/radius/limit/offset validation — identical rules to
// the existing /api/nearby/locations handler, extended with capped
// pagination (limit/offset) per the "pagination where appropriate"
// requirement, and reused across all five endpoints below so the
// rules can never drift apart from each other.
function validateNearbyQuery(req, res, next) {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const radius = Number(req.query.radius || DEFAULT_RADIUS_METERS);
  const limit = Number(req.query.limit || DEFAULT_LIMIT);
  const offset = Number(req.query.offset || 0);

  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lon) || lon < -180 || lon > 180
  ) {
    return res.status(400).json({
      error: "invalid_request",
      message: "lat and lon are required and must be valid coordinates.",
    });
  }

  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_RADIUS_METERS) {
    return res.status(400).json({
      error: "invalid_request",
      message: `radius must be between 1 and ${MAX_RADIUS_METERS} meters.`,
    });
  }

  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_LIMIT) {
    return res.status(400).json({
      error: "invalid_request",
      message: `limit must be between 1 and ${MAX_LIMIT}.`,
    });
  }

  if (!Number.isFinite(offset) || offset < 0) {
    return res.status(400).json({
      error: "invalid_request",
      message: "offset must be 0 or greater.",
    });
  }

  req.nearbyParams = { lat, lon, radius, limit, offset };
  next();
}

// Wraps a spatial query with consistent metrics + error handling so
// each endpoint below only needs to supply its SQL and response key.
// Never leaks SQL/DB error detail to the client (message is generic;
// the real error is logged server-side only) and never logs
// coordinates (matches the privacy-safe logging already used
// elsewhere in this backend).
function runNearbyQuery({ sql, responseKey, endpointName }) {
  return async (req, res) => {
    metrics.incr("nearby_requests_total");
    const { lat, lon, radius, limit, offset } = req.nearbyParams;

    try {
      const result = await db.query(sql, [lat, lon, radius, limit, offset]);
      res.status(200).json({
        status: "ok",
        count: result.rows.length,
        radiusMeters: radius,
        limit,
        offset,
        [responseKey]: result.rows,
      });
    } catch (error) {
      metrics.incr("nearby_errors_total");
      console.error(`[${endpointName}] PostgreSQL query failed:`, error.message);
      return res.status(200).json(regionalFallback.nearby(endpointName, req.nearbyParams));
    }
  };
}

// GET /api/nearby/locations
router.get(
  "/nearby/locations",
  rateLimit,
  validateNearbyQuery,
  runNearbyQuery({
    endpointName: "nearby-locations",
    responseKey: "locations",
    sql: `
      SELECT
        id, name, category, description, latitude, longitude,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_meters
      FROM saferoute_locations
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY distance_meters ASC
      LIMIT $4 OFFSET $5;
    `,
  })
);

// GET /api/nearby/emergency
// Only is_active facilities by default -- an inactive/decommissioned
// facility is not useful in an emergency-navigation context.
router.get(
  "/nearby/emergency",
  rateLimit,
  validateNearbyQuery,
  runNearbyQuery({
    endpointName: "nearby-emergency",
    responseKey: "emergencyFacilities",
    sql: `
      SELECT
        id, name, facility_type, phone, address, latitude, longitude, is_active,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_meters
      FROM saferoute_emergency_facilities
      WHERE location IS NOT NULL
        AND is_active = TRUE
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY distance_meters ASC
      LIMIT $4 OFFSET $5;
    `,
  })
);

// GET /api/nearby/tourism
// is_open is returned but NOT filtered by default -- a tourist may
// still want to see a currently-closed place (to plan a later visit).
router.get(
  "/nearby/tourism",
  rateLimit,
  validateNearbyQuery,
  runNearbyQuery({
    endpointName: "nearby-tourism",
    responseKey: "tourism",
    sql: `
      SELECT
        id, name, category, description, address, latitude, longitude, is_open,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_meters
      FROM saferoute_tourism
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY distance_meters ASC
      LIMIT $4 OFFSET $5;
    `,
  })
);

// GET /api/nearby/hazards
// Only status='active' by default -- a resolved/expired hazard
// shouldn't surface in a safety-awareness query. geometry column is
// GEOGRAPHY(GEOMETRY,4326) (mixed type per the provided schema), so
// ST_DWithin/ST_Distance are used against `geometry` directly rather
// than a separate lat/lon pair (this table has none).
router.get(
  "/nearby/hazards",
  rateLimit,
  validateNearbyQuery,
  runNearbyQuery({
    endpointName: "nearby-hazards",
    responseKey: "hazards",
    sql: `
      SELECT
        id, hazard_type, severity, title, description, status, reported_at,
        ST_Distance(geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_meters
      FROM saferoute_hazards
      WHERE geometry IS NOT NULL
        AND status = 'active'
        AND ST_DWithin(geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY distance_meters ASC
      LIMIT $4 OFFSET $5;
    `,
  })
);

// GET /api/nearby/roads
// geometry is GEOGRAPHY(LINESTRING,4326) -- ST_DWithin/ST_Distance work
// the same way against a linestring as a point (distance to the
// nearest point on the line), no special-casing needed.
router.get(
  "/nearby/roads",
  rateLimit,
  validateNearbyQuery,
  runNearbyQuery({
    endpointName: "nearby-roads",
    responseKey: "roads",
    sql: `
      SELECT
        id, road_name, road_type, status, speed_limit,
        ST_Distance(geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_meters
      FROM saferoute_roads
      WHERE geometry IS NOT NULL
        AND ST_DWithin(geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY distance_meters ASC
      LIMIT $4 OFFSET $5;
    `,
  })
);

module.exports = router;