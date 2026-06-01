import assert from "node:assert/strict";
import test from "node:test";

import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";
import { RedisSessionRegistry } from "../../packages/gateway/session-registry/redis-session-registry.js";

test("two gateway controllers can share session affinity through a redis-backed registry", async () => {
  const client = createFakeRedisClient();
  const registryA = new RedisSessionRegistry({ client, key: "mcp:test:sessions" });
  const registryB = new RedisSessionRegistry({ client, key: "mcp:test:sessions" });
  const serverInstances = [{ serverInstanceId: "server-a", load: 0.1, healthy: true }];

  const firstGateway = createHttpSseGatewayController({
    serverInstances,
    sessionRegistry: registryA,
  });
  const secondGateway = createHttpSseGatewayController({
    serverInstances,
    sessionRegistry: registryB,
  });

  const initialized = await firstGateway.handleGatewayMessage({
    method: "initialize",
    sessionId: "shared-session",
    params: { clientId: "shared-client" },
  });

  const echoed = await secondGateway.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "across gateways" },
  });

  assert.equal(echoed.serverInstanceId, initialized.serverInstanceId);
  assert.equal(echoed.reusedExistingSession, true);
  assert.equal(echoed.recovery.action, "reconnected-from-registry");

  const observability = secondGateway.describeObservability();
  assert.equal(observability.summary.totalRequests, 1);
  assert.ok(
    observability.recentEvents.some(
      (event) =>
        event.eventType === "route.completed" &&
        event.sessionId === initialized.sessionId &&
        event.serverInstanceId === initialized.serverInstanceId,
    ),
  );
});

test("two gateway controllers preserve adaptive placement metadata through a shared registry", async () => {
  const client = createFakeRedisClient();
  const registryA = new RedisSessionRegistry({ client, key: "mcp:test:adaptive-sessions" });
  const registryB = new RedisSessionRegistry({ client, key: "mcp:test:adaptive-sessions" });
  const serverInstances = [
    { serverInstanceId: "server-a", load: 0.1, healthy: true },
    { serverInstanceId: "server-b", load: 0.2, healthy: true },
  ];

  const firstGateway = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: ["shared-adaptive-client"],
    },
    serverInstances,
    sessionRegistry: registryA,
  });
  const secondGateway = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: ["shared-adaptive-client"],
    },
    serverInstances,
    sessionRegistry: registryB,
  });

  const initialized = await firstGateway.handleGatewayMessage({
    method: "initialize",
    sessionId: "shared-adaptive-session",
    params: {
      clientId: "shared-adaptive-client",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(initialized.runtimeMode, "stateless");
  assert.equal(
    initialized.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    "adaptive-classifier",
  );
  assert.equal(
    (await registryA.get(initialized.sessionId)).metadata.runtimeModeSource,
    "adaptive-classifier",
  );

  secondGateway.upsertInstance({
    serverInstanceId: "server-a",
    load: 0.7,
    healthy: true,
    acceptingNewSessions: true,
  });
  secondGateway.upsertInstance({
    serverInstanceId: "server-b",
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });

  const echoed = await secondGateway.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: {
      clientId: "shared-adaptive-client",
      message: "across adaptive gateways",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(echoed.runtimeMode, "stateless");
  assert.equal(echoed.reusedExistingSession, false);
  assert.equal(echoed.recovery.action, "reassigned-and-rehydrated");
  assert.equal(
    echoed.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    "existing-session",
  );
  assert.equal(
    (await registryB.get(initialized.sessionId)).metadata.runtimeModeSource,
    "adaptive-classifier",
  );
  const observability = secondGateway.describeObservability();
  assert.equal(observability.summary.totalAdaptivePlacementFallbacks, 0);
  assert.equal(observability.summary.totalAdaptivePlacementMismatches, 0);
});

function createFakeRedisClient() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}
