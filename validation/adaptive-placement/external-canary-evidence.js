import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchJson } from "../multicontainer/http-utils.js";

const DEFAULT_OUTPUT_DIR = "validation-artifacts/phase-3-external-canary";
const VALID_PHASES = new Set(["baseline", "canary", "rollback"]);

export async function collectExternalCanaryEvidence({
  phase,
  gateways,
  outputDir = DEFAULT_OUTPUT_DIR,
  environment = "unspecified",
  trafficWindow = "unspecified",
  workloads = [],
  canaryClientAllowlist = [],
  downstreamErrors = [],
  baselineDownstreamErrorRate,
  maxDownstreamErrorRateDelta = 0,
  writeArtifacts = true,
  now = () => new Date(),
} = {}) {
  const normalizedPhase = normalizePhase(phase);
  const gatewaySpecs = normalizeGatewaySpecs(gateways);
  const capturedAt = now();
  const runId = formatRunId(capturedAt);
  const resolvedOutputDir = resolve(outputDir, runId);
  const normalizedCanaryClientAllowlist = normalizeStringList(canaryClientAllowlist);
  const downstreamErrorEvidence = loadDownstreamErrorEvidence(downstreamErrors, normalizedPhase);
  const normalizedBaselineDownstreamErrorRate = normalizeOptionalNumber(
    baselineDownstreamErrorRate,
    "baselineDownstreamErrorRate",
  );
  const normalizedMaxDownstreamErrorRateDelta = normalizeOptionalNumber(
    maxDownstreamErrorRateDelta,
    "maxDownstreamErrorRateDelta",
  ) ?? 0;

  const gatewayReports = [];
  for (const gateway of gatewaySpecs) {
    const observability = await fetchJson(`${gateway.baseUrl}/observability`);
    const sessions = await fetchJson(`${gateway.baseUrl}/sessions`);
    gatewayReports.push({
      gatewayId: gateway.gatewayId,
      baseUrl: gateway.baseUrl,
      observability,
      sessions,
      assessment: assessGateway({
        phase: normalizedPhase,
        observability,
        sessions,
        canaryClientAllowlist: normalizedCanaryClientAllowlist,
      }),
    });
  }

  const report = {
    runId,
    phase: normalizedPhase,
    environment,
    trafficWindow,
    workloads,
    canaryClientAllowlist: normalizedCanaryClientAllowlist,
    baselineDownstreamErrorRate: normalizedBaselineDownstreamErrorRate,
    maxDownstreamErrorRateDelta: normalizedMaxDownstreamErrorRateDelta,
    generatedAt: capturedAt.toISOString(),
    outputDir: resolvedOutputDir,
    gateways: gatewayReports,
    downstreamErrors: downstreamErrorEvidence,
    summary: summarizeAssessments(
      gatewayReports,
      assessDownstreamErrors({
        phase: normalizedPhase,
        downstreamErrors: downstreamErrorEvidence,
        baselineDownstreamErrorRate: normalizedBaselineDownstreamErrorRate,
        maxDownstreamErrorRateDelta: normalizedMaxDownstreamErrorRateDelta,
      }),
    ),
  };

  if (writeArtifacts) {
    writeEvidenceArtifacts(report);
  }

  return report;
}

export function parseGatewaySpecs(raw) {
  if (Array.isArray(raw)) {
    return normalizeGatewaySpecs(raw);
  }

  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new TypeError("At least one gateway URL is required");
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [maybeId, maybeUrl] = entry.split("=");
      if (maybeUrl) {
        return { gatewayId: maybeId.trim(), baseUrl: trimSlash(maybeUrl.trim()) };
      }
      return { gatewayId: `gateway-${index + 1}`, baseUrl: trimSlash(maybeId.trim()) };
    });
}

export function buildReportMarkdown(report) {
  const fallbackSummary = aggregateFallbackSources(report.gateways);
  const lines = [
    "# Phase 3 External Canary Report",
    "",
    `Date: ${report.generatedAt}`,
    `Environment: ${report.environment}`,
    `Gateway count: ${report.gateways.length}`,
    `Canary client allowlist: ${report.canaryClientAllowlist?.length > 0 ? report.canaryClientAllowlist.join(", ") : "not captured"}`,
    `Traffic window: ${report.trafficWindow}`,
    `Workloads covered: ${report.workloads.length > 0 ? report.workloads.join(", ") : "unspecified"}`,
    `Phase captured: ${report.phase}`,
    `Baseline downstream error rate: ${formatRate(report.baselineDownstreamErrorRate)}`,
    `Allowed downstream error-rate delta: ${formatRate(report.maxDownstreamErrorRateDelta)}`,
    "",
    "## Gateway Evidence",
    "",
    "| Gateway | Adaptive enabled | Requests | Adaptive placements | Stateless | Sticky | Fallbacks | Mismatches | Errors | Assessment |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const gateway of report.gateways) {
    const summary = gateway.observability?.summary ?? {};
    const operatorConfig = gateway.observability?.operatorConfig ?? {};
    lines.push(
      `| ${gateway.gatewayId} | ${String(operatorConfig.adaptivePlacementEnabled ?? "unknown")} | ${summary.totalRequests ?? "n/a"} | ${summary.totalAdaptivePlacements ?? "n/a"} | ${summary.totalAdaptivePlacementStateless ?? "n/a"} | ${summary.totalAdaptivePlacementSticky ?? "n/a"} | ${summary.totalAdaptivePlacementFallbacks ?? "n/a"} | ${summary.totalAdaptivePlacementMismatches ?? "n/a"} | ${summary.totalErrors ?? "n/a"} | ${gateway.assessment.status} |`,
    );
  }

  lines.push(
    "",
    "## Downstream Error Evidence",
    "",
  );

  if (report.downstreamErrors?.length > 0) {
    lines.push(
      "| Source | Requests | Errors | Error rate | Evidence file |",
      "| --- | ---: | ---: | ---: | --- |",
    );
    for (const evidence of report.downstreamErrors) {
      lines.push(
        `| ${evidence.gatewayId} | ${evidence.totalRequests ?? "n/a"} | ${evidence.totalErrors ?? "n/a"} | ${formatRate(evidence.errorRate)} | ${evidence.artifactName} |`,
      );
    }
  } else {
    lines.push("- Not captured for this phase.");
  }

  lines.push(
    "",
    "## Fallback Sources",
    "",
    "- canary-not-allowed: " + (fallbackSummary["canary-not-allowed"] ?? 0),
    "- explicit: " + (fallbackSummary.explicit ?? 0),
    "- existing-session: " + (fallbackSummary["existing-session"] ?? 0),
    "- phase-2-default: " + (fallbackSummary["phase-2-default"] ?? 0),
    "- invalid-classifier-recommendation: " +
      (fallbackSummary["invalid-classifier-recommendation"] ?? 0),
    "- other: " + (fallbackSummary.other ?? 0),
    "",
    "## Decision",
    "",
    `Machine checks: ${report.summary.overallStatus === "pass" ? "PASS" : "REVIEW_REQUIRED"}`,
    "Result: MANUAL_DECISION_REQUIRED",
    "",
    "Reason:",
    report.summary.reasons.length > 0
      ? report.summary.reasons.map((reason) => `- ${reason}`).join("\n")
      : "- All captured machine-checkable criteria passed for the captured phase. Operator and reviewer approval are still required before closing the external rollout gate.",
    "",
    "Rollback performed: yes | no",
    "Rollback evidence file:",
    "",
    "Operator approval:",
    "Reviewer approval:",
  );

  return `${lines.join("\n")}\n`;
}

function assessGateway({ phase, observability, sessions, canaryClientAllowlist }) {
  const reasons = [];
  const summary = observability?.summary ?? {};
  const operatorConfig = observability?.operatorConfig ?? {};
  const events = observability?.recentEvents ?? [];

  if (phase === "baseline") {
    if (operatorConfig.adaptivePlacementEnabled !== false) {
      reasons.push("baseline requires adaptivePlacementEnabled=false");
    }
    if ((summary.totalAdaptivePlacements ?? 0) !== 0) {
      reasons.push("baseline observed adaptive placements");
    }
    if ((summary.totalAdaptivePlacementMismatches ?? 0) !== 0) {
      reasons.push("baseline observed adaptive placement mismatches");
    }
    if (events.some((event) => String(event.eventType ?? "").startsWith("adaptive.placement."))) {
      reasons.push("baseline recent events include adaptive placement events");
    }
  }

  if (phase === "canary") {
    if (operatorConfig.adaptivePlacementEnabled !== true) {
      reasons.push("canary requires adaptivePlacementEnabled=true");
    }
    if ((operatorConfig.adaptivePlacementClientAllowlistSize ?? 0) <= 0) {
      reasons.push("canary requires a non-empty adaptive placement allowlist");
    }
    if ((summary.totalAdaptivePlacements ?? 0) <= 0) {
      reasons.push("canary observed no adaptive placements");
    }
    if ((summary.totalAdaptivePlacementMismatches ?? 0) !== 0) {
      reasons.push("canary observed adaptive placement mismatches");
    }
    if (hasInvalidClassifierFallback(events)) {
      reasons.push("canary observed invalid-classifier fallback events");
    }
    if (hasNonAllowlistedAdaptiveClassifier(sessions, canaryClientAllowlist)) {
      reasons.push("sessions include adaptive-classifier metadata for a client outside the captured canary allowlist");
    }
  }

  if (phase === "rollback" && operatorConfig.adaptivePlacementEnabled !== false) {
    reasons.push("rollback requires adaptivePlacementEnabled=false");
  }

  return {
    status: reasons.length === 0 ? "pass" : "review_required",
    reasons,
  };
}

function hasInvalidClassifierFallback(events) {
  return events.some(
    (event) =>
      event.eventType === "adaptive.placement.fallback" &&
      event.runtimeModeSource === "invalid-classifier-recommendation",
  );
}

function hasNonAllowlistedAdaptiveClassifier(sessions, canaryClientAllowlist) {
  if (canaryClientAllowlist.length === 0) {
    return false;
  }
  const allowedClients = new Set(canaryClientAllowlist);
  return (sessions?.sessions ?? []).some((session) => {
    const metadata = session.metadata ?? {};
    const clientId = metadata.clientId ?? "";
    return (
      metadata.runtimeModeSource === "adaptive-classifier" &&
      typeof clientId === "string" &&
      !allowedClients.has(clientId)
    );
  });
}

function assessDownstreamErrors({
  phase,
  downstreamErrors,
  baselineDownstreamErrorRate,
  maxDownstreamErrorRateDelta,
}) {
  const reasons = [];

  if ((phase === "baseline" || phase === "canary") && downstreamErrors.length === 0) {
    reasons.push(`${phase} requires downstream error evidence`);
  }

  for (const evidence of downstreamErrors) {
    if (evidence.errorRate === undefined) {
      reasons.push(`${evidence.gatewayId}: downstream error evidence requires errorRate or request/error counts`);
      continue;
    }
    if (
      phase === "canary" &&
      baselineDownstreamErrorRate !== undefined &&
      evidence.errorRate > baselineDownstreamErrorRate + maxDownstreamErrorRateDelta
    ) {
      reasons.push(
        `${evidence.gatewayId}: downstream error rate ${formatRate(evidence.errorRate)} exceeds baseline ${formatRate(baselineDownstreamErrorRate)} plus delta ${formatRate(maxDownstreamErrorRateDelta)}`,
      );
    }
  }

  return {
    status: reasons.length === 0 ? "pass" : "review_required",
    reasons,
  };
}

function summarizeAssessments(gatewayReports, downstreamAssessment) {
  const reasons = gatewayReports.flatMap((gateway) =>
    gateway.assessment.reasons.map((reason) => `${gateway.gatewayId}: ${reason}`),
  );
  reasons.push(...downstreamAssessment.reasons.map((reason) => `downstream: ${reason}`));
  return {
    overallStatus: reasons.length === 0 ? "pass" : "review_required",
    reasons,
  };
}

function aggregateFallbackSources(gateways) {
  const counts = {};
  for (const gateway of gateways) {
    for (const event of gateway.observability?.recentEvents ?? []) {
      if (event.eventType !== "adaptive.placement.fallback") {
        continue;
      }
      const source = event.runtimeModeSource ?? "other";
      counts[source] = (counts[source] ?? 0) + 1;
    }
  }
  return counts;
}

function writeEvidenceArtifacts(report) {
  mkdirSync(report.outputDir, { recursive: true });

  for (const gateway of report.gateways) {
    writeJson(
      resolve(report.outputDir, `${gateway.gatewayId}-${report.phase}-observability.json`),
      gateway.observability,
    );
    writeJson(
      resolve(report.outputDir, `${gateway.gatewayId}-${report.phase}-sessions.json`),
      gateway.sessions,
    );
  }

  for (const evidence of report.downstreamErrors) {
    writeJson(resolve(report.outputDir, evidence.artifactName), evidence.payload);
  }

  writeJson(resolve(report.outputDir, `${report.phase}-evidence-summary.json`), report);
  writeFileSync(
    resolve(report.outputDir, "phase-3-external-canary-report.md"),
    buildReportMarkdown(report),
    "utf8",
  );
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeGatewaySpecs(gateways) {
  const specs = Array.isArray(gateways) ? gateways : parseGatewaySpecs(gateways);
  if (specs.length === 0) {
    throw new TypeError("At least one gateway URL is required");
  }
  return specs.map((gateway, index) => ({
    gatewayId: assertIdentifier(gateway.gatewayId || `gateway-${index + 1}`),
    baseUrl: trimSlash(assertNonEmptyString(gateway.baseUrl, "gateway baseUrl")),
  }));
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

function loadDownstreamErrorEvidence(raw, phase) {
  if (raw === undefined || raw === null || raw === "") {
    return [];
  }

  if (typeof raw === "string") {
    return parseDownstreamErrorSpecs(raw).map((spec, index) =>
      normalizeDownstreamErrorEvidence(
        {
          gatewayId: spec.gatewayId,
          sourcePath: spec.filePath,
          payload: JSON.parse(readFileSync(spec.filePath, "utf8")),
        },
        phase,
        index,
      ),
    );
  }

  if (!Array.isArray(raw)) {
    throw new TypeError("downstreamErrors must be a comma-separated file list or an array");
  }

  return raw.map((entry, index) => normalizeDownstreamErrorEvidence(entry, phase, index));
}

function parseDownstreamErrorSpecs(raw) {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex >= 0) {
        return {
          gatewayId: assertIdentifier(entry.slice(0, separatorIndex).trim()),
          filePath: assertNonEmptyString(entry.slice(separatorIndex + 1).trim(), "downstream error file path"),
        };
      }
      return {
        gatewayId: `errors-${index + 1}`,
        filePath: assertNonEmptyString(entry, "downstream error file path"),
      };
    });
}

function normalizeDownstreamErrorEvidence(entry, phase, index) {
  const payload = entry.payload ?? entry;
  const gatewayId = assertIdentifier(entry.gatewayId || payload.gatewayId || `errors-${index + 1}`);
  const totalRequests = firstNumber(payload, [
    "totalRequests",
    "requests",
    "requestCount",
    "downstreamRequests",
  ]);
  const totalErrors = firstNumber(payload, [
    "totalErrors",
    "errors",
    "errorCount",
    "downstreamErrors",
  ]);
  const explicitErrorRate = firstNumber(payload, [
    "errorRate",
    "downstreamErrorRate",
    "applicationErrorRate",
  ]);
  const computedErrorRate =
    explicitErrorRate ?? (totalRequests > 0 && totalErrors !== undefined ? totalErrors / totalRequests : undefined);

  return {
    gatewayId,
    sourcePath: entry.sourcePath,
    artifactName: `${gatewayId}-${phase}-errors.json`,
    totalRequests,
    totalErrors,
    errorRate: computedErrorRate,
    payload,
  };
}

function firstNumber(payload, keys) {
  for (const key of keys) {
    const value = normalizeOptionalNumber(payload?.[key], key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeOptionalNumber(value, name) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return numberValue;
}

function formatRate(value) {
  if (value === undefined || value === null) {
    return "not captured";
  }
  return Number(value).toFixed(6);
}

function normalizePhase(phase) {
  const normalized = assertNonEmptyString(phase, "phase");
  if (!VALID_PHASES.has(normalized)) {
    throw new TypeError(`phase must be one of: ${Array.from(VALID_PHASES).join(", ")}`);
  }
  return normalized;
}

function assertIdentifier(value) {
  const identifier = assertNonEmptyString(value, "gatewayId");
  if (!/^[a-zA-Z0-9._-]+$/.test(identifier)) {
    throw new TypeError("gatewayId may contain only letters, numbers, dots, underscores, and hyphens");
  }
  return identifier;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function formatRunId(date) {
  return date.toISOString().replaceAll(":", "").replaceAll(".", "-");
}
