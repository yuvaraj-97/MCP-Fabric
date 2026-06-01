import test from "node:test";
import assert from "node:assert/strict";

import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";

test("canary: adaptive placement with quality thresholds", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: ["canary-client"],
    },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.8, healthy: true },
    ],
  });

  const sessions = [];

  for (let i = 0; i < 5; i++) {
    const result = await controller.handleGatewayMessage({
      method: "initialize",
      sessionId: "session-canary-" + i,
      params: {
        clientId: "canary-client",
        runtimeHints: {
          replaySafe: true,
          readOnly: true,
          externalState: true,
        },
      },
    });
    sessions.push(result);
  }

  for (let i = 0; i < 3; i++) {
    const result = await controller.handleGatewayMessage({
      method: "initialize",
      sessionId: "session-non-canary-" + i,
      params: {
        clientId: "other-client",
        runtimeHints: {
          replaySafe: true,
          readOnly: true,
          externalState: true,
        },
      },
    });
    sessions.push(result);
  }

  const obs = controller.describeObservability();

  // Threshold 1: At least 1 adaptive placement applied
  assert(
    obs.summary.totalAdaptivePlacements >= 1,
    "threshold: totalAdaptivePlacements >= 1, got " + obs.summary.totalAdaptivePlacements
  );

  // Threshold 2: Mismatch counter remains at 0 (no quality issues)
  assert.equal(
    obs.summary.totalAdaptivePlacementMismatches,
    0,
    "threshold: mismatch counter should be 0, got " + obs.summary.totalAdaptivePlacementMismatches
  );

  // Threshold 3: Fallback ratio acceptable
  const totalRequests = sessions.length;
  const fallbackCount = obs.summary.totalAdaptivePlacementFallbacks;
  const fallbackRatio = fallbackCount / totalRequests;
  assert(
    fallbackRatio <= 0.5,
    "threshold: fallback ratio <= 0.5, got " + fallbackRatio + " (" + fallbackCount + "/" + totalRequests + ")"
  );

  // Threshold 4: Success ratio
  const successCount = obs.summary.totalAdaptivePlacementStateless + obs.summary.totalAdaptivePlacementSticky;
  assert(
    successCount >= 1,
    "threshold: at least 1 successful adaptive placement, got " + successCount
  );
});

test("canary: non-allowlisted clients use Phase 2 fallback", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: ["canary-client"],
    },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.8, healthy: true },
    ],
  });

  const result = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-not-in-canary",
    params: {
      clientId: "production-client",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(
    result.runtimeMode,
    "sticky",
    "non-canary clients should default to sticky"
  );
  assert.equal(
    result.runtimeRecommendation.adaptivePlacement.applied,
    false,
    "non-canary clients should not apply adaptive placement"
  );
  assert.equal(
    result.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    "canary-not-allowed",
    "source should indicate canary exclusion"
  );
});

test("canary: rollback disables adaptive placement", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: ["canary-client"],
    },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.8, healthy: true },
    ],
  });

  controller.setAdaptivePlacementEnabled(false);

  const result = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-after-rollback",
    params: {
      clientId: "canary-client",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(
    result.runtimeMode,
    "sticky",
    "after rollback, should use Phase 2 default"
  );
  assert.equal(
    result.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    "phase-2-default",
    "source should indicate Phase 2 default"
  );

  const obs = controller.describeObservability();
  assert.equal(
    obs.operatorConfig.adaptivePlacementEnabled,
    false,
    "observability should report adaptive placement disabled"
  );
});