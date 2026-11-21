require("dotenv").config();

const db = require("./services/db");

const express = require("express");
const os = require("os");

const routeRouter = require("./routes/route");
const nearbyRouter = require("./routes/nearby");
const trafficRouter = require("./routes/traffic");
const aiRouter = require("./routes/ai");
const monitoringRouter = require("./routes/monitoring");
const dataRouter = require("./routes/data");
const liveHazardsRouter = require("./routes/liveHazards");

const graphhopper = require("./services/graphhopper");
const redis = require("./services/redisClient");
const metrics = require("./services/metrics");

const app = express();
let shuttingDown = false;
const PORT = Number(process.env.PORT || 3000);

// ---------------------------------------------------------------------
// PROXY TRUST
// ---------------------------------------------------------------------
// Currently there is no trusted reverse proxy directly in front of
// this Node process, so Express keeps its default trust-proxy behavior.
//
// Do NOT use app.set("trust proxy", true) here.
//
// Later, when a real reverse proxy is deployed, trust only the known
// proxy/subnet.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// BASIC REQUEST LOGGING
// ---------------------------------------------------------------------
// Logs method, path, status and duration.
//
// req.path is deliberately used instead of req.originalUrl so query
// parameters such as coordinates are not written into logs.
// ---------------------------------------------------------------------

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;

    metrics.incr("http_requests_total");
    metrics.incrStatus(res.statusCode);

    console.log(
      `${new Date().toISOString()} ${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`
    );
  });

  next();
});

// ---------------------------------------------------------------------
// SECURITY HEADERS
// ---------------------------------------------------------------------
// HSTS is intentionally NOT enabled because this Node server currently
// serves plain HTTP on the LAN.
// ---------------------------------------------------------------------

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  next();
});

// ---------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------

app.use((req, res, next) => {
  const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function(origin){ return origin.trim(); })
    .filter(Boolean);
  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : ["http://127.0.0.1", "http://localhost"];
  const requestOrigin = req.get("Origin");
  if (!requestOrigin) {
    res.set("Vary", "Origin");
  } else if (
    allowedOrigins.includes(requestOrigin) ||
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(requestOrigin)
  ) {
    res.set("Access-Control-Allow-Origin", requestOrigin);
    res.set("Vary", "Origin");
  } else {
    return res.status(403).json({
      error: "cors_origin_denied",
      message: "Origin is not allowed.",
    });
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-SafeRoute-Client-Key"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------

app.use("/api", routeRouter);

// ---------------------------------------------------------------------
// SPATIAL "NEARBY" API FAMILY
// ---------------------------------------------------------------------
// routes/nearby.js provides:
//
//   GET /api/nearby/locations
//   GET /api/nearby/emergency
//   GET /api/nearby/tourism
//   GET /api/nearby/hazards
//   GET /api/nearby/roads
//
// These endpoints use the same client-key and rate-limit protection
// pattern as the route API.
// ---------------------------------------------------------------------

app.use("/api", nearbyRouter);
app.use("/api", trafficRouter);
app.use("/api", aiRouter);
app.use("/api", monitoringRouter);
app.use("/api", dataRouter);
app.use("/api", liveHazardsRouter);

// ---------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------
// General backend health snapshot.
//
// This endpoint verifies PostgreSQL with SELECT 1 so the database
// connection status is real rather than merely checking whether
// configuration variables exist.
//
// Secrets and connection credentials are never returned.
// ---------------------------------------------------------------------

app.get("/health", async (req, res) => {
  const routingStatus = graphhopper.getStatus();

  res.status(200).json({
    status: "ok",

    server: {
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },

    routing: {
      mode: routingStatus.mode,
      cloudConfigured: routingStatus.cloudConfigured,
      selfHostedConfigured: routingStatus.selfHostedConfigured,
      cacheBackend: routingStatus.cacheBackend,
      cacheSize: routingStatus.cacheSize,
      cacheMaxEntries: routingStatus.cacheMaxEntries,
      inFlightRequests: routingStatus.inFlightCount,
    },

    redis: {
      configured: Boolean(process.env.REDIS_URL),
      connected: redis.isAvailable(),
    },
  });
});

// ---------------------------------------------------------------------
// GET /health/db
// ---------------------------------------------------------------------
// PostgreSQL database health check.
//
// Returns HTTP 200 when PostgreSQL accepts a simple query.
// Returns HTTP 503 if PostgreSQL is unavailable.
//
// Never exposes database password or connection details.
// ---------------------------------------------------------------------

app.get("/health/db", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.status(200).json({
      status: "ok",
      database: "postgresql",
    });
  } catch (error) {
    console.error(
      "[db-health] PostgreSQL check failed:",
      error.message
    );

    res.status(503).json({
      status: "error",
      database: "postgresql",
    });
  }
});

// ---------------------------------------------------------------------
// GET /metrics
// ---------------------------------------------------------------------

app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain; version=0.0.4");
  res.status(200).send(metrics.renderPrometheus());
});

// ---------------------------------------------------------------------
// GET /live
// ---------------------------------------------------------------------
// Process-level liveness.
//
// Does not check external dependencies.
// ---------------------------------------------------------------------

app.get("/live", (req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

// ---------------------------------------------------------------------
// GET /ready
// ---------------------------------------------------------------------
// Readiness check.
//
// Routing must be configured.
// Redis is informational only because the routing system has a fallback.
// ---------------------------------------------------------------------

app.get("/ready", (req, res) => {
  if (shuttingDown) {
    return res.status(503).json({
      status: "not_ready",
      reason: "shutting_down",
    });
  }

  const routingStatus = graphhopper.getStatus();

  const isReady =
    routingStatus.cloudConfigured ||
    routingStatus.selfHostedConfigured;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "not_ready",

    routing: {
      mode: routingStatus.mode,
      cloudConfigured: routingStatus.cloudConfigured,
      selfHostedConfigured: routingStatus.selfHostedConfigured,
    },

    redis: {
      configured: Boolean(process.env.REDIS_URL),
      connected: redis.isAvailable(),
      note:
        "Informational only — Redis is optional and does not affect readiness.",
    },
  });
});

// ---------------------------------------------------------------------
// 404 HANDLER
// ---------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    message: "Unknown endpoint.",
  });
});

// ---------------------------------------------------------------------
// LAN-VISIBILITY HELPER
// ---------------------------------------------------------------------

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push({
          name,
          address: iface.address,
        });
      }
    }
  }

  return addresses;
}

// ---------------------------------------------------------------------
// HTTP SERVER
// ---------------------------------------------------------------------

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SafeRoute backend listening on 0.0.0.0:${PORT} (all interfaces)`
  );

  const lanAddresses = getLanAddresses();

  if (lanAddresses.length === 0) {
    console.log(
      "  WARNING: no non-internal IPv4 interface detected — if a physical " +
      "phone can't reach this backend, confirm this machine actually has " +
      "an active Wi-Fi/LAN connection."
    );
  } else {
    console.log(
      "  Reachable from other devices on the same network at:"
    );

    lanAddresses.forEach(({ name, address }) => {
      console.log(
        `    http://${address}:${PORT}  (interface: ${name})`
      );
    });

    console.log(
      "  On your phone's browser, open the /health URL above FIRST, before " +
      "testing the app — if that doesn't load, the problem is network/" +
      "firewall, not this backend's code."
    );
  }

  console.log("  GET /health");
  console.log("  GET /health/db");
  console.log("  GET /live");
  console.log("  GET /ready");
  console.log("  GET /metrics");
  console.log(
    "  GET /api/route?startLat=..&startLon=..&endLat=..&endLon=.."
  );
  console.log("  GET /api/nearby/locations");
  console.log("  GET /api/nearby/emergency");
  console.log("  GET /api/nearby/tourism");
  console.log("  GET /api/nearby/hazards");
  console.log("  GET /api/nearby/roads");
  console.log("  GET /api/monitoring/status");
  console.log("  GET /api/data/catalog");
  console.log("  GET /api/data/history?dataset=weather|discharge");
  console.log("  GET /api/data/assessment?lat=..&lon=..");
  console.log("  GET /api/data/events?type=earthquake|forest_fire");
});

// ---------------------------------------------------------------------
// GRACEFUL SHUTDOWN
// ---------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = Number(
  process.env.SHUTDOWN_TIMEOUT_MS || 10000
);

function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[shutdown] received ${signal} — closing server, finishing in-flight requests...`
  );

  const forceExitTimer = setTimeout(() => {
    console.error(
      `[shutdown] still not closed after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit ` +
        "(some in-flight requests may not have completed)"
    );

    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExitTimer.unref();

  server.close(() => {
    console.log(
      "[shutdown] HTTP server closed — no more in-flight requests"
    );

    clearTimeout(forceExitTimer);

    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
