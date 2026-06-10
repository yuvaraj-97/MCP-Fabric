import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const EXPECTED_FALLBACK_SOURCES = new Set([
  "canary-not-allowed",
  "explicit",
  "existing-session",
  "phase-2-default",
]);

const INVALID_CLASSIFIER_SOURCE = "invalid-classifier-recommendation";

export function createTelemetryQualitySummary({
  evidenceDir,
  reports = [],
  expectedFallbackSources = EXPECTED_FALLBACK_SOURCES,
  minHighConfidenceRatio,
} = {}) {
  const inputs = [];
  if (evidenceDir) {
    inputs.push(...loadEvidenceDirectory(evidenceDir));
  }
  inputs.push(...reports.map((report, index) => ({
    label: report.label ?? `report-${index + 1}`,
    report,
  })));

  const metrics = createEmptyMetrics();
  const reasons = [];
  const expectedSources = new Set(expectedFallbackSources);

  for (const input of inputs) {
    collectFromReport(metrics, input.report, input.label);
  }

  const finalizedMetrics = finalizeMetrics(metrics);

  for (const [source, count] of Object.entries(finalizedMetrics.fallbackReasons)) {
    if (!expectedSources.has(source)) {
      reasons.push(`unexpected fallback source ${source}: ${count}`);
    }
  }

  if (finalizedMetrics.totalAdaptivePlacementMismatches > 0) {
    reasons.push(`adaptive placement mismatches observed: ${finalizedMetrics.totalAdaptivePlacementMismatches}`);
  }

  if (finalizedMetrics.invalidClassifierFallbacks > 0) {
    reasons.push(`invalid-classifier fallback events observed: ${finalizedMetrics.invalidClassifierFallbacks}`);
  }

  if (finalizedMetrics.downstreamErrors.regressions.length > 0) {
    reasons.push(
      `downstream error regressions observed: ${finalizedMetrics.downstreamErrors.regressions.length}`,
    );
  }

  if (finalizedMetrics.memory.retainedHeapExceeded.length > 0) {
    reasons.push(`retained heap ceiling exceeded: ${finalizedMetrics.memory.retainedHeapExceeded.length}`);
  }

  if (
    typeof minHighConfidenceRatio === "number" &&
    finalizedMetrics.confidence.total > 0 &&
    finalizedMetrics.confidence.highRatio < minHighConfidenceRatio
  ) {
    reasons.push(
      `high-confidence recommendation ratio ${formatRatio(finalizedMetrics.confidence.highRatio)} below ${formatRatio(minHighConfidenceRatio)}`,
    );
  }

  if (inputs.length === 0) {
    reasons.push("no telemetry evidence inputs were provided");
  }

  return {
    ok: reasons.length === 0,
    status: reasons.length === 0 ? "pass" : "review_required",
    inputCount: inputs.length,
    inputs: inputs.map((input) => input.label),
    metrics: finalizedMetrics,
    reasons,
  };
}

export function loadTelemetryInputs(rawInputs = "") {
  return normalizeStringList(rawInputs).flatMap((inputPath) => {
    const resolvedPath = resolve(inputPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`telemetry input does not exist: ${resolvedPath}`);
    }

    if (statSync(resolvedPath).isDirectory()) {
      return loadEvidenceDirectory(resolvedPath);
    }

    return [{
      label: basename(resolvedPath),
      report: readJson(resolvedPath),
    }];
  });
}

function loadEvidenceDirectory(evidenceDir) {
  const resolvedEvidenceDir = resolve(evidenceDir);
  if (!existsSync(resolvedEvidenceDir) || !statSync(resolvedEvidenceDir).isDirectory()) {
    throw new Error(`evidence directory does not exist: ${resolvedEvidenceDir}`);
  }

  return readdirSync(resolvedEvidenceDir)
    .filter((fileName) => fileName.endsWith("-evidence-summary.json"))
    .sort()
    .map((fileName) => ({
      label: fileName,
      report: readJson(resolve(resolvedEvidenceDir, fileName)),
    }));
}

function collectFromReport(metrics, report, label) {
  if (!report || typeof report !== "object") {
    return;
  }

  metrics.sources.push(label);

  collectFromSummary(metrics, report.summary);
  collectFromChecks(metrics, report.checks);
  collectDownstreamErrors(metrics, report);
  collectMemory(metrics, report.memory, label);

  for (const gateway of report.gateways ?? []) {
    collectFromObservability(metrics, gateway.observability);
  }

  for (const gatewayKey of ["gateway", "gatewayA", "gatewayB"]) {
    collectFromObservability(metrics, report[gatewayKey]?.observability);
  }

  for (const workload of report.workloads ?? []) {
    collectFromWorkload(metrics, workload, { hasObservability: Boolean(workload.observability) });
    collectFromObservability(metrics, { summary: workload.observability });
    collectFromPlacement(metrics, workload.initialize?.adaptivePlacement);
    collectFromPlacement(metrics, workload.followUp?.adaptivePlacement);
    collectConfidence(metrics, workload.initialize?.confidence);
    collectConfidence(metrics, workload.followUp?.confidence);
  }

  if (!report.summary || typeof report.summary !== "object") {
    for (const run of report.runs ?? []) {
      collectFromSummary(metrics, run);
      for (const workload of run.workloads ?? []) {
        collectFromWorkload(metrics, workload, { hasObservability: Boolean(workload.observability) });
        collectFromObservability(metrics, { summary: workload.observability });
      }
    }
  } else {
    for (const run of report.runs ?? []) {
      for (const workload of run.workloads ?? []) {
        collectConfidence(metrics, workload.confidence);
      }
    }
  }

  collectFromMcp(metrics, report.mcp);
}

function collectFromSummary(metrics, summary = {}) {
  if (!summary || typeof summary !== "object") {
    return;
  }

  addMetric(metrics, "totalRequests", summary.totalRequests);
  addMetric(metrics, "totalAdaptivePlacements", summary.totalAdaptivePlacements ?? summary.adaptivePlacements);
  addMetric(metrics, "totalAdaptivePlacementDrifts", summary.totalAdaptivePlacementDrifts ?? summary.phase2Drifts);
  addMetric(metrics, "totalAdaptivePlacementFallbacks", summary.totalAdaptivePlacementFallbacks ?? summary.fallbacks);
  addMetric(metrics, "totalAdaptivePlacementMismatches", summary.totalAdaptivePlacementMismatches ?? summary.mismatches);
  addMetric(metrics, "totalReassignments", summary.totalReassignments);
  addMetric(metrics, "totalRuntimeRecommendations", summary.totalRuntimeRecommendations);

  if (typeof summary.highConfidenceRecommendations === "number") {
    metrics.confidence.high = (metrics.confidence.high ?? 0) + summary.highConfidenceRecommendations;
  }
}

function collectFromChecks(metrics, checks = {}) {
  if (!checks || typeof checks !== "object") {
    return;
  }

  if (checks.crossGatewayReuse === true || checks.adaptiveCrossGatewayMetadata === true) {
    metrics.crossGatewayMetadata.pass += 1;
  }
  if (checks.crossGatewayReuse === false || checks.adaptiveCrossGatewayMetadata === false) {
    metrics.crossGatewayMetadata.fail += 1;
  }
}

function collectFromObservability(metrics, observability = {}) {
  if (!observability || typeof observability !== "object") {
    return;
  }

  const summaryHasPlacementCounters =
    typeof observability.summary?.totalAdaptivePlacements === "number" ||
    typeof observability.summary?.totalAdaptivePlacementDrifts === "number" ||
    typeof observability.summary?.totalAdaptivePlacementMismatches === "number";

  collectFromSummary(metrics, observability.summary);

  for (const event of observability.recentEvents ?? []) {
    collectFromEvent(metrics, event, { countPlacementEvents: !summaryHasPlacementCounters });
  }
}

function collectFromEvent(metrics, event = {}, { countPlacementEvents = true } = {}) {
  if (!event || typeof event !== "object") {
    return;
  }

  collectConfidence(metrics, event.runtimeRecommendation?.confidence);

  if (event.eventType === "adaptive.placement.fallback") {
    const source = normalizeFallbackSource(event.runtimeModeSource);
    metrics.fallbackReasons[source] = (metrics.fallbackReasons[source] ?? 0) + 1;
    if (source === INVALID_CLASSIFIER_SOURCE) {
      metrics.invalidClassifierFallbacks += 1;
    }
  }

  if (event.eventType === "adaptive.placement.mismatch") {
    metrics.totalAdaptivePlacementMismatches += 1;
  }

  if (countPlacementEvents && event.eventType === "adaptive.placement.applied") {
    metrics.totalAdaptivePlacements += 1;
    if (event.driftFromPhase2Mode === true) {
      metrics.totalAdaptivePlacementDrifts += 1;
    }
  }
}

function collectFromWorkload(metrics, workload = {}, { hasObservability = false } = {}) {
  collectConfidence(metrics, workload.confidence);
  if (hasObservability) {
    return;
  }
  collectFromPlacement(metrics, {
    applied: workload.adaptivePlacementApplied,
    runtimeModeSource: workload.runtimeModeSource,
    driftFromPhase2Mode: workload.driftFromPhase2Mode,
  });
}

function collectFromMcp(metrics, mcp = {}) {
  if (!mcp || typeof mcp !== "object") {
    return;
  }

  collectFromGatewayResult(metrics, mcp.initialize);
}

function collectFromGatewayResult(metrics, result = {}) {
  collectConfidence(metrics, result?.runtimeRecommendation?.confidence);
  collectFromPlacement(metrics, result?.runtimeRecommendation?.adaptivePlacement);
}

function collectFromPlacement(metrics, placement = {}) {
  if (!placement || typeof placement !== "object") {
    return;
  }

  if (placement.applied === true) {
    metrics.totalAdaptivePlacements += 1;
  }
  if (placement.driftFromPhase2Mode === true) {
    metrics.totalAdaptivePlacementDrifts += 1;
  }
  if (typeof placement.runtimeModeSource === "string" && placement.runtimeModeSource !== "adaptive-classifier") {
    const source = normalizeFallbackSource(placement.runtimeModeSource);
    if (source === INVALID_CLASSIFIER_SOURCE) {
      metrics.invalidClassifierFallbacks += 1;
    }
  }
}

function collectConfidence(metrics, confidence) {
  if (typeof confidence !== "string" || confidence.length === 0) {
    return;
  }
  metrics.confidence[confidence] = (metrics.confidence[confidence] ?? 0) + 1;
}

function addMetric(metrics, key, value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    metrics[key] += value;
  }
}

function createEmptyMetrics() {
  return {
    sources: [],
    totalRequests: 0,
    totalRuntimeRecommendations: 0,
    totalAdaptivePlacements: 0,
    totalAdaptivePlacementDrifts: 0,
    totalAdaptivePlacementFallbacks: 0,
    totalAdaptivePlacementMismatches: 0,
    totalReassignments: 0,
    invalidClassifierFallbacks: 0,
    fallbackReasons: {},
    confidence: {},
    crossGatewayMetadata: {
      pass: 0,
      fail: 0,
    },
    downstreamErrors: {
      checked: 0,
      regressions: [],
    },
    memory: {
      checked: 0,
      retainedHeapExceeded: [],
    },
  };
}

function finalizeMetrics(metrics) {
  const recommendationCount = Object.values(metrics.confidence).reduce((total, count) => total + count, 0);
  const mismatchDenominator = metrics.totalRequests || metrics.totalRuntimeRecommendations || metrics.totalAdaptivePlacements;

  return {
    totalRequests: metrics.totalRequests,
    totalRuntimeRecommendations: metrics.totalRuntimeRecommendations,
    totalAdaptivePlacements: metrics.totalAdaptivePlacements,
    totalAdaptivePlacementDrifts: metrics.totalAdaptivePlacementDrifts,
    totalAdaptivePlacementFallbacks: metrics.totalAdaptivePlacementFallbacks,
    totalAdaptivePlacementMismatches: metrics.totalAdaptivePlacementMismatches,
    totalReassignments: metrics.totalReassignments,
    mismatchRate: ratio(metrics.totalAdaptivePlacementMismatches, mismatchDenominator),
    fallbackReasons: sortObject(metrics.fallbackReasons),
    invalidClassifierFallbacks: metrics.invalidClassifierFallbacks,
    confidence: {
      distribution: sortObject(metrics.confidence),
      total: recommendationCount,
      highRatio: ratio(metrics.confidence.high ?? 0, recommendationCount),
    },
    phase2DriftCount: metrics.totalAdaptivePlacementDrifts,
    crossGatewayMetadata: metrics.crossGatewayMetadata,
    downstreamErrors: metrics.downstreamErrors,
    memory: metrics.memory,
  };
}

function collectDownstreamErrors(metrics, report = {}) {
  const baseline = normalizeNumber(report.baselineDownstreamErrorRate);
  const maxDelta = normalizeNumber(report.maxDownstreamErrorRateDelta) ?? 0;
  if (baseline === undefined) {
    return;
  }

  for (const evidence of report.downstreamErrors ?? []) {
    const errorRate = normalizeNumber(evidence.errorRate);
    if (errorRate === undefined) {
      continue;
    }

    metrics.downstreamErrors.checked += 1;
    if (errorRate > baseline + maxDelta) {
      metrics.downstreamErrors.regressions.push({
        gatewayId: evidence.gatewayId ?? "unknown",
        errorRate,
        baseline,
        maxDelta,
      });
    }
  }
}

function collectMemory(metrics, memory = {}, label) {
  if (!memory || typeof memory !== "object") {
    return;
  }

  const retained = normalizeNumber(memory.retainedHeapGrowthBytes);
  const maxRetained = normalizeNumber(memory.maxRetainedHeapGrowthBytes);
  if (retained === undefined || maxRetained === undefined) {
    return;
  }

  metrics.memory.checked += 1;
  if (retained > maxRetained) {
    metrics.memory.retainedHeapExceeded.push({
      label,
      retainedHeapGrowthBytes: retained,
      maxRetainedHeapGrowthBytes: maxRetained,
    });
  }
}

function normalizeFallbackSource(source) {
  return typeof source === "string" && source.length > 0 ? source : "other";
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to parse telemetry JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function formatRatio(value) {
  return value.toFixed(6);
}
