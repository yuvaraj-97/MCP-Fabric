import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_OUTPUT_DIR = "validation-artifacts/phase-3-external-canary";
const PHASES = ["baseline", "canary", "rollback"];

export function createExternalCanaryPlan({
  gateways,
  runId,
  outputDir = DEFAULT_OUTPUT_DIR,
  environment = "unspecified",
  trafficWindow = "unspecified",
  workloads = [],
  canaryClientAllowlist = [],
  baselineDownstreamErrorRate,
  maxDownstreamErrorRateDelta = 0,
  writePlan = true,
} = {}) {
  const gatewaySpecs = parseGatewaySpecs(gateways);
  const normalizedRunId = normalizeIdentifier(runId ?? defaultRunId(new Date()), "runId");
  const normalizedOutputDir = resolve(outputDir);
  const evidenceDir = resolve(normalizedOutputDir, normalizedRunId);
  const normalizedWorkloads = normalizeStringList(workloads);
  const normalizedCanaryClientAllowlist = normalizeStringList(canaryClientAllowlist);

  const plan = {
    runId: normalizedRunId,
    outputDir: normalizedOutputDir,
    evidenceDir,
    environment,
    trafficWindow,
    workloads: normalizedWorkloads,
    canaryClientAllowlist: normalizedCanaryClientAllowlist,
    gatewayIds: gatewaySpecs.map((gateway) => gateway.gatewayId),
    gateways: gatewaySpecs,
    phases: PHASES.map((phase) => ({
      phase,
      downstreamErrors: gatewaySpecs.map((gateway) => ({
        gatewayId: gateway.gatewayId,
        expectedPath: `${gateway.gatewayId}-${phase}-source-errors.json`,
      })),
      command: buildEvidenceCommand({
        phase,
        runId: normalizedRunId,
        gatewaySpecs,
        outputDir: normalizedOutputDir,
        environment,
        trafficWindow,
        workloads: normalizedWorkloads,
        canaryClientAllowlist: normalizedCanaryClientAllowlist,
        baselineDownstreamErrorRate,
        maxDownstreamErrorRateDelta,
      }),
    })),
    verifyCommand: buildVerifyCommand({
      evidenceDir,
      gatewayIds: gatewaySpecs.map((gateway) => gateway.gatewayId),
      requireManualApproval: false,
    }),
    finalApprovalVerifyCommand: buildVerifyCommand({
      evidenceDir,
      gatewayIds: gatewaySpecs.map((gateway) => gateway.gatewayId),
      requireManualApproval: true,
    }),
  };

  if (writePlan) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, "phase-3-external-canary-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    writeFileSync(resolve(evidenceDir, "phase-3-external-canary-plan.md"), buildPlanMarkdown(plan), "utf8");
  }

  return plan;
}

export function buildPlanMarkdown(plan) {
  const lines = [
    "# Phase 3 External Canary Plan",
    "",
    `Run ID: ${plan.runId}`,
    `Environment: ${plan.environment}`,
    `Traffic window: ${plan.trafficWindow}`,
    `Evidence directory: ${plan.evidenceDir}`,
    `Gateways: ${plan.gatewayIds.join(", ")}`,
    `Workloads: ${plan.workloads.length > 0 ? plan.workloads.join(", ") : "unspecified"}`,
    "",
    "## Phase Commands",
    "",
  ];

  for (const phase of plan.phases) {
    lines.push(`### ${phase.phase}`, "", "```sh", phase.command, "```", "");
  }

  lines.push(
    "## Verify",
    "",
    "```sh",
    plan.verifyCommand,
    "```",
    "",
    "## Verify Final Approval",
    "",
    "```sh",
    plan.finalApprovalVerifyCommand,
    "```",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function buildEvidenceCommand({
  phase,
  runId,
  gatewaySpecs,
  outputDir,
  environment,
  trafficWindow,
  workloads,
  canaryClientAllowlist,
  baselineDownstreamErrorRate,
  maxDownstreamErrorRateDelta,
}) {
  return [
    `MCP_PHASE3_CANARY_PHASE=${shellValue(phase)} \\`,
    `MCP_PHASE3_CANARY_RUN_ID=${shellValue(runId)} \\`,
    `MCP_PHASE3_CANARY_GATEWAYS=${shellValue(formatGatewaySpecs(gatewaySpecs))} \\`,
    `MCP_PHASE3_CANARY_OUTPUT_DIR=${shellValue(outputDir)} \\`,
    `MCP_PHASE3_CANARY_ENVIRONMENT=${shellValue(environment)} \\`,
    `MCP_PHASE3_CANARY_TRAFFIC_WINDOW=${shellValue(trafficWindow)} \\`,
    `MCP_PHASE3_CANARY_WORKLOADS=${shellValue(workloads.join(","))} \\`,
    `MCP_PHASE3_CANARY_CLIENT_ALLOWLIST=${shellValue(canaryClientAllowlist.join(","))} \\`,
    `MCP_PHASE3_CANARY_DOWNSTREAM_ERRORS=${shellValue(formatDownstreamErrorSpecs(gatewaySpecs, phase))} \\`,
    `MCP_PHASE3_CANARY_BASELINE_DOWNSTREAM_ERROR_RATE=${shellValue(baselineDownstreamErrorRate ?? "")} \\`,
    `MCP_PHASE3_CANARY_MAX_DOWNSTREAM_ERROR_RATE_DELTA=${shellValue(maxDownstreamErrorRateDelta)} \\`,
    "npm run validate:adaptive-placement:external-canary:evidence",
  ].join("\n");
}

function buildVerifyCommand({ evidenceDir, gatewayIds, requireManualApproval }) {
  const lines = [
    `MCP_PHASE3_CANARY_EVIDENCE_DIR=${shellValue(evidenceDir)} \\`,
    `MCP_PHASE3_CANARY_VERIFY_GATEWAYS=${shellValue(gatewayIds.join(","))} \\`,
  ];
  if (requireManualApproval) {
    lines.push("MCP_PHASE3_CANARY_REQUIRE_MANUAL_APPROVAL=true \\");
  }
  lines.push("npm run validate:adaptive-placement:external-canary:verify");
  return lines.join("\n");
}

function formatGatewaySpecs(gatewaySpecs) {
  return gatewaySpecs.map((gateway) => `${gateway.gatewayId}=${gateway.baseUrl}`).join(",");
}

function formatDownstreamErrorSpecs(gatewaySpecs, phase) {
  return gatewaySpecs
    .map((gateway) => `${gateway.gatewayId}=./${gateway.gatewayId}-${phase}-source-errors.json`)
    .join(",");
}

function parseGatewaySpecs(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new TypeError("gateways must be a comma-separated gateway-id=url list");
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex < 0) {
        throw new TypeError("each gateway must use gateway-id=url format");
      }
      return {
        gatewayId: normalizeIdentifier(entry.slice(0, separatorIndex).trim(), "gatewayId"),
        baseUrl: assertNonEmptyString(entry.slice(separatorIndex + 1).trim(), "gateway URL").replace(/\/+$/, ""),
      };
    });
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeIdentifier(value, name) {
  const identifier = assertNonEmptyString(value, name);
  if (!/^[a-zA-Z0-9._-]+$/.test(identifier)) {
    throw new TypeError(`${name} may contain only letters, numbers, dots, underscores, and hyphens`);
  }
  return identifier;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function shellValue(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function defaultRunId(date) {
  return date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "-");
}
