import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_PHASES = ["baseline", "canary", "rollback"];
const REQUIRED_GATEWAY_ARTIFACTS = {
  baseline: ["observability", "sessions"],
  canary: ["observability", "sessions"],
  rollback: ["observability", "sessions"],
};

export function verifyExternalCanaryEvidence({
  evidenceDir,
  gatewayIds = [],
  requireManualApproval = false,
} = {}) {
  const resolvedEvidenceDir = resolveRequiredDirectory(evidenceDir);
  const files = new Set(readdirSync(resolvedEvidenceDir));
  const normalizedGatewayIds = normalizeStringList(gatewayIds);
  const reasons = [];
  const phaseSummaries = {};

  for (const phase of REQUIRED_PHASES) {
    const summaryFile = `${phase}-evidence-summary.json`;
    if (!files.has(summaryFile)) {
      reasons.push(`missing ${summaryFile}`);
      continue;
    }

    const summary = readJson(resolve(resolvedEvidenceDir, summaryFile), summaryFile);
    phaseSummaries[phase] = summary;
    if (summary.phase !== phase) {
      reasons.push(`${summaryFile} has phase=${String(summary.phase)} instead of ${phase}`);
    }
    if (summary.summary?.overallStatus !== "pass") {
      reasons.push(`${summaryFile} machine checks are ${String(summary.summary?.overallStatus ?? "missing")}`);
    }
  }

  const gatewayIdsToCheck =
    normalizedGatewayIds.length > 0 ? normalizedGatewayIds : inferGatewayIds(phaseSummaries);
  if (gatewayIdsToCheck.length === 0) {
    reasons.push("no gateway IDs found; provide MCP_PHASE3_CANARY_VERIFY_GATEWAYS or include gateway summaries");
  }

  for (const phase of REQUIRED_PHASES) {
    for (const gatewayId of gatewayIdsToCheck) {
      for (const artifactType of REQUIRED_GATEWAY_ARTIFACTS[phase]) {
        const artifactName = `${gatewayId}-${phase}-${artifactType}.json`;
        if (!files.has(artifactName)) {
          reasons.push(`missing ${artifactName}`);
        }
      }
    }
  }

  requirePhaseErrors({ phase: "baseline", files, gatewayIds: gatewayIdsToCheck, reasons });
  requirePhaseErrors({ phase: "canary", files, gatewayIds: gatewayIdsToCheck, reasons });

  if (!files.has("phase-3-external-canary-report.md")) {
    reasons.push("missing phase-3-external-canary-report.md");
  } else if (requireManualApproval) {
    const reportMarkdown = readFileSync(
      resolve(resolvedEvidenceDir, "phase-3-external-canary-report.md"),
      "utf8",
    );
    if (!/^Result:\s*PASS\s*$/m.test(reportMarkdown)) {
      reasons.push("report does not record final Result: PASS");
    }
    if (!/^Operator approval:[^\S\r\n]*\S/m.test(reportMarkdown)) {
      reasons.push("report is missing operator approval");
    }
    if (!/^Reviewer approval:[^\S\r\n]*\S/m.test(reportMarkdown)) {
      reasons.push("report is missing reviewer approval");
    }
  }

  return {
    ok: reasons.length === 0,
    evidenceDir: resolvedEvidenceDir,
    gatewayIds: gatewayIdsToCheck,
    phases: REQUIRED_PHASES,
    reasons,
  };
}

function requirePhaseErrors({ phase, files, gatewayIds, reasons }) {
  for (const gatewayId of gatewayIds) {
    const artifactName = `${gatewayId}-${phase}-errors.json`;
    if (!files.has(artifactName)) {
      reasons.push(`missing ${artifactName}`);
    }
  }
}

function inferGatewayIds(phaseSummaries) {
  const gatewayIds = new Set();
  for (const summary of Object.values(phaseSummaries)) {
    for (const gateway of summary.gateways ?? []) {
      if (typeof gateway.gatewayId === "string" && gateway.gatewayId.length > 0) {
        gatewayIds.add(gateway.gatewayId);
      }
    }
  }
  return Array.from(gatewayIds).sort();
}

function resolveRequiredDirectory(evidenceDir) {
  if (typeof evidenceDir !== "string" || evidenceDir.trim().length === 0) {
    throw new TypeError("evidenceDir must be a non-empty string");
  }
  const resolvedEvidenceDir = resolve(evidenceDir);
  if (!existsSync(resolvedEvidenceDir)) {
    throw new Error(`evidence directory does not exist: ${resolvedEvidenceDir}`);
  }
  return resolvedEvidenceDir;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
