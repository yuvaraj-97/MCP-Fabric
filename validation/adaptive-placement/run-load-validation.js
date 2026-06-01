import { runAdaptivePlacementLoadValidation } from "./load-harness.js";

if (typeof globalThis.gc !== "function") {
  console.warn(
    "WARNING: V8 garbage collection is not exposed. Run this command with --expose-gc for accurate memory validation.",
  );
}

const report = await runAdaptivePlacementLoadValidation({
  sessionCount: readPositiveInteger("MCP_ADAPTIVE_LOAD_SESSION_COUNT", 5_000),
  concurrency: readPositiveInteger("MCP_ADAPTIVE_LOAD_CONCURRENCY", 100),
  maxPeakHeapGrowthBytes: readOptionalPositiveInteger("MCP_ADAPTIVE_LOAD_MAX_PEAK_HEAP_BYTES"),
  maxRetainedHeapGrowthBytes: readOptionalPositiveInteger(
    "MCP_ADAPTIVE_LOAD_MAX_RETAINED_HEAP_BYTES",
  ),
});

console.log("Adaptive placement load validation completed.");
console.log(JSON.stringify(report, null, 2));

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  return parsePositiveInteger(name, rawValue);
}

function readOptionalPositiveInteger(name) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return undefined;
  }

  return parsePositiveInteger(name, rawValue);
}

function parsePositiveInteger(name, rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}
