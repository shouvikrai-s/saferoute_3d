"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MODEL_NAME = "SafeRouteFloodBaseline";
const MODEL_VERSION = "0.2.0";
const ARTIFACT_DIRECTORY = path.join(__dirname, "..", "data", "model-artifacts");
const ARTIFACT_PATH = path.join(ARTIFACT_DIRECTORY, `saferoute-flood-baseline-${MODEL_VERSION}.json`);
const PROCESSED_DATA_PATH = path.join(__dirname, "..", "data", "processed", "flood_normalized.json");

function fail(message, code = "invalid_input") {
  const error = new Error(message);
  error.statusCode = code === "insufficient_data" ? 422 : 400;
  error.code = code;
  return error;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }
  return sorted[midpoint];
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function isDateOnOrBefore(value, asOfDate) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= asOfDate;
}

function resolveArtifactPath(customPath) {
  return customPath ? path.resolve(customPath) : ARTIFACT_PATH;
}

function ensureArtifactDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function loadFloodDataset(customPath = PROCESSED_DATA_PATH) {
  try {
    const file = path.resolve(customPath);
    const raw = fs.readFileSync(file, "utf8");
    const dataset = JSON.parse(raw);
    if (!dataset || !Array.isArray(dataset.series) || dataset.series.length === 0) {
      throw fail("Processed flood dataset is empty or malformed.", "insufficient_data");
    }
    return dataset;
  } catch (error) {
    if (error && error.code === "insufficient_data") throw error;
    throw fail(`Unable to read the processed flood dataset at ${customPath}.`, "insufficient_data");
  }
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    for (let row = pivotIndex + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivotIndex]) > Math.abs(augmented[pivotRow][pivotIndex])) {
        pivotRow = row;
      }
    }

    if (Math.abs(augmented[pivotRow][pivotIndex]) < 1e-9) {
      throw fail("The flood training system is singular; the regression design matrix is not invertible.", "insufficient_data");
    }

    if (pivotRow !== pivotIndex) {
      const tmp = augmented[pivotIndex];
      augmented[pivotIndex] = augmented[pivotRow];
      augmented[pivotRow] = tmp;
    }

    const divisor = augmented[pivotIndex][pivotIndex];
    for (let col = pivotIndex; col <= size; col += 1) {
      augmented[pivotIndex][col] /= divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivotIndex) continue;
      const factor = augmented[row][pivotIndex];
      if (Math.abs(factor) < 1e-9) continue;
      for (let col = pivotIndex; col <= size; col += 1) {
        augmented[row][col] -= factor * augmented[pivotIndex][col];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function fitWeightedLagModel(seriesValues) {
  if (seriesValues.length < 15) {
    throw fail("At least 15 daily discharge samples are required to train a valid flood baseline model.", "insufficient_data");
  }

  const trainSize = Math.max(10, Math.floor(seriesValues.length * 0.7));
  const train = seriesValues.slice(0, trainSize);
  const test = seriesValues.slice(trainSize);

  const xRows = [];
  const yValues = [];

  for (let index = 1; index < train.length; index += 1) {
    const lag1 = train[index - 1];
    const recent = train.slice(Math.max(0, index - 7), index);
    const mean7 = recent.length ? mean(recent) : lag1;
    xRows.push([1, lag1, mean7]);
    yValues.push(train[index]);
  }

  const normalMatrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const normalVector = [0, 0, 0];

  xRows.forEach((row, rowIndex) => {
    const target = yValues[rowIndex];
    for (let i = 0; i < 3; i += 1) {
      normalVector[i] += row[i] * target;
      for (let j = 0; j < 3; j += 1) {
        normalMatrix[i][j] += row[i] * row[j];
      }
    }
  });

  const coefficients = solveLinearSystem(normalMatrix, normalVector);

  const modelPredictions = [];
  const baselinePredictions = [];
  const actualValues = [];

  for (let index = 0; index < test.length; index += 1) {
    const context = seriesValues.slice(0, trainSize + index);
    const previous = context[context.length - 1];
    const recent = context.slice(-7);
    const mean7 = recent.length ? mean(recent) : previous;
    const modelPrediction = coefficients[0] + coefficients[1] * previous + coefficients[2] * mean7;
    const baselinePrediction = previous;
    const actual = seriesValues[trainSize + index];

    modelPredictions.push(modelPrediction);
    baselinePredictions.push(baselinePrediction);
    actualValues.push(actual);
  }

  const modelMae = mean(modelPredictions.map((value, idx) => Math.abs(value - actualValues[idx])));
  const baselineMae = mean(baselinePredictions.map((value, idx) => Math.abs(value - actualValues[idx])));
  const modelRmse = Math.sqrt(mean(modelPredictions.map((value, idx) => (value - actualValues[idx]) ** 2)));
  const baselineRmse = Math.sqrt(mean(baselinePredictions.map((value, idx) => (value - actualValues[idx]) ** 2)));

  return {
    intercept: coefficients[0],
    lag1_weight: coefficients[1],
    mean7_weight: coefficients[2],
    trainSize,
    testSize: test.length,
    metrics: {
      model_mae: modelMae,
      baseline_mae: baselineMae,
      model_rmse: modelRmse,
      baseline_rmse: baselineRmse,
      improvement_pct: baselineMae > 0 ? (baselineMae - modelMae) / baselineMae * 100 : 0,
      equivalent_uncertainty_m3_s: Math.max(0.1, modelRmse),
    },
  };
}

function trainFloodModel(options = {}) {
  const dataset = options.dataset || loadFloodDataset(options.datasetPath || PROCESSED_DATA_PATH);
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (!isDateOnOrBefore(asOfDate, today)) {
    throw fail(`The flood model as-of date must be a valid UTC date no later than ${today}.`);
  }
  const eligibleRecords = dataset.series
    .filter((record) => isDateOnOrBefore(record.time, asOfDate))
    .sort((a, b) => a.time.localeCompare(b.time));
  if (!eligibleRecords.length) {
    throw fail(`No dated flood inputs are available on or before ${asOfDate}.`, "insufficient_data");
  }
  const byLocation = new Map();

  for (const record of eligibleRecords) {
    const locationId = Number(record.location_id);
    if (!Number.isFinite(locationId)) continue;
    const existing = byLocation.get(locationId) || [];
    existing.push(Number(record.river_discharge_m3_s));
    byLocation.set(locationId, existing);
  }

  const locationModels = [];
  let totalModelMae = 0;
  let totalBaselineMae = 0;
  let totalModelRmse = 0;
  let totalBaselineRmse = 0;

  for (const [locationId, values] of [...byLocation.entries()].sort((a, b) => a[0] - b[0])) {
    const cleanValues = values.filter((value) => Number.isFinite(value));
    if (cleanValues.length < 15) continue;
    const model = fitWeightedLagModel(cleanValues);
    const locationMean = mean(cleanValues);
    const locationMedian = median(cleanValues);

    locationModels.push({
      location_id: locationId,
      history_count: cleanValues.length,
      station_mean_m3_s: locationMean,
      station_median_m3_s: locationMedian,
      intercept: round(model.intercept),
      lag1_weight: round(model.lag1_weight),
      mean7_weight: round(model.mean7_weight),
      residual_rmse_m3_s: round(model.metrics.model_rmse),
      validation: {
        train_size: model.trainSize,
        test_size: model.testSize,
        model_mae: round(model.metrics.model_mae),
        baseline_mae: round(model.metrics.baseline_mae),
        baseline_rmse: round(model.metrics.baseline_rmse),
        model_rmse: round(model.metrics.model_rmse),
        improvement_pct: round(model.metrics.improvement_pct),
      },
    });

    totalModelMae += model.metrics.model_mae;
    totalBaselineMae += model.metrics.baseline_mae;
    totalModelRmse += model.metrics.model_rmse;
    totalBaselineRmse += model.metrics.baseline_rmse;
  }

  if (!locationModels.length) {
    throw fail("At least 15 valid non-future discharge samples per station are required to train the flood model.", "insufficient_data");
  }

  const inputStart = eligibleRecords[0].time;
  const inputEnd = eligibleRecords[eligibleRecords.length - 1].time;
  const aggregateMetrics = {
    model_mae: round(totalModelMae / Math.max(1, locationModels.length)),
    baseline_mae: round(totalBaselineMae / Math.max(1, locationModels.length)),
    model_rmse: round(totalModelRmse / Math.max(1, locationModels.length)),
    baseline_rmse: round(totalBaselineRmse / Math.max(1, locationModels.length)),
    improvement_pct: round(
      ((totalBaselineMae / Math.max(1, locationModels.length)) - (totalModelMae / Math.max(1, locationModels.length))) /
      Math.max(1e-9, totalBaselineMae / Math.max(1, locationModels.length)) * 100
    ),
  };

  const artifact = {
    modelName: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    algorithm: "weighted-lag-baseline",
    modelType: "flood-discharge-forecast",
    status: "trained",
    trainingStatus: "trained",
    trainingDataProvenance: `The model was trained on provider-derived Open-Meteo discharge estimates in ${path.relative(path.join(__dirname, ".."), PROCESSED_DATA_PATH)}. These are not verified in-situ gauge observations. Future-dated records after ${asOfDate} were excluded. Eligible input dates span ${inputStart} through ${inputEnd}.`,
    trainingDataType: "provider-derived discharge estimates; not verified in-situ gauge observations",
    featureDefinitions: {
      lag1: {
        unit: "m3/s",
        description: "Previous day's discharge at the same station.",
      },
      mean7: {
        unit: "m3/s",
        description: "Trailing 7-day rolling mean discharge at the same station.",
      },
    },
    normalization: "Discharge values are kept in native m3/s units with a chronological 70/30 split and no leakage across the split boundary.",
    artifactPath: ARTIFACT_PATH,
    trainingWindow: {
      start: inputStart,
      end: inputEnd,
      asOfDate,
      split: "chronological_70_30",
      station_count: locationModels.length,
    },
    evaluation: {
      baseline: {
        metric: "MAE",
        value_m3_s: aggregateMetrics.baseline_mae,
      },
      model: {
        metric: "MAE",
        value_m3_s: aggregateMetrics.model_mae,
      },
      improvement_pct: aggregateMetrics.improvement_pct,
      notes: `A chronological 70/30 split was used within provider-derived discharge estimates through ${asOfDate}; post-as-of-date records were excluded. These estimates are not independent gauge observations, so this evaluation does not validate real-world flood-warning performance.`,
    },
    locations: locationModels,
    createdAt: new Date().toISOString(),
  };

  return artifact;
}

function persistModel(artifact, customPath) {
  const targetPath = resolveArtifactPath(customPath);
  ensureArtifactDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, JSON.stringify(artifact, null, 2));
  return targetPath;
}

function loadPersistedModel(options = {}) {
  const targetPath = resolveArtifactPath(options.path || ARTIFACT_PATH);
  try {
    const raw = fs.readFileSync(targetPath, "utf8");
    const artifact = JSON.parse(raw);
    if (!artifact || typeof artifact !== "object") {
      return { status: "invalid", message: "The persisted flood model artifact is malformed.", artifact: null };
    }
    if (artifact.modelName !== MODEL_NAME || artifact.modelVersion !== MODEL_VERSION) {
      return { status: "incompatible", message: `The persisted flood model artifact does not match the SafeRouteFloodBaseline v${MODEL_VERSION} contract.`, artifact: null };
    }
    return {
      status: artifact.status === "trained" ? "trained" : "not_trained",
      message: artifact.status === "trained" ? "Persisted flood model artifact loaded." : "Persisted flood model artifact exists but is not trained.",
      artifact,
    };
  } catch (error) {
    if (options.createDefault !== false) {
      const fallback = trainFloodModel();
      const savedPath = persistModel(fallback, targetPath);
      return { status: "missing", message: `No persisted flood model artifact was found; a trained model was saved at ${savedPath}.`, artifact: fallback };
    }
    return { status: "missing", message: "No persisted flood model artifact was found.", artifact: null };
  }
}

function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  if (artifact.modelName !== MODEL_NAME) return false;
  if (artifact.modelVersion !== MODEL_VERSION) return false;
  if (artifact.status !== "trained") return false;
  if (!Array.isArray(artifact.locations) || !artifact.locations.length) return false;
  return artifact.locations.every((entry) => Number.isFinite(entry.intercept) && Number.isFinite(entry.lag1_weight) && Number.isFinite(entry.mean7_weight));
}

function predictForHistory(historyValues, coefficients) {
  const lastValue = historyValues[historyValues.length - 1];
  const recent = historyValues.slice(-7);
  const mean7 = recent.length ? mean(recent) : lastValue;
  return coefficients.intercept + coefficients.lag1_weight * lastValue + coefficients.mean7_weight * mean7;
}

function classifyFloodRisk(historyValues, predictedValue) {
  const reference = historyValues.length ? historyValues : [predictedValue];
  const medianValue = median(reference);
  const sigma = standardDeviation(reference);
  const threshold = medianValue + Math.max(sigma, 0.5);
  if (predictedValue > medianValue + 2 * Math.max(sigma, 0.5)) return "HIGH";
  if (predictedValue > threshold) return "MEDIUM";
  return "LOW";
}

function inferFloodForecast(input = {}) {
  if (!input || typeof input !== "object") {
    throw fail("A flood forecast request object is required.");
  }

  const history = Array.isArray(input.history) ? input.history : Array.isArray(input.observations) ? input.observations : null;
  if (!history || !history.length) {
    throw fail("A non-empty discharge history is required for flood inference.", "insufficient_data");
  }

  const numericHistory = history.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numericHistory.length < 7) {
    throw fail("At least 7 valid recent discharge samples are required for a flood forecast.", "insufficient_data");
  }

  const locationId = Number(input.location_id ?? input.locationId ?? 0);
  if (!Number.isFinite(locationId)) {
    throw fail("A valid location_id is required for flood inference.", "insufficient_data");
  }

  const persisted = loadPersistedModel({ createDefault: true });
  const artifact = persisted.artifact;
  if (!artifact || !validateArtifact(artifact)) {
    throw fail("The persisted flood forecast artifact is unavailable or invalid.", "insufficient_data");
  }

  const site = artifact.locations.find((entry) => Number(entry.location_id) === locationId);
  if (!site) {
    throw fail(`No trained flood baseline is available for location ${locationId}.`, "insufficient_data");
  }

  const prediction = predictForHistory(numericHistory, {
    intercept: site.intercept,
    lag1_weight: site.lag1_weight,
    mean7_weight: site.mean7_weight,
  });

  const baselineMae = Number(artifact.evaluation && artifact.evaluation.baseline && artifact.evaluation.baseline.value_m3_s);
  const modelMae = Number(artifact.evaluation && artifact.evaluation.model && artifact.evaluation.model.value_m3_s);
  const outperformsBaseline = Number.isFinite(baselineMae) && Number.isFinite(modelMae) && modelMae <= baselineMae;
  const risk = outperformsBaseline ? classifyFloodRisk(numericHistory, prediction) : "UNKNOWN";

  return {
    task: "flood",
    model: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    modelType: "flood-discharge-forecast",
    status: "INFERRED",
    provenanceVerified: false,
    sourceStatus: "MODEL",
    inferenceTimestamp: new Date().toISOString(),
    forecast: {
      location_id: site.location_id,
      unit: "m3/s",
      value: round(prediction),
      uncertainty_m3_s: round(Math.max(0.1, site.residual_rmse_m3_s || 0.5)),
      risk,
      evaluation: {
        status: outperformsBaseline ? "BEATS_BASELINE" : "UNDERPERFORMS_BASELINE",
        model_mae_m3_s: Number.isFinite(modelMae) ? modelMae : null,
        baseline_mae_m3_s: Number.isFinite(baselineMae) ? baselineMae : null,
        eligible_as_warning: false,
      },
    },
    explanation: "This forecast uses supplied discharge estimates and their trailing 7-day average. The input provenance is not independently verified; this is a contextual model estimate, not an official flood alert or live gauge observation.",
  };
}

function buildMonitoringStatus(options = {}) {
  const dataset = options.dataset || loadFloodDataset();
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  const availableRecords = dataset.series
    .filter((record) => isDateOnOrBefore(record.time, asOfDate))
    .sort((a, b) => a.time.localeCompare(b.time));
  const artifactState = loadPersistedModel({ createDefault: true });
  const artifact = artifactState.artifact;
  if (!artifact || !validateArtifact(artifact)) {
    return {
      status: "UNAVAILABLE",
      statusSummary: "Flood model not trained.",
      sourceStatus: "UNAVAILABLE",
      sources: [],
      severity: "UNKNOWN",
      classification: "UNKNOWN",
      summary: "No trained flood model artifact is available for this session.",
      model: {
        name: MODEL_NAME,
        version: MODEL_VERSION,
        source: "local-artifact",
        status: "not_trained",
      },
      predictionTimestamp: new Date().toISOString(),
      inputDataAsOf: null,
      inputCoverage: "0/0",
      uncertainty: null,
      area: "Sikkim",
      kind: "flood",
    };
  }

  const byLocation = new Map();
  for (const record of availableRecords) {
    const locationId = Number(record.location_id);
    if (!Number.isFinite(locationId)) continue;
    const latest = byLocation.get(locationId);
    if (!latest || record.time > latest.time) {
      byLocation.set(locationId, { ...record });
    }
  }

  const locationEvaluations = artifact.locations
    .map((entry) => {
      const current = byLocation.get(entry.location_id);
      if (!current) return null;
      const currentValue = Number(current.river_discharge_m3_s);
      const recentValues = availableRecords
        .filter((record) => Number(record.location_id) === entry.location_id)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((record) => Number(record.river_discharge_m3_s))
        .filter((value) => Number.isFinite(value));
      if (!recentValues.length) return null;
      const prediction = predictForHistory(recentValues, {
        intercept: entry.intercept,
        lag1_weight: entry.lag1_weight,
        mean7_weight: entry.mean7_weight,
      });
      const risk = classifyFloodRisk(recentValues, prediction);
      return {
        location_id: entry.location_id,
        currentValue,
        predictedValue: round(prediction),
        risk,
        uncertainty_m3_s: round(Math.max(0.1, entry.residual_rmse_m3_s || 0.5)),
      };
    })
    .filter(Boolean);

  const highestRisk = locationEvaluations.reduce((highest, current) => {
    const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    return rank[current.risk] > rank[highest.risk] ? current : highest;
  }, { risk: "LOW" });

  const averagePredictedValue = mean(locationEvaluations.map((entry) => entry.predictedValue));
  const averageUncertainty = mean(locationEvaluations.map((entry) => entry.uncertainty_m3_s));
  const modelMae = Number(artifact.evaluation && artifact.evaluation.model && artifact.evaluation.model.value_m3_s);
  const baselineMae = Number(artifact.evaluation && artifact.evaluation.baseline && artifact.evaluation.baseline.value_m3_s);
  const outperformsBaseline = Number.isFinite(modelMae) && Number.isFinite(baselineMae) && modelMae <= baselineMae;
  const reportedRisk = outperformsBaseline ? highestRisk.risk : "UNKNOWN";
  const inputDataAsOf = availableRecords.length ? availableRecords[availableRecords.length - 1].time : null;
  if (!locationEvaluations.length) {
    return {
      status: "UNAVAILABLE",
      statusSummary: "No eligible flood model inputs",
      sourceStatus: "UNAVAILABLE",
      sources: [],
      severity: "UNKNOWN",
      classification: "UNKNOWN",
      summary: `No dated discharge estimates are available on or before ${asOfDate}; future-dated records are not used as current inputs.`,
      model: { name: MODEL_NAME, version: MODEL_VERSION, source: "local-artifact", status: "trained" },
      predictionTimestamp: new Date().toISOString(),
      inputDataAsOf: null,
      inputCoverage: `0/${dataset.locations.length}`,
      uncertainty: null,
      area: "Sikkim",
      kind: "flood",
    };
  }

  return {
    status: "MODEL",
    statusSummary: "Model-based discharge forecast",
    sourceStatus: "MODEL",
    sources: [
      `SafeRouteFloodBaseline v${MODEL_VERSION}`,
      `Open-Meteo provider-derived discharge estimates through ${inputDataAsOf} (not verified gauge observations)`,
    ],
    severity: reportedRisk,
    classification: reportedRisk,
    summary: `SafeRoute model estimate for ${locationEvaluations.length} Sikkim locations: average next-day discharge estimate is ${round(averagePredictedValue)} m3/s with ${round(averageUncertainty)} m3/s residual uncertainty. Holdout MAE is ${round(modelMae)} m3/s versus persistence baseline ${round(baselineMae)} m3/s; this output is informational and does not generate a warning or risk classification. Inputs are provider-derived estimates through ${inputDataAsOf}, not verified live gauge observations.`,
    model: {
      name: MODEL_NAME,
      version: MODEL_VERSION,
      source: "local-artifact",
      status: "trained",
      predictionTimestamp: new Date().toISOString(),
      inputDataAsOf,
      inputDataAgeDays: Math.max(0, Math.floor((Date.parse(`${asOfDate}T00:00:00.000Z`) - Date.parse(`${inputDataAsOf}T00:00:00.000Z`)) / 86400000)),
      inputCoverage: `${locationEvaluations.length}/${dataset.locations.length}`,
      uncertainty_m3_s: round(averageUncertainty),
      evaluationStatus: outperformsBaseline ? "BEATS_BASELINE" : "UNDERPERFORMS_BASELINE",
      eligibleAsWarning: false,
    },
    predictionTimestamp: new Date().toISOString(),
    inputDataAsOf,
    inputDataAgeDays: Math.max(0, Math.floor((Date.parse(`${asOfDate}T00:00:00.000Z`) - Date.parse(`${inputDataAsOf}T00:00:00.000Z`)) / 86400000)),
    inputCoverage: `${locationEvaluations.length}/${dataset.locations.length}`,
    uncertainty: round(averageUncertainty),
    area: "Sikkim",
    kind: "flood",
  };
}

module.exports = {
  MODEL_NAME,
  MODEL_VERSION,
  MODEL_TYPE: "flood-discharge-forecast",
  ARTIFACT_PATH,
  resolveArtifactPath,
  loadFloodDataset,
  trainFloodModel,
  loadPersistedModel,
  validateArtifact,
  persistModel,
  inferFloodForecast,
  buildMonitoringStatus,
  classifyFloodRisk,
  predictForHistory,
};
