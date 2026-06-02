import { createExternalCanaryPlan } from "./plan-external-canary.js";

const plan = createExternalCanaryPlan({
  gateways: process.env.MCP_PHASE3_CANARY_GATEWAYS,
  runId: process.env.MCP_PHASE3_CANARY_RUN_ID,
  outputDir: process.env.MCP_PHASE3_CANARY_OUTPUT_DIR,
  environment: process.env.MCP_PHASE3_CANARY_ENVIRONMENT ?? "unspecified",
  trafficWindow: process.env.MCP_PHASE3_CANARY_TRAFFIC_WINDOW ?? "unspecified",
  workloads: parseList(process.env.MCP_PHASE3_CANARY_WORKLOADS),
  canaryClientAllowlist: parseList(process.env.MCP_PHASE3_CANARY_CLIENT_ALLOWLIST),
  baselineDownstreamErrorRate: process.env.MCP_PHASE3_CANARY_BASELINE_DOWNSTREAM_ERROR_RATE,
  maxDownstreamErrorRateDelta: process.env.MCP_PHASE3_CANARY_MAX_DOWNSTREAM_ERROR_RATE_DELTA ?? 0,
});

console.log(JSON.stringify({
  runId: plan.runId,
  evidenceDir: plan.evidenceDir,
  gatewayIds: plan.gatewayIds,
  planFiles: [
    `${plan.evidenceDir}/phase-3-external-canary-plan.json`,
    `${plan.evidenceDir}/phase-3-external-canary-plan.md`,
  ],
}, null, 2));

function parseList(raw) {
  if (!raw) {
    return [];
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}
