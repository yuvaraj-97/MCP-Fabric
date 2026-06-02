import { verifyExternalCanaryEvidence } from "./verify-external-canary-evidence.js";

const report = verifyExternalCanaryEvidence({
  evidenceDir: process.env.MCP_PHASE3_CANARY_EVIDENCE_DIR,
  gatewayIds: parseList(process.env.MCP_PHASE3_CANARY_VERIFY_GATEWAYS),
  requireManualApproval: parseBoolean(process.env.MCP_PHASE3_CANARY_REQUIRE_MANUAL_APPROVAL),
});

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}

function parseList(raw) {
  if (!raw) {
    return [];
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseBoolean(raw) {
  return raw === "1" || raw === "true";
}
