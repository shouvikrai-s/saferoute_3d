#!/usr/bin/env node
"use strict";

const { trainFloodModel, persistModel, validateArtifact } = require("../services/floodModel");

function main() {
  const artifact = trainFloodModel();
  if (!validateArtifact(artifact)) {
    throw new Error("The trained flood model artifact is invalid.");
  }

  const persistedPath = persistModel(artifact);
  const averageMae = artifact.evaluation.model.value_m3_s;
  const baselineMae = artifact.evaluation.baseline.value_m3_s;
  console.log(`Flood model trained successfully: ${persistedPath}`);
  console.log(`MAE: ${averageMae.toFixed(3)} m3/s`);
  console.log(`Baseline MAE: ${baselineMae.toFixed(3)} m3/s`);
  console.log(`Relative improvement: ${artifact.evaluation.improvement_pct.toFixed(2)}%`);
  console.log("This is a contextual discharge-forecast model, not an official flood alert system.");
}

try {
  main();
} catch (error) {
  console.error("[flood-model-train] training failed:", error.message);
  process.exitCode = 1;
}
