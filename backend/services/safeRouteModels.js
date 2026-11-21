"use strict";

const MODEL_VERSION = "0.1.0";
const MODEL_NAME = "SafeRouteDeterministicRules";
const MODEL_TYPE = "deterministic-feature-weighted-rules";

function invalid(message, code = "invalid_input") {
  const error = new Error(message);
  error.statusCode = code === "insufficient_data" ? 422 : 400;
  error.code = code;
  return error;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function requireFeatures(input, task, names) {
  if (!input || input.task !== task || !input.features || typeof input.features !== "object") {
    throw invalid(`Validated ${task} features are required.`);
  }
  const values = {};
  names.forEach((name) => {
    const value = input.features[name];
    if (!finite(value)) {
      throw invalid(`Feature '${name}' is unavailable.`, "insufficient_data");
    }
    if (name.endsWith("Risk") && (value < 0 || value > 1)) {
      throw invalid(`Feature '${name}' must be between 0 and 1.`);
    }
    if (name === "gpsAvailable" && value !== 0 && value !== 1) {
      throw invalid(`Feature '${name}' must be 0 or 1.`);
    }
    if (name === "routeAvailable" && value !== 0 && value !== 1) {
      throw invalid(`Feature '${name}' must be 0 or 1.`);
    }
    if (["verifiedCount", "routeHits", "resourceCount", "placeCount"].includes(name) &&
        (!Number.isInteger(value) || value < 0)) {
      throw invalid(`Feature '${name}' must be a non-negative integer.`);
    }
    if (["distanceKm", "durationMin", "precipitation"].includes(name) && value < 0) {
      throw invalid(`Feature '${name}' must be non-negative.`);
    }
    values[name] = value;
  });
  return values;
}

function risk(score) {
  if (score >= 0.8) return "CRITICAL";
  if (score >= 0.6) return "HIGH";
  if (score >= 0.35) return "MODERATE";
  return "LOW";
}

function classify(input) {
  const startedAt = Date.now();
  const task = input && input.task;
  let values;
  let score;
  let recommendation;
  let result;
  if (task === "route") {
    values = requireFeatures(input, task, ["distanceKm", "durationMin", "trafficRisk", "weatherRisk", "hazardRisk"]);
    score = Math.min(1, values.trafficRisk * 0.25 + values.weatherRisk * 0.2 + values.hazardRisk * 0.4 + Math.min(values.distanceKm / 300, 1) * 0.1 + Math.min(values.durationMin / 360, 1) * 0.05);
    result = risk(score);
    recommendation = score >= 0.6 ? "Review verified hazards and allow additional travel time." : "No elevated modelled route risk is indicated by current validated inputs.";
  } else if (task === "weather") {
    values = requireFeatures(input, task, ["precipitation"]);
    score = Math.min(1, Math.max(0, values.precipitation / 10));
    result = risk(score);
    recommendation = score >= 0.6 ? "Monitor official weather alerts and avoid unnecessary exposure." : "Current-condition model does not indicate elevated rainfall risk.";
  } else if (task === "hazards") {
    values = requireFeatures(input, task, ["verifiedCount", "routeHits", "precipitation"]);
    score = Math.min(1, Math.min(values.verifiedCount / 4, 0.4) + Math.min(values.routeHits / 2, 0.45) + Math.min(values.precipitation / 20, 0.15));
    result = risk(score);
    recommendation = score >= 0.6 ? "Treat this as a heuristic screening result and verify official advisories." : "No elevated modelled hazard risk is indicated by the submitted numeric inputs.";
  } else if (task === "safety") {
    values = requireFeatures(input, task, ["trafficRisk", "weatherRisk", "hazardRisk", "resourceCount"]);
    score = Math.min(1, values.trafficRisk * 0.25 + values.weatherRisk * 0.2 + values.hazardRisk * 0.45 + (values.resourceCount > 0 ? 0 : 0.1));
    result = risk(score);
    recommendation = score >= 0.6 ? "Follow this deterministic screening result and keep emergency contacts available." : "Submitted numeric inputs do not trigger elevated screening thresholds; keep normal safety precautions.";
  } else if (task === "map") {
    values = requireFeatures(input, task, ["gpsAvailable", "trafficRisk", "weatherRisk", "resourceCount"]);
    score = Math.min(1, values.trafficRisk * 0.4 + values.weatherRisk * 0.3 + (values.gpsAvailable ? 0 : 0.2));
    result = risk(score);
    recommendation = values.gpsAvailable ? "Use the current map context and review source-labelled resources." : "Enable location to improve map-context analysis.";
  } else if (task === "tourism") {
    values = requireFeatures(input, task, ["placeCount", "weatherRisk"]);
    score = values.placeCount > 0 ? Math.min(1, values.weatherRisk * 0.7) : 0;
    result = values.placeCount > 0 ? risk(score) : "LOW";
    recommendation = values.placeCount > 0 ? "Use only source-labelled places and verify access conditions." : "No verified tourism records are available in the current map scope.";
  } else if (task === "emergency") {
    values = requireFeatures(input, task, ["resourceCount", "hazardRisk"]);
    score = Math.min(1, values.hazardRisk * 0.7 + (values.resourceCount > 0 ? 0 : 0.3));
    result = risk(score);
    recommendation = "Contact emergency services directly; this model does not claim availability or response status.";
  } else {
    throw invalid("Unsupported AI model task.");
  }

  return {
    task,
    model: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    modelType: MODEL_TYPE,
    status: "INFERRED",
    inferenceTimestamp: new Date().toISOString(),
    inferenceMs: Date.now() - startedAt,
    result,
    risk: result,
    features: values,
    recommendation,
    explanation: "Deterministic rules were applied to client-submitted numeric features. Input provenance was not independently verified; no trained AI model or live provider was queried.",
  };
}

module.exports = { classify, MODEL_NAME, MODEL_VERSION, MODEL_TYPE };
