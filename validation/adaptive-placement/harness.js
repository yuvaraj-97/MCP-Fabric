import assert from "node:assert/strict";

import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";

const CANARY_CLIENT_ID = "adaptive-canary-client";
const CONTROL_CLIENT_ID = "adaptive-control-client";

const STATELESS_HINTS = {
  replaySafe: true,
  readOnly: true,
  externalState: true,
};

export async function runAdaptivePlacementValidation() {
  const controller = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: [CANARY_CLIENT_ID],
    },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const canary = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "adaptive-canary-session",
    params: {
      clientId: CANARY_CLIENT_ID,
      runtimeHints: STATELESS_HINTS,
    },
  });

  controller.upsertInstance({
    serverInstanceId: "server-a",
    load: 0.6,
    healthy: true,
    acceptingNewSessions: true,
  });
  controller.upsertInstance({
    serverInstanceId: "server-b",
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });

  const canaryFollowUp = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: canary.sessionId,
    params: {
      clientId: CANARY_CLIENT_ID,
      message: "canary follow-up can route statelessly",
      runtimeHints: STATELESS_HINTS,
    },
  });

  const control = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "adaptive-control-session",
    params: {
      clientId: CONTROL_CLIENT_ID,
      runtimeHints: STATELESS_HINTS,
    },
  });

  const explicit = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "adaptive-explicit-session",
    params: {
      clientId: CANARY_CLIENT_ID,
      runtimeMode: "sticky",
      runtimeHints: STATELESS_HINTS,
    },
  });

  const observability = controller.describeObservability();
  const report = {
    ok: true,
    canary: summarizePlacement(canary),
    canaryFollowUp: summarizePlacement(canaryFollowUp),
    control: summarizePlacement(control),
    explicit: summarizePlacement(explicit),
    observability: summarizeObservability(observability),
  };

  assertAdaptivePlacementReport(report);
  return report;
}

export function assertAdaptivePlacementReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.canary.runtimeMode, "stateless");
  assert.equal(report.canary.adaptivePlacement.applied, true);
  assert.equal(report.canary.adaptivePlacement.runtimeModeSource, "adaptive-classifier");
  assert.equal(report.canary.adaptivePlacement.driftFromPhase2Mode, true);
  assert.equal(report.canaryFollowUp.runtimeMode, "stateless");
  assert.equal(report.control.runtimeMode, "sticky");
  assert.equal(report.control.adaptivePlacement.applied, false);
  assert.equal(report.control.adaptivePlacement.runtimeModeSource, "canary-not-allowed");
  assert.equal(report.explicit.runtimeMode, "sticky");
  assert.equal(report.explicit.adaptivePlacement.applied, false);
  assert.equal(report.explicit.adaptivePlacement.runtimeModeSource, "explicit");
  assert.equal(report.observability.operatorConfig.adaptivePlacementEnabled, true);
  assert.equal(report.observability.operatorConfig.adaptivePlacementClientAllowlistSize, 1);
  assert.equal(report.observability.summary.totalAdaptivePlacements, 1);
  assert.equal(report.observability.summary.totalAdaptivePlacementStateless, 1);
  assert.equal(report.observability.summary.totalAdaptivePlacementSticky, 0);
  assert.equal(report.observability.summary.totalAdaptivePlacementFallbacks, 2);
  assert.equal(report.observability.summary.totalAdaptivePlacementMismatches, 0);
  assert.ok(
    report.observability.recentEvents.some(
      (event) =>
        event.eventType === "adaptive.placement.applied" &&
        event.clientId === CANARY_CLIENT_ID &&
        event.runtimeMode === "stateless",
    ),
  );
  assert.ok(
    report.observability.recentEvents.some(
      (event) =>
        event.eventType === "adaptive.placement.fallback" &&
        event.clientId === CONTROL_CLIENT_ID &&
        event.runtimeModeSource === "canary-not-allowed",
    ),
  );
}

function summarizePlacement(result) {
  return {
    sessionId: result.sessionId,
    serverInstanceId: result.serverInstanceId,
    runtimeMode: result.runtimeMode,
    reusedExistingSession: result.reusedExistingSession,
    adaptivePlacement: result.runtimeRecommendation.adaptivePlacement,
  };
}

function summarizeObservability(observability) {
  return {
    operatorConfig: observability.operatorConfig,
    summary: observability.summary,
    recentEvents: observability.recentEvents.map((event) => ({
      eventType: event.eventType,
      method: event.method,
      sessionId: event.sessionId,
      clientId: event.clientId,
      runtimeMode: event.runtimeMode,
      source: event.source,
      runtimeModeSource: event.runtimeModeSource,
    })),
  };
}
