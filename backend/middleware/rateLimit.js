// Per-IP rate limiter (fixed window), now Redis-backed when available
// with automatic, transparent fallback to the original in-memory
// implementation.
//
// WHY THIS MATTERS FOR SCALING: the previous in-memory-only version
// was explicitly documented as process-local — correct for one
// instance, but each instance behind a load balancer would allow N
// requests INDEPENDENTLY (so real effective limit = N * instanceCount).
// With REDIS_URL configured, all instances share one counter per IP,
// so the limit is enforced correctly across the whole fleet. Without
// Redis configured (or if Redis becomes unavailable mid-session), it
// falls back to the original correct-for-one-instance behavior — never
// a hard failure.

const redis = require("../services/redisClient");
const metrics = require("../services/metrics");

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30);

// --- In-memory fallback (identical behavior to the original P2 version) ---
const hits = new Map(); // ip -> { count, windowStart }
const MAX_TRACKED_IPS = 10000;

function localRateLimit(ip) {
  const now = Date.now();
  let entry = hits.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    if (hits.size >= MAX_TRACKED_IPS && !hits.has(ip)) {
      const oldestKey = hits.keys().next().value;
      hits.delete(oldestKey);
    }
    hits.set(ip, entry);
  }

  entry.count += 1;
  const retryAfterSec = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
  return { allowed: entry.count <= MAX_REQUESTS, retryAfterSec };
}

// --- Redis-backed shared limiter (fixed window via INCR + PEXPIRE) ---
// This is the standard atomic-enough fixed-window pattern: INCR always
// returns the new count atomically; only the first request in a window
// sets the expiry. A rare race at the exact window boundary could let
// one extra request through — an acceptable, well-known trade-off for
// avoiding a Lua script / MULTI for this use case.
async function redisRateLimit(ip) {
  const client = redis.getClient();
  const key = `saferoute:ratelimit:${ip}`;

  const count = await client.incr(key);
  if (count === 1) {
    await client.pexpire(key, WINDOW_MS);
  }
  const ttl = await client.pttl(key);
  const retryAfterSec = Math.ceil(Math.max(ttl, 0) / 1000);

  return { allowed: count <= MAX_REQUESTS, retryAfterSec };
}

async function rateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";

  let result;
  if (redis.isAvailable()) {
    try {
      result = await redisRateLimit(ip);
    } catch (err) {
      console.error("[rateLimit] Redis error, falling back to in-memory for this request:", err.message);
      result = localRateLimit(ip);
    }
  } else {
    result = localRateLimit(ip);
  }

  if (!result.allowed) {
    metrics.incr("rate_limited_total");
    res.set("Retry-After", String(result.retryAfterSec));
    return res.status(429).json({
      error: "rate_limited",
      message: "Too many route requests. Please slow down.",
      retryAfterSeconds: result.retryAfterSec,
    });
  }

  next();
}

module.exports = { rateLimit };