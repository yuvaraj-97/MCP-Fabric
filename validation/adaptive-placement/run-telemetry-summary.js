import {
  createTelemetryQualitySummary,
  loadTelemetryInputs,
} from "./telemetry-summary.js";

const reports = loadTelemetryInputs(process.env.MCP_PHASE4_TELEMETRY_INPUTS);
const summary = createTelemetryQualitySummary({
  evidenceDir: process.env.MCP_PHASE4_TELEMETRY_EVIDENCE_DIR,
  reports,
  minHighConfidenceRatio: readOptionalRatio(
    process.env.MCP_PHASE4_TELEMETRY_MIN_HIGH_CONFIDENCE_RATIO,
  ),
});

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}

function readOptionalRatio(rawValue) {
  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new TypeError("MCP_PHASE4_TELEMETRY_MIN_HIGH_CONFIDENCE_RATIO must be between 0 and 1");
  }
  return parsed;
}
