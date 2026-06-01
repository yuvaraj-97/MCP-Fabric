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

const CLIENT_ID = "adaptive-real-workload-client";
const STATELESS_HINTS = {
  replaySafe: true,
  readOnly: true,
  // The validation harness backs each workload with shared local state visible
  // to both in-process server instances. Production deployments must only set
  // this for filesystem/git/memory workloads when their state is truly shared
  // outside one runtime, such as a network volume, remote API, or central store.
  externalState: true,
};

export async function runAdaptivePlacementRealWorkloadValidation({ cleanup = false } = {}) {
  const cleanupTargets = [];
  try {
    const filesystemRoot = createFilesystemValidationWorkspace(
      `adaptive-filesystem-${randomUUID()}`,
    );
    cleanupTargets.push(filesystemRoot);
    const filesystemFile = join(filesystemRoot, "notes", "adaptive-read.txt");
    mkdirSync(dirname(filesystemFile), { recursive: true });
    writeFileSync(filesystemFile, "adaptive filesystem telemetry works", "utf8");

    const gitRoot = createGitValidationWorkspace("adaptive-git");
    cleanupTargets.push(gitRoot);

    const memoryStore = createMemoryValidationStore();
    memoryStore.remember({
      namespace: "adaptive",
      key: "status",
      value: "adaptive memory telemetry works",
    });

    const workloads = [
      await runWorkload({
        workload: "filesystem",
        serverInstancePrefix: "fs",
        createApplication: ({ serverInstanceId }) =>
          createFilesystemValidationApplication({
            rootDir: filesystemRoot,
            serverInstanceId,
          }),
        toolCall: {
          name: "fs_read_text",
          arguments: { path: "notes/adaptive-read.txt" },
        },
        verifyToolResult(result) {
          assert.equal(result.structuredContent.content, "adaptive filesystem telemetry works");
        },
      }),
      await runWorkload({
        workload: "git",
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
      await runWorkload({
        workload: "memory",
        serverInstancePrefix: "mem",
        createApplication: ({ serverInstanceId }) =>
          createMemoryValidationApplication({
            store: memoryStore,
            serverInstanceId,
          }),
        toolCall: {
          name: "memory_recall",
          arguments: { namespace: "adaptive", key: "status" },
        },
        verifyToolResult(result) {
          assert.equal(result.structuredContent.value, "adaptive memory telemetry works");
        },
      }),
    ];

    const report = {
      ok: true,
      workloads,
      summary: {
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
      },
    };

    assertAdaptivePlacementRealWorkloadReport(report);
    return report;
  } finally {
    if (cleanup) {
      for (const target of cleanupTargets) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  }
}

export function assertAdaptivePlacementRealWorkloadReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.summary.workloadCount, 3);
  assert.equal(report.summary.adaptivePlacements, 3);
  assert.equal(report.summary.fallbacks, 0);
  assert.equal(report.summary.mismatches, 0);

  for (const workload of report.workloads) {
    assert.equal(workload.initialize.serverInstanceId, `${workload.serverInstancePrefix}-a`);
    assert.equal(workload.followUp.serverInstanceId, `${workload.serverInstancePrefix}-b`);
    assert.notEqual(workload.initialize.serverInstanceId, workload.followUp.serverInstanceId);
    assert.equal(workload.initialize.runtimeMode, "stateless");
    assert.equal(workload.initialize.recommendedMode, "stateless");
    assert.equal(workload.initialize.confidence, "high");
    assert.equal(workload.initialize.adaptivePlacement.applied, true);
    assert.equal(
      workload.initialize.adaptivePlacement.runtimeModeSource,
      "adaptive-classifier",
    );
    assert.equal(workload.initialize.adaptivePlacement.driftFromPhase2Mode, true);
    assert.equal(workload.followUp.runtimeMode, "stateless");
    assert.equal(workload.followUp.adaptivePlacement.runtimeModeSource, "existing-session");
    assert.equal(workload.observability.totalAdaptivePlacements, 1);
    assert.equal(workload.observability.totalAdaptivePlacementDrifts, 1);
    assert.equal(workload.observability.totalAdaptivePlacementStateless, 1);
    assert.equal(workload.observability.totalAdaptivePlacementFallbacks, 0);
    assert.equal(workload.observability.totalAdaptivePlacementMismatches, 0);
  }
}

async function runWorkload({
  workload,
  serverInstancePrefix,
  createApplication,
  toolCall,
  verifyToolResult,
}) {
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

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: `adaptive-${workload}-session`,
    params: {
      clientId: CLIENT_ID,
      runtimeHints: STATELESS_HINTS,
    },
  });

  controller.upsertInstance({
    serverInstanceId: `${serverInstancePrefix}-a`,
    load: 0.6,
    healthy: true,
    acceptingNewSessions: true,
  });
  controller.upsertInstance({
    serverInstanceId: `${serverInstancePrefix}-b`,
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });

  const followUp = await controller.handleGatewayMessage({
    method: "tools/call",
    sessionId: initialized.sessionId,
    params: {
      clientId: CLIENT_ID,
      runtimeHints: STATELESS_HINTS,
      ...toolCall,
    },
  });
  verifyToolResult(followUp.result);

  return {
    workload,
    serverInstancePrefix,
    initialize: summarizeGatewayResult(initialized),
    followUp: summarizeGatewayResult(followUp),
    observability: summarizeObservability(controller.describeObservability()),
  };
}

function summarizeGatewayResult(result) {
  return {
    sessionId: result.sessionId,
    serverInstanceId: result.serverInstanceId,
    runtimeMode: result.runtimeMode,
    reusedExistingSession: result.reusedExistingSession,
    recommendedMode: result.runtimeRecommendation.recommendedMode,
    confidence: result.runtimeRecommendation.confidence,
    adaptivePlacement: result.runtimeRecommendation.adaptivePlacement,
  };
}

function summarizeObservability(observability) {
  return {
    totalRequests: observability.summary.totalRequests,
    totalRuntimeRecommendations: observability.summary.totalRuntimeRecommendations,
    totalAdaptivePlacements: observability.summary.totalAdaptivePlacements,
    totalAdaptivePlacementDrifts: observability.summary.totalAdaptivePlacementDrifts,
    totalAdaptivePlacementStateless: observability.summary.totalAdaptivePlacementStateless,
    totalAdaptivePlacementSticky: observability.summary.totalAdaptivePlacementSticky,
    totalAdaptivePlacementFallbacks: observability.summary.totalAdaptivePlacementFallbacks,
    totalAdaptivePlacementMismatches: observability.summary.totalAdaptivePlacementMismatches,
  };
}
