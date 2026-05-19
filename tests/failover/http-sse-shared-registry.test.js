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
