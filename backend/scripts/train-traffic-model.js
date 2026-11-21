#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { trainTrafficModel, loadPersistedModel, resolveArtifactPath } = require("../services/trafficModel");

const requestedPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const artifactPath = resolveArtifactPath();

function readDataset(datasetPath) {
  if (!datasetPath) {
    const defaultArtifact = loadPersistedModel({ createDefault: true });
    console.log("No training dataset provided. Persisted artifact remains in the documented not-trained state.");
    console.log(JSON.stringify({
      modelName: defaultArtifact.artifact.modelName,
      modelVersion: defaultArtifact.artifact.modelVersion,
      artifactPath,
      status: defaultArtifact.status,
    }, null, 2));
    return;
  }

  const raw = fs.readFileSync(datasetPath, "utf8");
  const parsed = JSON.parse(raw);
  const dataset = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.samples)
      ? parsed.samples
      : Array.isArray(parsed.observations)
        ? parsed.observations
        : [];

  if (!dataset.length) {
    throw new Error(`The dataset at ${datasetPath} does not contain valid relativeSpeed observations.`);
  }

  const artifact = trainTrafficModel({
    dataset,
    source: path.basename(datasetPath),
  });

  console.log(JSON.stringify({
    modelName: artifact.modelName,
    modelVersion: artifact.modelVersion,
    trainingStatus: artifact.trainingStatus,
    sampleCount: artifact.sampleCount,
    artifactPath,
  }, null, 2));
}

try {
  readDataset(requestedPath);
} catch (error) {
  console.error("[train-traffic-model] failed");
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}
