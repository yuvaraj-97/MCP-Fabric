import assert from "node:assert/strict";
import test from "node:test";

import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
} from "../../packages/transports/http-sse/gateway-server.js";
import {
  invokeHttpHandler,
  parseJsonBody,
} from "../helpers/http-handler-harness.js";

test("HTTP/SSE gateway surfaces Redis registry outage as a handled JSON error", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionRegistry: createOutageRegistry(),
  });
  const handler = createGatewayHttpHandler({ controller });

  const response = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/message",
    headers: { host: "127.0.0.1:3000" },
    body: {
      method: "initialize",
      params: { clientId: "redis-outage-test" },
    },
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(parseJsonBody(response), {
    error: "Redis session registry is unavailable",
    code: "redis-registry-unavailable",
  });

  const observability = controller.describeObservability();
  assert.equal(observability.summary.totalErrors, 1);
  assert.ok(
    observability.recentEvents.some(
      (event) =>
        event.eventType === "request.failed" &&
        event.code === "redis-registry-unavailable" &&
        event.message === "Redis session registry is unavailable",
    ),
  );
});

function createOutageRegistry() {
  return {
    storageKind() {
      return "redis";
    },
    isDurable() {
      return true;
    },
    redisKey() {
      return "mcp:test:sessions";
    },
    async pruneExpired() {
      throw createRedisOutageError();
    },
    async get() {
      throw createRedisOutageError();
    },
    async assign() {
      throw createRedisOutageError();
    },
    async list() {
      throw createRedisOutageError();
    },
    async delete() {
      throw createRedisOutageError();
    },
    async deleteByServer() {
      throw createRedisOutageError();
    },
  };
}

function createRedisOutageError() {
  const error = new Error("Redis session registry is unavailable");
  error.code = "redis-registry-unavailable";
  error.statusCode = 503;
  return error;
}
