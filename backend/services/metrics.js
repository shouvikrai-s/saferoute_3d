// Minimal in-process metrics counters, exposed in Prometheus text
// exposition format on GET /metrics — no external client library
// dependency, just plain counters and manual formatting.
//
// SCALE NOTE: like the in-memory rate limiter, these counters are
// per-process. Behind multiple instances, scrape each instance
// individually (standard Prometheus multi-target scraping) rather than
// expecting one instance's /metrics to reflect the whole fleet.

const counters = {
  http_requests_total: 0,
  route_requests_total: 0,
  route_cache_hits_total: 0,
  route_cache_misses_total: 0,
  route_dedup_hits_total: 0,
  route_errors_total: 0,
  rate_limited_total: 0,
  nearby_requests_total: 0,
  nearby_errors_total: 0,
  // Phase 1 additions — upstream resilience layer (services/upstreamQueue.js)
  upstream_retries_total: 0,
  upstream_rejected_capacity_total: 0,
};

const statusCounts = new Map(); // "200" -> count

// Phase 1 addition: gauges (current value, not cumulative) for the
// upstream queue's live state — queue depth, in-flight count, and
// circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN).
const gauges = {
  upstream_queue_depth: 0,
  upstream_in_flight: 0,
  upstream_circuit_state: 0,
};

function setGauge(name, value) {
  if (!(name in gauges)) return;
  gauges[name] = value;
}

function incr(name, by = 1) {
  if (!(name in counters)) return;
  counters[name] += by;
}

function incrStatus(statusCode) {
  const key = String(statusCode);
  statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
}

function renderPrometheus() {
  const lines = [];

  lines.push("# HELP saferoute_uptime_seconds Process uptime in seconds");
  lines.push("# TYPE saferoute_uptime_seconds gauge");
  lines.push(`saferoute_uptime_seconds ${Math.round(process.uptime())}`);

  lines.push("# HELP saferoute_http_requests_total Total HTTP requests handled by this process");
  lines.push("# TYPE saferoute_http_requests_total counter");
  lines.push(`saferoute_http_requests_total ${counters.http_requests_total}`);

  lines.push("# HELP saferoute_http_requests_by_status_total HTTP requests by status code");
  lines.push("# TYPE saferoute_http_requests_by_status_total counter");
  for (const [status, count] of statusCounts) {
    lines.push(`saferoute_http_requests_by_status_total{status="${status}"} ${count}`);
  }

  const routeCounters = [
    ["route_requests_total", "Total /api/route requests"],
    ["route_cache_hits_total", "Route responses served from cache"],
    ["route_cache_misses_total", "Route responses that required an upstream call"],
    ["route_dedup_hits_total", "Route requests served by joining an in-flight identical request"],
    ["route_errors_total", "Route requests that errored (upstream or internal)"],
    ["rate_limited_total", "Requests rejected by the rate limiter"],
    ["nearby_requests_total", "Total spatial /api/nearby/* requests across all resource types"],
    ["nearby_errors_total", "Spatial /api/nearby/* requests that errored (database or internal)"],
  ];
  for (const [name, help] of routeCounters) {
    lines.push(`# HELP saferoute_${name} ${help}`);
    lines.push(`# TYPE saferoute_${name} counter`);
    lines.push(`saferoute_${name} ${counters[name]}`);
  }

  const upstreamCounters = [
    ["upstream_retries_total", "Total upstream retry attempts (429/502/503/504 only)"],
    ["upstream_rejected_capacity_total", "Requests rejected because the upstream queue was full"],
  ];
  for (const [name, help] of upstreamCounters) {
    lines.push(`# HELP saferoute_${name} ${help}`);
    lines.push(`# TYPE saferoute_${name} counter`);
    lines.push(`saferoute_${name} ${counters[name]}`);
  }

  const gaugeDefs = [
    ["upstream_queue_depth", "Requests currently waiting in the bounded upstream queue"],
    ["upstream_in_flight", "Requests currently executing against the upstream (within concurrency limit)"],
    ["upstream_circuit_state", "Circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN"],
  ];
  for (const [name, help] of gaugeDefs) {
    lines.push(`# HELP saferoute_${name} ${help}`);
    lines.push(`# TYPE saferoute_${name} gauge`);
    lines.push(`saferoute_${name} ${gauges[name]}`);
  }

  return lines.join("\n") + "\n";
}

module.exports = { incr, incrStatus, setGauge, renderPrometheus };