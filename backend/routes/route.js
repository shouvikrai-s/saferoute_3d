const express = require("express");
const { validateRouteQuery } = require("../middleware/requestValidation");
const { rateLimit } = require("../middleware/rateLimit");
const graphhopper = require("../services/graphhopper");
const metrics = require("../services/metrics");

const router = express.Router();

// ---------------------------------------------------------------------
// Privacy-safe upstream diagnostic logging.
//
// IMPORTANT:
// - Never log the GraphHopper URL.
// - Never log the API key.
// - Never log query parameters.
// - Never log credentials.
// - Limit the upstream response body before writing it to the log.
// ---------------------------------------------------------------------
const UPSTREAM_DIAGNOSTIC_BODY_MAX = 1000;

function sanitizeUpstreamBody(body) {
  if (!body) {
    return "[empty response body]";
  }

  let text = String(body).replace(/\s+/g, " ").trim();

  // Remove common credential/secret-looking JSON fields if present.
  text = text.replace(
    /("(?:key|api[_-]?key|token|access[_-]?token|secret|password|authorization)"\s*:\s*)"[^"]*"/gi,
    '$1"[REDACTED]"'
  );

  // Remove common URL query-string credentials if a provider error happens
  // to echo a URL back in its response body.
  text = text.replace(
    /([?&](?:key|api[_-]?key|token|access[_-]?token|secret|password)=)[^&\s"]+/gi,
    "$1[REDACTED]"
  );

  if (text.length > UPSTREAM_DIAGNOSTIC_BODY_MAX) {
    text = `${text.slice(0, UPSTREAM_DIAGNOSTIC_BODY_MAX)}...[TRUNCATED]`;
  }

  return text;
}

function logUpstreamDiagnostic(err) {
  const status = err && err.upstreamStatus;
  const body = sanitizeUpstreamBody(err && err.upstreamBody);

  let classification = "upstream_error";

  if (status === 429) {
    classification = "rate_limited";
  } else if (status >= 500 && status <= 599) {
    classification = "upstream_5xx";
  } else if (status === 408 || status === 504) {
    classification = "timeout_or_gateway_timeout";
  } else if (status >= 400 && status <= 499) {
    classification = "upstream_4xx";
  }

  console.error(
    `[/api/route] upstream diagnostic: classification=${classification} status=${status ?? "unknown"} body=${body}`
  );
}

// GET /api/route?startLat=..&startLon=..&endLat=..&endLon=..
router.get(
  "/route",
  rateLimit,
  validateRouteQuery,
  async (req, res) => {
    const { startLat, startLon, endLat, endLon } = req.routeParams;

    metrics.incr("route_requests_total");

    try {
      const { data, cacheHit, deduped } = await graphhopper.getRoute(
        startLat,
        startLon,
        endLat,
        endLon
      );

      if (cacheHit) {
        metrics.incr("route_cache_hits_total");
      } else {
        metrics.incr("route_cache_misses_total");
      }

      if (deduped) {
        metrics.incr("route_dedup_hits_total");
      }

      res.set("X-SafeRoute-Cache", cacheHit ? "HIT" : "MISS");

      if (deduped) {
        res.set("X-SafeRoute-Deduped", "true");
      }

      if (data && data.fallback) {
        const status =
          data.reason === "no_provider"
            ? 503
            : data.upstreamStatus === 504
              ? 504
              : 502;
        return res.status(status).json({
          error: data.reason || "routing_unavailable",
          message: data.message || "The routing service could not calculate a route.",
        });
      }

      if (!data || !Array.isArray(data.paths)) {
        return res.status(502).json({
          error: "invalid_upstream_response",
          message: "The routing service returned an invalid response.",
        });
      }

      if (data.paths.length === 0) {
        return res.status(404).json({
          error: "route_not_found",
          message: "No drivable route was found to this place.",
        });
      }

      if (!graphhopper.hasValidRouteGeometry(data)) {
        return res.status(502).json({
          error: "invalid_upstream_response",
          message:
            "The routing service returned no usable route geometry. Please try again later.",
        });
      }

      return res.status(200).json(data);
    } catch (err) {
      metrics.incr("route_errors_total");

      console.error("[/api/route] error:", err.message);

      if (err.circuitOpen || err.capacityExhausted) {
        return res.status(503).json({
          error: err.circuitOpen ? "circuit_open" : "capacity_exhausted",
          message:
            "The routing service is temporarily at capacity. Please try again shortly.",
        });
      }

      if (err.upstreamStatus) {
        logUpstreamDiagnostic(err);

        if (err.upstreamStatus === 400) {
          return res.status(404).json({
            error: "route_not_found",
            message: "No drivable route was found to this place.",
          });
        }

        return res.status(502).json({
          error: "upstream_routing_error",
          message: "The routing service could not process this request.",
        });
      }

      return res.status(500).json({
        error: "internal_error",
        message: "Could not calculate a route. Please try again.",
      });
    }
  }
);

module.exports = router;