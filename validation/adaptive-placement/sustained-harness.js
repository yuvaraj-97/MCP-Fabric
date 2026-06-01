import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createFilesystemValidationApplication } from "../../examples/shared/filesystem-validation-server.js";
import { createGitValidationApplication } from "../../examples/shared/git-validation-server.js";
import {
  createMemoryValidationApplication,
  createMemoryValidationStore,
} from "../../examples/shared/memory-validation-server.js";
import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";
import { createFilesystemValidationWorkspace } from "../filesystem/workspace.js";
import { createGitValidationWorkspace } from "../git/workspace.js";

const DEFAULT_ITERATIONS = 5;
const DEFAULT_DELAY_MS = 0;
const CLIENT_ID = "adaptive-sustained-client";
const STATELESS_HINTS = {
  replaySafe: true,
  readOnly: true,
  externalState: true,
};

export async function runAdaptivePlacementSustainedValidation({
  iterations = DEFAULT_ITERATIONS,
  delayMs = DEFAULT_DELAY_MS,
  thresholds = {},
  cleanup = true,
  onProgress,
} = {}) {
  assertNonNegativeInteger("delayMs", delayMs);
  assertPositiveInteger("iterations", iterations);

  const environment = createSustainedEnvironment();
  try {
    const runs = [];
    for (let index = 0; index < iterations; index += 1) {
      if (index > 0 && delayMs > 0) {
        await delay(delayMs);
      }

      const workloads = await Promise.all(
        environment.workloads.map((workload) => runWorkloadIteration(workload, index + 1)),
      );
      const run = summarizeRun(index + 1, workloads);
      runs.push(run);
      onProgress?.(run);
    }

    const summary = summarizeRuns(runs);
    const report = {
      ok: true,
      iterations,
      delayMs,
      thresholds: resolveThresholds(thresholds),
      summary,
      runs,
    };

    assertAdaptivePlacementSustainedReport(report);
    return report;
  } finally {
    if (cleanup) {
      environment.cleanup();
    }
  }
}

export function assertAdaptivePlacementSustainedReport(report) {
  const thresholds = resolveThresholds(report.thresholds);

  assert.equal(report.ok, true);
  assert.equal(report.summary.iterations, report.iterations);
  assert.equal(report.summary.workloadExecutions, report.iterations * 3);
  assert.equal(report.summary.adaptivePlacements, report.summary.workloadExecutions);
  assert.ok(
    report.summary.fallbacks <= thresholds.maxFallbacks,
    `fallbacks ${report.summary.fallbacks} exceeded ${thresholds.maxFallbacks}`,
  );
  assert.ok(
    report.summary.mismatches <= thresholds.maxMismatches,
    `mismatches ${report.summary.mismatches} exceeded ${thresholds.maxMismatches}`,
  );
  assert.ok(
    ratio(report.summary.highConfidenceRecommendations, report.summary.workloadExecutions) >=
      thresholds.minHighConfidenceRatio,
    "high-confidence recommendation ratio below threshold",
  );
  assert.ok(
    ratio(report.summary.statelessRecommendations, report.summary.workloadExecutions) >=
      thresholds.minStatelessRecommendationRatio,
    "stateless recommendation ratio below threshold",
  );
  assert.ok(
    ratio(report.summary.phase2Drifts, report.summary.workloadExecutions) >=
      thresholds.minDriftRatio,
    "Phase 2 drift ratio below threshold",
  );
  assert.ok(
    ratio(report.summary.dynamicReroutes, report.summary.workloadExecutions) >=
      thresholds.minDynamicRerouteRatio,
    "dynamic reroute ratio below threshold",
  );
}

function createSustainedEnvironment() {
  const cleanupTargets = [];

  const filesystemRoot = createFilesystemValidationWorkspace(
    `adaptive-sustained-filesystem-${randomUUID()}`,
  );
  cleanupTargets.push(filesystemRoot);
  const filesystemFile = join(filesystemRoot, "notes", "adaptive-sustained-read.txt");
  mkdirSync(dirname(filesystemFile), { recursive: true });
  writeFileSync(filesystemFile, "adaptive sustained filesystem telemetry works", "utf8");

  const gitRoot = createGitValidationWorkspace("adaptive-sustained-git");
  cleanupTargets.push(gitRoot);

  const memoryStore = createMemoryValidationStore();
  memoryStore.remember({
    namespace: "adaptive-sustained",
    key: "status",
    value: "adaptive sustained memory telemetry works",
  });

  const workloads = [
    createWorkload({
      name: "filesystem",
      serverInstancePrefix: "fs",
      createApplication: ({ serverInstanceId }) =>
        createFilesystemValidationApplication({
          rootDir: filesystemRoot,
          serverInstanceId,
        }),
      toolCall: {
        name: "fs_read_text",
        arguments: { path: "notes/adaptive-sustained-read.txt" },
      },
      verifyToolResult(result) {
        assert.equal(
          result.structuredContent.content,
          "adaptive sustained filesystem telemetry works",
        );
      },
    }),
    createWorkload({
      name: "git",
      serverInstancePrefix: "git",
      createApplication: ({ serverInstanceId }) =>
        createGitValidationApplication({
          rootDir: gitRoot,
          serverInstanceId,
        }),
      toolCall: {
        name: "git_read_file",
        arguments: { path: "README.md" },
      },
      verifyToolResult(result) {
        assert.match(result.structuredContent.content, /Git validation workspace/);
      },
    }),
    createWorkload({
      name: "memory",
      serverInstancePrefix: "mem",
      createApplication: ({ serverInstanceId }) =>
        createMemoryValidationApplication({
          store: memoryStore,
          serverInstanceId,
        }),
      toolCall: {
        name: "memory_recall",
        arguments: { namespace: "adaptive-sustained", key: "status" },
      },
      verifyToolResult(result) {
        assert.equal(
          result.structuredContent.value,
          "adaptive sustained memory telemetry works",
        );
      },
    }),
  ];

  return {
    workloads,
    cleanup() {
      for (const target of cleanupTargets) {
        rmSync(target, { recursive: true, force: true });
      }
    },
  };
}

function createWorkload({ name, serverInstancePrefix, createApplication, toolCall, verifyToolResult }) {
  const controller = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: [CLIENT_ID],
    },
    serverInstances: [
      { serverInstanceId: `${serverInstancePrefix}-a`, load: 0.1, healthy: true },
      { serverInstanceId: `${serverInstancePrefix}-b`, load: 0.2, healthy: true },
    ],
    createApplication,
  });

  return {
    name,
    serverInstancePrefix,
    controller,
    toolCall,
    verifyToolResult,
  };
}

async function runWorkloadIteration(workload, iteration) {
  workload.controller.upsertInstance({
    serverInstanceId: `${workload.serverInstancePrefix}-a`,
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });
  workload.controller.upsertInstance({
    serverInstanceId: `${workload.serverInstancePrefix}-b`,
    load: 0.2,
    healthy: true,
    acceptingNewSessions: true,
  });

  const initialized = await workload.controller.handleGatewayMessage({
    method: "initialize",
    sessionId: `adaptive-sustained-${workload.name}-${iteration}`,
    params: {
      clientId: CLIENT_ID,
      runtimeHints: STATELESS_HINTS,
    },
  });

  workload.controller.upsertInstance({
    serverInstanceId: `${workload.serverInstancePrefix}-a`,
    load: 0.6,
    healthy: true,
    acceptingNewSessions: true,
  });
  workload.controller.upsertInstance({
    serverInstanceId: `${workload.serverInstancePrefix}-b`,
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });

  const followUp = await workload.controller.handleGatewayMessage({
    method: "tools/call",
    sessionId: initialized.sessionId,
    params: {
      clientId: CLIENT_ID,
      runtimeHints: STATELESS_HINTS,
      ...workload.toolCall,
    },
  });
  workload.verifyToolResult(followUp.result);

  return {
    workload: workload.name,
    recommendedMode: initialized.runtimeRecommendation.recommendedMode,
    confidence: initialized.runtimeRecommendation.confidence,
    driftFromPhase2Mode:
      initialized.runtimeRecommendation.adaptivePlacement.driftFromPhase2Mode,
    runtimeModeSource:
      initialized.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    adaptivePlacementApplied:
      initialized.runtimeRecommendation.adaptivePlacement.applied,
    initializeServerInstanceId: initialized.serverInstanceId,
    followUpServerInstanceId: followUp.serverInstanceId,
    observability: summarizeObservability(workload.controller.describeObservability()),
  };
}

function summarizeRun(iteration, workloads) {
  return {
    iteration,
    workloadCount: workloads.length,
    adaptivePlacements: workloads.reduce(
      (count, workload) => count + workload.observability.totalAdaptivePlacements,
      0,
    ),
    fallbacks: workloads.reduce(
      (count, workload) => count + workload.observability.totalAdaptivePlacementFallbacks,
      0,
    ),
    mismatches: workloads.reduce(
      (count, workload) => count + workload.observability.totalAdaptivePlacementMismatches,
      0,
    ),
    workloads,
  };
}

function summarizeRuns(runs) {
  return runs.reduce(
    (current, run) => ({
      iterations: current.iterations + 1,
      workloadExecutions: current.workloadExecutions + run.workloadCount,
      adaptivePlacements:
        current.adaptivePlacements +
        run.workloads.filter((workload) => workload.adaptivePlacementApplied).length,
      fallbacks: run.fallbacks,
      mismatches: run.mismatches,
      highConfidenceRecommendations:
        current.highConfidenceRecommendations +
        run.workloads.filter((workload) => workload.confidence === "high").length,
      statelessRecommendations:
        current.statelessRecommendations +
        run.workloads.filter((workload) => workload.recommendedMode === "stateless").length,
      phase2Drifts:
        current.phase2Drifts +
        run.workloads.filter((workload) => workload.driftFromPhase2Mode).length,
      dynamicReroutes:
        current.dynamicReroutes +
        run.workloads.filter(
          (workload) =>
            workload.initializeServerInstanceId !== workload.followUpServerInstanceId,
        ).length,
    }),
    {
      iterations: 0,
      workloadExecutions: 0,
      adaptivePlacements: 0,
      fallbacks: 0,
      mismatches: 0,
      highConfidenceRecommendations: 0,
      statelessRecommendations: 0,
      phase2Drifts: 0,
      dynamicReroutes: 0,
    },
  );
}

function summarizeObservability(observability) {
  return {
    totalAdaptivePlacements: observability.summary.totalAdaptivePlacements,
    totalAdaptivePlacementFallbacks: observability.summary.totalAdaptivePlacementFallbacks,
    totalAdaptivePlacementMismatches: observability.summary.totalAdaptivePlacementMismatches,
  };
}

function resolveThresholds(thresholds = {}) {
  return {
    maxFallbacks: thresholds.maxFallbacks ?? 0,
    maxMismatches: thresholds.maxMismatches ?? 0,
    minHighConfidenceRatio: thresholds.minHighConfidenceRatio ?? 1,
    minStatelessRecommendationRatio: thresholds.minStatelessRecommendationRatio ?? 1,
    minDriftRatio: thresholds.minDriftRatio ?? 1,
    minDynamicRerouteRatio: thresholds.minDynamicRerouteRatio ?? 1,
  };
}

function ratio(count, total) {
  return total === 0 ? 0 : count / total;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}
