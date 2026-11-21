"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MODEL_NAME = "SafeRouteTrafficKMeans";
const MODEL_VERSION = "0.1.0";
const MAX_SAMPLES = 500;
const MIN_SAMPLES = 3;
const MAX_ITERATIONS = 16;
const MAX_OBSERVATION_AGE_MS = 120000;
const ARTIFACT_DIRECTORY = path.join(__dirname, "..", "data", "model-artifacts");
const ARTIFACT_PATH = path.join(ARTIFACT_DIRECTORY, `saferoute-traffic-kmeans-${MODEL_VERSION}.json`);

function fail(message, code = "invalid_input") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function normalizeRelativeSpeed(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.observations)) {
    throw fail("Traffic observations are required.");
  }
  if (input.observations.length > MAX_SAMPLES) {
    throw fail(`A maximum of ${MAX_SAMPLES} observations is allowed.`);
  }
  if (input.source !== "TomTom Traffic Flow") {
    throw fail("Only validated TomTom Traffic Flow observations are supported.");
  }
  const observedAt = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > Date.now() + 30000) {
    throw fail("A valid non-future traffic observation timestamp is required.", "insufficient_data");
  }
  if (Date.now() - observedAt > MAX_OBSERVATION_AGE_MS) {
    throw fail("Traffic observations are stale and cannot be classified as current.", "insufficient_data");
  }
  const values = input.observations.map((observation) => {
    const relativeSpeed = observation && normalizeRelativeSpeed(observation.relativeSpeed);
    return relativeSpeed;
  });
  if (values.some((value) => value === null || value < 0 || value > 1)) {
    throw fail("Every relative_speed observation must be a number between 0 and 1.", "insufficient_data");
  }
  if (values.length < MIN_SAMPLES) {
    throw fail(
      `At least ${MIN_SAMPLES} valid TomTom relative_speed observations are required.`,
      "insufficient_data"
    );
  }
  return values;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Number(value.toFixed(4))))].sort(
    (a, b) => a - b
  );
}

function quantile(values, fraction) {
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function fitKMeans(values) {
  const unique = uniqueSorted(values);
  const clusterCount = Math.min(3, unique.length);
  let centers = Array.from({ length: clusterCount }, (_, index) =>
    quantile(values.slice().sort((a, b) => a - b), index / Math.max(1, clusterCount - 1))
  );

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const groups = centers.map(() => []);
    values.forEach((value) => {
      let best = 0;
      let distance = Math.abs(value - centers[0]);
      for (let index = 1; index < centers.length; index += 1) {
        const candidateDistance = Math.abs(value - centers[index]);
        if (candidateDistance < distance) {
          best = index;
          distance = candidateDistance;
        }
      }
      groups[best].push(value);
    });
    const nextCenters = centers.map((center, index) => {
      if (!groups[index].length) return center;
      return groups[index].reduce((sum, value) => sum + value, 0) / groups[index].length;
    });
    const moved = nextCenters.some((center, index) => Math.abs(center - centers[index]) > 0.00001);
    centers = nextCenters;
    if (!moved) break;
  }

  return centers.sort((a, b) => a - b);
}

function classify(center) {
  if (center < 0.25) return "SEVERE";
  if (center < 0.5) return "HEAVY";
  if (center < 0.65) return "MODERATE";
  if (center < 0.8) return "LIGHT";
  return "FREE";
}

function riskFor(congestionClass) {
  if (congestionClass === "SEVERE" || congestionClass === "HEAVY") return "HIGH";
  if (congestionClass === "MODERATE") return "MEDIUM";
  return "LOW";
}

function buildDefaultArtifact() {
  return {
    modelName: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    algorithm: "kmeans",
    modelType: "not-trained-kmeans-artifact",
    status: "not_trained",
    trainingStatus: "not_trained",
    trainingDataProvenance: "No verified public traffic dataset is bundled with this repository. A real TomTom/OSM/road-traffic training set with licensing and usage terms must be added before this model can be considered production-ready.",
    featureDefinitions: {
      relativeSpeed: {
        unit: "ratio",
        range: [0, 1],
        description: "TomTom relative_speed value across a traffic segment; 1.0 indicates free flow and lower values indicate reduced throughput.",
      },
    },
    normalization: "Values are left in the original relative_speed range [0,1] and are validated for out-of-range and stale observations before inference.",
    artifactPath: ARTIFACT_PATH,
    centers: [],
    evaluation: {
      baseline: "not_run",
      measured: false,
      notes: "No credible licence-cleared traffic dataset is available in the project bundle. Validation is limited to data-quality checks and deterministic model metadata.",
    },
    createdAt: new Date().toISOString(),
  };
}

function resolveArtifactPath(customPath) {
  return customPath ? path.resolve(customPath) : ARTIFACT_PATH;
}

function ensureArtifactDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function loadPersistedModel(options = {}) {
  const targetPath = resolveArtifactPath(options.path || ARTIFACT_PATH);
  try {
    const raw = fs.readFileSync(targetPath, "utf8");
    const artifact = JSON.parse(raw);
    if (!artifact || typeof artifact !== "object") {
      return { status: "invalid", message: "The persisted model artifact is malformed.", artifact: null };
    }
    if (artifact.modelName !== MODEL_NAME || artifact.modelVersion !== MODEL_VERSION) {
      return { status: "incompatible", message: "The persisted model artifact does not match the SafeRouteTrafficKMeans v0.1.0 contract.", artifact: null };
    }
    return { status: artifact.status === "trained" ? "trained" : "not_trained", message: artifact.status === "trained" ? "Persisted model artifact loaded." : "Artifact exists but is not trained for production use.", artifact };
  } catch (error) {
    if (options.createDefault !== false) {
      ensureArtifactDirectory(path.dirname(targetPath));
      const fallback = buildDefaultArtifact();
      try {
        fs.writeFileSync(targetPath, JSON.stringify(fallback, null, 2));
      } catch (writeError) {
        // Ignore write failures in environments without filesystem write access.
      }
      return { status: "missing", message: "No persisted model artifact was found; a default not-trained artifact was created.", artifact: fallback };
    }
    return { status: "missing", message: "No persisted model artifact was found.", artifact: null };
  }
}

function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  if (artifact.modelName !== MODEL_NAME) return false;
  if (artifact.modelVersion !== MODEL_VERSION) return false;
  if (artifact.status === "trained") {
    return Array.isArray(artifact.centers) && artifact.centers.length > 0 && artifact.centers.every((center) => typeof center === "number" && Number.isFinite(center));
  }
  return true;
}

function trainTrafficModel({ dataset = [], source = "unspecified" } = {}) {
  const values = Array.isArray(dataset)
    ? dataset.map((entry) => {
        const relativeSpeed = typeof entry === "number" ? entry : entry && entry.relativeSpeed;
        if (typeof relativeSpeed !== "number" || !Number.isFinite(relativeSpeed) || relativeSpeed < 0 || relativeSpeed > 1) {
          throw fail("Every training sample must include a valid relativeSpeed in the range [0,1].", "insufficient_data");
        }
        return relativeSpeed;
      })
    : [];

  if (values.length < MIN_SAMPLES) {
    throw fail(`Training requires at least ${MIN_SAMPLES} valid relativeSpeed values.`, "insufficient_data");
  }

  const centers = fitKMeans(values);
  const artifact = {
    modelName: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    algorithm: "kmeans",
    modelType: "trained-kmeans-artifact",
    status: "trained",
    trainingStatus: "trained",
    trainingDataSource: source,
    centers,
    featureDefinitions: {
      relativeSpeed: {
        unit: "ratio",
        range: [0, 1],
        description: "TomTom relative_speed values from verified traffic observations.",
      },
    },
    normalisation: "relativeSpeed values are normalized to the provider's 0..1 scale and validated before clustering.",
    trainingDataProvenance: "The dataset must be taken from a licence-cleared, documented TomTom or equivalent provider feed; this project does not bundle such a verified dataset by default.",
    evaluation: {
      baseline: "not_run",
      measured: false,
      notes: "No live evaluation dataset is bundled in this repository; this artifact is therefore a metadata-valid placeholder until verified data is added.",
    },
    trainedAt: new Date().toISOString(),
    sampleCount: values.length,
  };

  ensureArtifactDirectory(ARTIFACT_DIRECTORY);
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  return artifact;
}

function inferTraffic(input) {
  const startedAt = Date.now();
  const values = validateInput(input);
  const persisted = loadPersistedModel({ createDefault: true });
  const fallbackMode = persisted.status !== "trained" || !validateArtifact(persisted.artifact);

  if (!fallbackMode) {
    const centers = Array.isArray(persisted.artifact.centers) ? persisted.artifact.centers : [];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const closestCenter = centers.length > 0
      ? centers.reduce((best, center) => Math.abs(center - mean) < Math.abs(best - mean) ? center : best, centers[0])
      : mean;
    const congestionClass = classify(closestCenter);
    const routeAffected = input.routeRelationship === true
      ? "YES"
      : input.routeRelationship === false
        ? "NO"
        : "UNKNOWN";

    return {
      task: "traffic",
      model: MODEL_NAME,
      modelVersion: MODEL_VERSION,
      modelType: "trained-kmeans-artifact",
      status: "INFERRED",
      provenanceVerified: true,
      trainingStatus: persisted.artifact.trainingStatus,
      artifactPath: persisted.artifact.artifactPath || ARTIFACT_PATH,
      trainingData: persisted.artifact.trainingDataProvenance,
      observationTimestamp: new Date(Date.parse(input.observedAt)).toISOString(),
      observationAgeMs: Math.max(0, Date.now() - Date.parse(input.observedAt)),
      sampleCount: values.length,
      inferenceTimestamp: new Date().toISOString(),
      inferenceTimeMs: Date.now() - startedAt,
      congestionClass,
      risk: riskFor(congestionClass),
      affectedRoute: routeAffected,
      recommendation: congestionClass === "FREE" || congestionClass === "LIGHT"
        ? "No modelled congestion escalation is indicated by the current traffic observations."
        : "Allow additional travel time and review the deterministic route assessment.",
      features: {
        observationCount: values.length,
        meanRelativeSpeed: Number(mean.toFixed(4)),
        modelledCenter: Number(closestCenter.toFixed(4)),
        clusterCount: centers.length,
      },
      explanation: "Inference is based on the persisted SafeRouteTrafficKMeans v0.1.0 artifact and validated traffic observations. The artifact must still be supported by a documented, licence-cleared traffic dataset before being considered production ready.",
    };
  }

  const centers = fitKMeans(values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const closestCenter = centers.reduce((best, center) =>
    Math.abs(center - mean) < Math.abs(best - mean) ? center : best
  , centers[0]);
  const spread = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  );
  const congestionClass = classify(closestCenter);
  const routeAffected = input.routeRelationship === true
    ? "YES"
    : input.routeRelationship === false
      ? "NO"
      : "UNKNOWN";

  return {
    task: "traffic",
    model: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    modelType: "per-request-unsupervised-kmeans",
    status: "INFERRED",
    provenanceVerified: false,
    trainingStatus: persisted.status,
    artifactPath: persisted.artifact && persisted.artifact.artifactPath ? persisted.artifact.artifactPath : ARTIFACT_PATH,
    trainingData: "Current client-submitted relative_speed values are clustered in memory per request. No offline training job, labelled training set, or persisted trained model is configured.",
    observationTimestamp: new Date(Date.parse(input.observedAt)).toISOString(),
    observationAgeMs: Math.max(0, Date.now() - Date.parse(input.observedAt)),
    sampleCount: values.length,
    inferenceTimestamp: new Date().toISOString(),
    inferenceTimeMs: Date.now() - startedAt,
    congestionClass,
    risk: riskFor(congestionClass),
    affectedRoute: routeAffected,
    recommendation: congestionClass === "FREE" || congestionClass === "LIGHT"
      ? "No modelled congestion escalation is indicated by the current traffic observations."
      : "Allow additional travel time and review the deterministic route assessment.",
    features: {
      observationCount: values.length,
      meanRelativeSpeed: Number(mean.toFixed(4)),
      modelledCenter: Number(closestCenter.toFixed(4)),
      spread: Number(spread.toFixed(4)),
      clusterCount: centers.length,
    },
    explanation: "This is an unsupervised per-request clustering calculation, not inference from a previously trained or persisted model. The claimed source and extraction are not independently verified.",
  };
}

module.exports = {
  MODEL_NAME,
  MODEL_VERSION,
  MAX_SAMPLES,
  MAX_ITERATIONS,
  DEFAULT_ARTIFACT: buildDefaultArtifact(),
  ARTIFACT_PATH,
  resolveArtifactPath,
  loadPersistedModel,
  validateArtifact,
  buildDefaultArtifact,
  fitKMeans,
  classify,
  riskFor,
  inferTraffic,
  trainTrafficModel,
};
