import assert from "node:assert/strict";
import test from "node:test";

import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";

test("gateway controller keeps a session sticky and publishes route events without sockets", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1 },
      { serverInstanceId: "server-b", load: 0.2 },
    ],
  });

  const collector = createEventCollector();
  controller.attachEventStream("session-test", collector);

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-test",
    params: { clientId: "controller-test" },
  });

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: "session-test",
    params: { message: "sticky session" },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(echoed.serverInstanceId, "server-a");
  assert.equal(echoed.reusedExistingSession, true);

  const joined = collector.chunks.join("");
  assert.match(joined, /event: connected|event: session.ready|event: request.received|event: route.selected/);
  assert.match(joined, /sticky session/);
});

test("gateway controller reassigns the session when the original instance becomes unhealthy", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    params: { clientId: "failover-test" },
  });

  controller.upsertInstance({
    serverInstanceId: initialized.serverInstanceId,
    load: 0.9,
    healthy: false,
    acceptingNewSessions: false,
  });

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "reroute me" },
  });

  assert.equal(echoed.serverInstanceId, "server-b");
  assert.equal(echoed.reusedExistingSession, false);
});

function createEventCollector() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
    },
  };
}
