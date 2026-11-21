// Thin Redis wrapper with graceful, automatic fallback.
//
// Redis is treated as an optional shared-state ACCELERATOR, never a
// hard dependency:
//  - If REDIS_URL is not set              -> in-memory fallback, no attempt made.
//  - If the `ioredis` package isn't installed -> in-memory fallback, logged once.
//  - If Redis is unreachable/down          -> in-memory fallback, logged, retried
//                                             in the background by ioredis itself.
//
// This means a single unhealthy Redis instance can NEVER take the whole
// API down — every caller (rateLimit.js, graphhopper.js) checks
// isAvailable() and falls back to its existing bounded in-memory logic
// on every call, not just at startup, so a mid-session Redis outage
// degrades gracefully to single-instance behavior instead of erroring.
//
// CONFIRMED vs REQUIRES INFRASTRUCTURE:
//  - This file is CODE INSPECTED + SYNTAX CHECKED.
//  - It has NOT been exercised against a real Redis instance in this
//    session (no network access here) — that requires you to run it
//    against actual Redis (self-hosted or managed, e.g. Upstash/Redis
//    Cloud/ElastiCache) and confirm the "[redis] connected" log line.

const REDIS_URL = process.env.REDIS_URL || "";

let client = null;
let connected = false;
let attemptedConnect = false;

function tryConnect() {
  if (attemptedConnect) return;
  attemptedConnect = true;

  if (!REDIS_URL) {
    console.log("[redis] REDIS_URL not set — running with in-memory fallback only.");
    return;
  }

  let Redis;
  try {
    Redis = require("ioredis");
  } catch (e) {
    console.warn(
      "[redis] REDIS_URL is set but the `ioredis` package is not installed. " +
      "Run `npm install ioredis` in backend/ to enable shared Redis cache/rate-limiting. " +
      "Running with in-memory fallback only."
    );
    return;
  }

  try {
    client = new Redis(REDIS_URL, {
      // Fail fast rather than queueing requests indefinitely if Redis
      // is down — callers fall back to in-memory logic immediately.
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      lazyConnect: false,
    });

    client.on("connect", () => {
      connected = true;
      console.log("[redis] connected: " + REDIS_URL.replace(/:\/\/.*@/, "://***@"));
    });

    client.on("error", (err) => {
      if (connected) {
        console.error("[redis] connection error, falling back to in-memory:", err.message);
      }
      connected = false;
    });
  } catch (e) {
    console.error("[redis] failed to initialize client:", e.message);
    client = null;
  }
}

tryConnect();

function isAvailable() {
  return Boolean(client) && connected;
}

function getClient() {
  return client;
}

module.exports = { getClient, isAvailable };