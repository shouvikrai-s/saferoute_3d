// Talks to GraphHopper on the backend's behalf and returns the RAW
// GraphHopper-compatible response shape (data.paths[] with
// points.coordinates / instructions / distance / time), unchanged,
// so the existing HelloWorld.html calculateRoute() parsing needs zero
// modification when ROUTING_CONFIG.mode is switched to "backend".
//
// Handles, in order: bounded in-memory cache -> in-flight de-dup ->
// actual upstream fetch, selected by ROUTING_MODE. This checkout uses
// self-hosted GraphHopper when the Phase G service is running.

const redis = require("./redisClient");
const upstreamQueue = require("./upstreamQueue");

const ROUTING_MODE = (process.env.ROUTING_MODE || "cloud").trim().toLowerCase(); // "cloud" | "self_hosted"
const GRAPHHOPPER_CLOUD_URL =
  process.env.GRAPHHOPPER_CLOUD_URL || "https://graphhopper.com/api/1/route";
const GRAPHHOPPER_API_KEY = process.env.GRAPHHOPPER_API_KEY || "";
const GRAPHHOPPER_SELF_HOSTED_URL = process.env.GRAPHHOPPER_SELF_HOSTED_URL || "";

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 300000); // 5 min default
const CACHE_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);

// ---------------------------------------------------------------------
// Route cache. Redis-backed (shared across all instances) when
// REDIS_URL is configured and reachable; otherwise falls back to the
// original bounded in-memory Map — automatically, per-call, so a
// mid-session Redis outage degrades to single-instance caching instead
// of erroring. This is the single biggest lever for the 7-lakh-user
// target: without a shared cache, every instance independently
// re-requests the same popular routes (e.g. common Gangtok routes)
// from the GraphHopper upstream, multiplying upstream load by instance
// count. With Redis, the whole fleet shares one cache.
// ---------------------------------------------------------------------
const localCache = new Map(); // key -> { data, expiresAt } — fallback only

function cacheKey(startLat, startLon, endLat, endLon) {
  return [
    startLat.toFixed(4),
    startLon.toFixed(4),
    endLat.toFixed(4),
    endLon.toFixed(4),
  ].join(",");
}

async function getFromCache(key) {
  if (redis.isAvailable()) {
    try {
      const raw = await redis.getClient().get(`saferoute:route:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error("[graphhopper] Redis GET failed, falling back to in-memory cache:", err.message);
      // fall through to local cache below
    }
  }
  const entry = localCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(key);
    return null;
  }
  return entry.data;
}

async function setInCache(key, data) {
  if (redis.isAvailable()) {
    try {
      await redis.getClient().set(`saferoute:route:${key}`, JSON.stringify(data), "PX", CACHE_TTL_MS);
      return;
    } catch (err) {
      console.error("[graphhopper] Redis SET failed, falling back to in-memory cache:", err.message);
      // fall through to local cache below
    }
  }
  if (localCache.size >= CACHE_MAX_ENTRIES && !localCache.has(key)) {
    const oldestKey = localCache.keys().next().value;
    localCache.delete(oldestKey);
  }
  localCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------
// In-flight de-dup: identical concurrent requests share one upstream
// call instead of firing N times at GraphHopper.
//
// SCOPE NOTE (honest limitation, not fixed in this pass): this dedup is
// still per-instance/in-memory only. True cross-instance dedup would
// need a distributed lock (e.g. Redis SET NX PX + poll/pubsub for the
// result), which adds real latency and failure-mode complexity for a
// benefit that only matters in the narrow window where two different
// instances happen to receive the exact same never-before-cached route
// request within milliseconds of each other. Left as in-memory pending
// evidence (from /metrics route_dedup_hits_total across instances)
// that it's actually worth the added complexity.
// ---------------------------------------------------------------------
const inFlight = new Map(); // key -> Promise<data>

function buildFallbackRouteResponse(details = {}) {
  const reason = details.reason || "no_provider";
  const message =
    reason === "no_provider"
      ? "No live routing provider is configured for this deployment. Real route geometry is unavailable until GraphHopper or another supported backend is connected."
      : "The configured routing provider is reachable but rejected or failed this request, so no real route geometry is available.";

  return {
    paths: [],
    fallback: true,
    reason,
    provider: ROUTING_MODE,
    message,
    ...(details.upstreamStatus ? { upstreamStatus: details.upstreamStatus } : {}),
  };
}

function hasValidRouteGeometry(data) {
  return Boolean(
    data &&
      Array.isArray(data.paths) &&
      data.paths.some((path) => {
        const coordinates = path && path.points && path.points.coordinates;
        return (
          Array.isArray(coordinates) &&
          coordinates.length >= 2 &&
          coordinates.every(
            (coordinate) =>
              Array.isArray(coordinate) &&
              coordinate.length >= 2 &&
              Number.isFinite(coordinate[0]) &&
              Number.isFinite(coordinate[1]) &&
              coordinate[0] >= -180 &&
              coordinate[0] <= 180 &&
              coordinate[1] >= -90 &&
              coordinate[1] <= 90
          )
        );
      })
  );
}

function validateRouteResponse(data) {
  if (!data || !Array.isArray(data.paths)) {
    return buildFallbackRouteResponse({
      reason: "invalid_upstream_response",
      upstreamStatus: 502,
    });
  }

  if (data.paths.length === 0) {
    return data;
  }

  const validPaths = data.paths.filter((path) => {
    return hasValidRouteGeometry({ paths: [path] });
  });

  if (validPaths.length === 0) {
    return buildFallbackRouteResponse({
      reason: "invalid_upstream_response",
      upstreamStatus: 502,
    });
  }

  return validPaths.length === data.paths.length
    ? data
    : { ...data, paths: validPaths };
}

function buildUpstreamUrl(startLat, startLon, endLat, endLon) {
  if (ROUTING_MODE === "self_hosted") {
    if (!GRAPHHOPPER_SELF_HOSTED_URL) {
      return null;
    }
    // Self-hosted GraphHopper exposes the same /route contract as the
    // cloud API when queried this way, so the query string is identical.
    return (
      GRAPHHOPPER_SELF_HOSTED_URL +
      `?point=${startLat},${startLon}&point=${endLat},${endLon}` +
      `&profile=car&locale=en&points_encoded=false&instructions=true` +
      `&algorithm=alternative_route&alternative_route.max_paths=3`
    );
  }

  // cloud mode
  if (!GRAPHHOPPER_API_KEY) {
    return null;
  }
  return (
    GRAPHHOPPER_CLOUD_URL +
    `?point=${startLat},${startLon}&point=${endLat},${endLon}` +
    `&vehicle=car&locale=en&points_encoded=false&instructions=true` +
    `&algorithm=alternative_route&alternative_route.max_paths=3` +
    `&key=${GRAPHHOPPER_API_KEY}`
  );
}

// Bound both providers to one route deadline so a slow primary does not
// make fallback routing exceed the mobile client timeout.
const ROUTE_TOTAL_TIMEOUT_MS = 3800;
const GRAPHHOPPER_TIMEOUT_MS = 1800;
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";

function convertOsrmRoute(data) {
  if (!data || data.code === "NoRoute") return { paths: [] };
  const route = Array.isArray(data.routes) && data.routes[0];
  const coordinates = route && route.geometry && route.geometry.coordinates;
  if (data.code !== "Ok" || !route || !Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }
  if (!Number.isFinite(Number(route.distance)) || Number(route.distance) < 0 ||
      !Number.isFinite(Number(route.duration)) || Number(route.duration) < 0) return null;
  if (!coordinates.every((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90
  )) return null;

  const instructions = [];
  let cursor = 0;
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const stepCoordinates = step.geometry && step.geometry.coordinates;
      const first = Array.isArray(stepCoordinates) && stepCoordinates[0];
      const last = Array.isArray(stepCoordinates) && stepCoordinates[stepCoordinates.length - 1];
      let startIndex = cursor;
      let endIndex = cursor;
      if (first) {
        const found = coordinates.findIndex((point, index) =>
          index >= cursor && Math.abs(point[0] - first[0]) < 0.00001 &&
          Math.abs(point[1] - first[1]) < 0.00001
        );
        if (found >= 0) startIndex = found;
      }
      if (last) {
        const found = coordinates.findIndex((point, index) =>
          index >= startIndex && Math.abs(point[0] - last[0]) < 0.00001 &&
          Math.abs(point[1] - last[1]) < 0.00001
        );
        if (found >= 0) endIndex = found;
      }
      cursor = Math.max(startIndex, endIndex);
      const maneuver = step.maneuver || {};
      const modifier = maneuver.modifier ? ` ${maneuver.modifier.replace(/_/g, " ")}` : "";
      const roadName = step.name ? ` onto ${step.name}` : "";
      const text = maneuver.type === "depart"
        ? `Head${modifier}${roadName}`
        : maneuver.type === "arrive"
          ? "Arrive at your destination"
          : `${maneuver.type || "Continue"}${modifier}${roadName}`;
      instructions.push({
        text,
        distance: Number.isFinite(Number(step.distance)) ? Number(step.distance) : 0,
        time: Number.isFinite(Number(step.duration)) ? Number(step.duration) * 1000 : 0,
        interval: [startIndex, endIndex],
      });
    }
  }
  return {
    provider: "OSRM",
    paths: [{
      distance: Number(route.distance),
      time: Number(route.duration) * 1000,
      points: { type: "LineString", coordinates },
      instructions: instructions.length ? instructions : [{
        text: "Continue to your destination",
        distance: Number(route.distance),
        time: Number(route.duration) * 1000,
        interval: [0],
      }],
    }],
  };
}

async function fetchOsrmRoute(startLat, startLon, endLat, endLon, timeoutMs) {
  if (timeoutMs <= 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = OSRM_URL +
    `${startLon},${startLat};${endLon},${endLat}?overview=full&steps=true&geometries=geojson`;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "SafeRoute/1.0 (routing fallback)" },
    });
    if (!response.ok) return null;
    return convertOsrmRoute(await response.json());
  } catch (error) {
    console.warn("[routing] OSRM fallback did not return a route:", error.name);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromUpstream(startLat, startLon, endLat, endLon) {
  const url = buildUpstreamUrl(startLat, startLon, endLat, endLon);
  const deadline = Date.now() + ROUTE_TOTAL_TIMEOUT_MS;
  let fallbackReason = url ? "upstream_error" : "no_provider";
  let fallbackStatus = url ? 502 : null;

  if (url) {
    const controller = new AbortController();
    const timeoutMs = Math.min(GRAPHHOPPER_TIMEOUT_MS, Math.max(1, deadline - Date.now()));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const data = await response.json();
        if (hasValidRouteGeometry(data)) return data;
        fallbackReason = data && Array.isArray(data.paths) && data.paths.length === 0
          ? "route_not_found"
          : "invalid_upstream_response";
      } else {
        fallbackStatus = response.status;
        fallbackReason = response.status === 400 ? "route_not_found" : "upstream_error";
      }
    } catch (error) {
      fallbackReason = error.name === "AbortError"
        ? "upstream_timeout"
        : error instanceof SyntaxError ? "invalid_upstream_response" : "upstream_error";
      fallbackStatus = error.name === "AbortError" ? 504 : 502;
      console.warn("[graphhopper] primary routing request failed; trying OSRM fallback:", error.name);
    } finally {
      clearTimeout(timeout);
    }
  }

  const osrm = await fetchOsrmRoute(startLat, startLon, endLat, endLon, deadline - Date.now());
  if (osrm) return osrm;
  if (fallbackReason === "route_not_found") {
    return { paths: [], message: "No drivable route was found by the configured routing providers." };
  }
  return buildFallbackRouteResponse({
    reason: fallbackReason,
    ...(fallbackStatus ? { upstreamStatus: fallbackStatus } : {}),
  });
}

// Public entry point used by routes/route.js.
async function getRoute(startLat, startLon, endLat, endLon) {
  const key = cacheKey(startLat, startLon, endLat, endLon);

  const cached = await getFromCache(key);
  if (cached) {
    return {
      data: validateRouteResponse(cached),
      cacheHit: true,
      deduped: false,
    };
  }

  if (inFlight.has(key)) {
    const data = await inFlight.get(key);
    return { data, cacheHit: false, deduped: true };
  }

  const promise = upstreamQueue
    .runThroughUpstreamQueue(() => fetchFromUpstream(startLat, startLon, endLat, endLon))
    .then(async (data) => {
      const validatedData = validateRouteResponse(data);

      // Only cache genuinely successful routes — never cache errors
      // or "no route found" responses.
      if (hasValidRouteGeometry(validatedData)) {
        await setInCache(key, validatedData);
      }
      return validatedData;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);

  const data = await promise;
  return { data, cacheHit: false, deduped: false };
}

function getStatus() {
  const effectiveCloudConfigured = ROUTING_MODE === "cloud" && Boolean(GRAPHHOPPER_API_KEY);
  const effectiveSelfHostedConfigured = ROUTING_MODE === "self_hosted" && Boolean(GRAPHHOPPER_SELF_HOSTED_URL);

  return {
    mode: ROUTING_MODE,
    cloudConfigured: effectiveCloudConfigured,
    selfHostedConfigured: effectiveSelfHostedConfigured,
    cacheBackend: redis.isAvailable() ? "redis (shared)" : "in-memory (per-instance)",
    // localCache.size is only meaningful in the in-memory-fallback case;
    // when Redis is active this reports the local fallback map, which
    // should stay near 0 since it's bypassed, not the shared Redis size
    // (a Redis DBSIZE/KEYS scan is avoidable overhead for a status call).
    cacheSize: localCache.size,
    cacheMaxEntries: CACHE_MAX_ENTRIES,
    inFlightCount: inFlight.size,
    upstreamQueue: upstreamQueue.getStatus(),
  };
}

module.exports = { getRoute, getStatus, hasValidRouteGeometry };