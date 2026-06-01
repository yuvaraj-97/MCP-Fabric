import { runAdaptivePlacementSustainedValidation } from "./sustained-harness.js";

const report = await runAdaptivePlacementSustainedValidation({
  iterations: readPositiveInteger("MCP_ADAPTIVE_SUSTAINED_ITERATIONS", 5),
  delayMs: readNonNegativeInteger("MCP_ADAPTIVE_SUSTAINED_DELAY_MS", 0),
  thresholds: {
    maxFallbacks: readNonNegativeInteger("MCP_ADAPTIVE_SUSTAINED_MAX_FALLBACKS", 0),
    maxMismatches: readNonNegativeInteger("MCP_ADAPTIVE_SUSTAINED_MAX_MISMATCHES", 0),
    minHighConfidenceRatio: readRatio("MCP_ADAPTIVE_SUSTAINED_MIN_HIGH_CONFIDENCE_RATIO", 1),
    minStatelessRecommendationRatio: readRatio("MCP_ADAPTIVE_SUSTAINED_MIN_STATELESS_RATIO", 1),
    minDriftRatio: readRatio("MCP_ADAPTIVE_SUSTAINED_MIN_DRIFT_RATIO", 1),
    minDynamicRerouteRatio: readRatio("MCP_ADAPTIVE_SUSTAINED_MIN_REROUTE_RATIO", 1),
  },
  onProgress(run) {
    console.error(
      `[adaptive-sustained] iteration ${run.iteration}: workloads=${run.workloadCount} fallbacks=${run.fallbacks} mismatches=${run.mismatches}`,
    );
  },
});

console.log("Adaptive placement sustained canary validation completed.");
console.log(JSON.stringify(report, null, 2));

function readPositiveInteger(name, fallback) {
  const value = readInteger(name, fallback);
  if (value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function readNonNegativeInteger(name, fallback) {
  const value = readInteger(name, fallback);
  if (value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function readInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return parsed;
}

function readRatio(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new TypeError(`${name} must be a number between 0 and 1`);
  }
  return parsed;
}
