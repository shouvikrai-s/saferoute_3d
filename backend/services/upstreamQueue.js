const metrics = require("./metrics");

const MAX_CONCURRENT = Number(process.env.GRAPHHOPPER_MAX_CONCURRENT || 5);
const QUEUE_MAX_DEPTH = Number(process.env.UPSTREAM_QUEUE_MAX_DEPTH || 50);
const MAX_RETRIES = Number(process.env.UPSTREAM_MAX_RETRIES || 2);
const RETRY_BASE_MS = Number(process.env.UPSTREAM_RETRY_BASE_MS || 200);
const RETRY_MAX_MS = Number(process.env.UPSTREAM_RETRY_MAX_MS || 2000);
const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_FAILURE_THRESHOLD || 5);
const CIRCUIT_OPEN_DURATION_MS = Number(process.env.CIRCUIT_OPEN_DURATION_MS || 10000);

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

let activeCount = 0;
const queue = []; // FIFO of { resolve, reject, taskFn }

let circuitState = "CLOSED"; // "CLOSED" | "OPEN" | "HALF_OPEN"
let consecutiveFailures = 0;
let circuitOpenedAt = null;
let halfOpenTrialInFlight = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const exp = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  const jitter = Math.random() * exp * 0.5;
  return Math.round(exp * 0.5 + jitter);
}

function circuitStateToGaugeValue(state) {
  return state === "CLOSED" ? 0 : state === "HALF_OPEN" ? 1 : 2;
}

function updateCircuitMetric() {
  metrics.setGauge("upstream_circuit_state", circuitStateToGaugeValue(circuitState));
}

function recordSuccess() {
  consecutiveFailures = 0;
  if (circuitState === "HALF_OPEN") {
    circuitState = "CLOSED";
    halfOpenTrialInFlight = false;
    console.log("[upstreamQueue] circuit breaker: HALF_OPEN -> CLOSED (trial succeeded)");
    updateCircuitMetric();
  }
}

function recordFailure() {
  if (circuitState === "HALF_OPEN") {
    circuitState = "OPEN";
    circuitOpenedAt = Date.now();
    halfOpenTrialInFlight = false;
    console.warn("[upstreamQueue] circuit breaker: HALF_OPEN -> OPEN (trial failed)");
    updateCircuitMetric();
    return;
  }
  consecutiveFailures++;
  if (circuitState === "CLOSED" && consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitState = "OPEN";
    circuitOpenedAt = Date.now();
    console.warn(
      `[upstreamQueue] circuit breaker: CLOSED -> OPEN (${consecutiveFailures} consecutive failures)`
    );
    updateCircuitMetric();
  }
}

function circuitBreakerError() {
  const err = new Error("Circuit breaker open -- upstream routing service is currently unhealthy");
  err.upstreamStatus = 503;
  err.circuitOpen = true;
  return err;
}

function capacityExhaustedError() {
  const err = new Error("Upstream request queue is full -- server is at capacity");
  err.upstreamStatus = 503;
  err.capacityExhausted = true;
  return err;
}

function processQueue() {
  if (activeCount >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (!next) return;
  metrics.setGauge("upstream_queue_depth", queue.length);
  runTask(next.taskFn, next.resolve, next.reject, next.isHalfOpenTrial);
}

async function runTask(taskFn, resolve, reject, isHalfOpenTrial = false) {
  activeCount++;
  metrics.setGauge("upstream_in_flight", activeCount);

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const data = await taskFn();
      recordSuccess();
      activeCount--;
      metrics.setGauge("upstream_in_flight", activeCount);
      processQueue();
      resolve(data);
      return;
    } catch (err) {
      const status = err && err.upstreamStatus;
      // A HALF_OPEN trial gets exactly one attempt -- never retried,
      // regardless of status code. Normal (non-trial) requests keep
      // the existing retry behavior unchanged.
      const canRetry = !isHalfOpenTrial && RETRYABLE_STATUSES.has(status) && attempt < MAX_RETRIES;
      if (canRetry) {
        attempt++;
        metrics.incr("upstream_retries_total");
        const delay = backoffDelay(attempt);
        console.warn(
          `[upstreamQueue] retrying after status=${status}, attempt=${attempt}/${MAX_RETRIES}, delayMs=${delay}`
        );
        await sleep(delay);
        continue;
      }
      recordFailure();
      activeCount--;
      metrics.setGauge("upstream_in_flight", activeCount);
      processQueue();
      reject(err);
      return;
    }
  }
}

function runThroughUpstreamQueue(taskFn) {
  if (circuitState === "OPEN") {
    if (Date.now() - circuitOpenedAt >= CIRCUIT_OPEN_DURATION_MS) {
      circuitState = "HALF_OPEN";
      halfOpenTrialInFlight = false;
      console.log("[upstreamQueue] circuit breaker: OPEN -> HALF_OPEN (cooldown elapsed, allowing trial)");
      updateCircuitMetric();
    } else {
      return Promise.reject(circuitBreakerError());
    }
  }

  let isHalfOpenTrial = false;
  if (circuitState === "HALF_OPEN") {
    if (halfOpenTrialInFlight) {
      return Promise.reject(circuitBreakerError());
    }
    halfOpenTrialInFlight = true;
    isHalfOpenTrial = true;
  }

  return new Promise((resolve, reject) => {
    if (activeCount < MAX_CONCURRENT) {
      runTask(taskFn, resolve, reject, isHalfOpenTrial);
      return;
    }
    if (queue.length >= QUEUE_MAX_DEPTH) {
      metrics.incr("upstream_rejected_capacity_total");
      reject(capacityExhaustedError());
      return;
    }
    queue.push({ taskFn, resolve, reject, isHalfOpenTrial });
    metrics.setGauge("upstream_queue_depth", queue.length);
  });
}

function getStatus() {
  return {
    circuitState,
    consecutiveFailures,
    queueDepth: queue.length,
    inFlight: activeCount,
    maxConcurrent: MAX_CONCURRENT,
    queueMaxDepth: QUEUE_MAX_DEPTH,
  };
}

module.exports = { runThroughUpstreamQueue, getStatus };
