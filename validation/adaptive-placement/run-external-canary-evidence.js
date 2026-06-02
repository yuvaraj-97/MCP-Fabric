import { collectExternalCanaryEvidence } from "./external-canary-evidence.js";

const report = await collectExternalCanaryEvidence({
  phase: process.env.MCP_PHASE3_CANARY_PHASE,
  gateways: process.env.MCP_PHASE3_CANARY_GATEWAYS,
  outputDir: process.env.MCP_PHASE3_CANARY_OUTPUT_DIR,
  environment: process.env.MCP_PHASE3_CANARY_ENVIRONMENT ?? "unspecified",
  trafficWindow: process.env.MCP_PHASE3_CANARY_TRAFFIC_WINDOW ?? "unspecified",
  workloads: parseList(process.env.MCP_PHASE3_CANARY_WORKLOADS),
  canaryClientAllowlist: parseList(process.env.MCP_PHASE3_CANARY_CLIENT_ALLOWLIST),
  downstreamErrors: process.env.MCP_PHASE3_CANARY_DOWNSTREAM_ERRORS,
  baselineDownstreamErrorRate: process.env.MCP_PHASE3_CANARY_BASELINE_DOWNSTREAM_ERROR_RATE,
  maxDownstreamErrorRateDelta: process.env.MCP_PHASE3_CANARY_MAX_DOWNSTREAM_ERROR_RATE_DELTA,
});

console.log("Phase 3 external canary evidence captured.");
console.log(JSON.stringify({
  runId: report.runId,
  phase: report.phase,
  outputDir: report.outputDir,
  gatewayCount: report.gateways.length,
  overallStatus: report.summary.overallStatus,
  reasons: report.summary.reasons,
}, null, 2));

function parseList(raw) {
  if (!raw) {
    return [];
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}
