import {
  createTelemetryQualitySummary,
  loadTelemetryInputs,
} from "./telemetry-summary.js";
import {
  DEFAULT_TELEMETRY_EVIDENCE_DIR,
  persistTelemetrySummary,
} from "./telemetry-evidence.js";

const reports = loadTelemetryInputs(process.env.MCP_PHASE4_TELEMETRY_INPUTS);
const summary = createTelemetryQualitySummary({
  evidenceDir: process.env.MCP_PHASE4_TELEMETRY_EVIDENCE_DIR,
  reports,
  minHighConfidenceRatio: readOptionalRatio(
    process.env.MCP_PHASE4_TELEMETRY_MIN_HIGH_CONFIDENCE_RATIO,
  ),
});

console.log(JSON.stringify(summary, null, 2));

if (persistEnabled()) {
  const { summaryPath } = persistTelemetrySummary({
    summary,
    baseDir: process.env.MCP_PHASE4_TELEMETRY_OUTPUT_DIR || DEFAULT_TELEMETRY_EVIDENCE_DIR,
    runId: process.env.MCP_PHASE4_TELEMETRY_RUN_ID,
  });
  // Keep stdout as pure summary JSON for downstream parsers; report the
  // durable evidence path on stderr.
  console.error(`telemetry evidence written to ${summaryPath}`);
}

if (!summary.ok) {
  process.exitCode = 1;
}

function persistEnabled() {
  const raw = process.env.MCP_PHASE4_TELEMETRY_PERSIST;
  if (raw === undefined || raw === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
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
