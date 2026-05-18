import assert from "node:assert/strict";
import test from "node:test";

import { createDashboardHandler } from "../../apps/local-dashboard/server.js";
import { LocalDemoController } from "../../packages/gateway/demo/local-demo-controller.js";

test("local demo controller keeps existing sessions sticky and reassigns unhealthy ones", () => {
  const controller = new LocalDemoController();

  const created = controller.createSession("session-1");
  const firstServer = created.decision.serverInstanceId;

  const reused = controller.routeSession("session-1");
  assert.equal(reused.decision.serverInstanceId, firstServer);
  assert.equal(reused.decision.reusedExistingSession, true);

  controller.updateInstance(firstServer, { healthy: false, load: 0.9 });
  const reassigned = controller.routeSession("session-1");

  assert.notEqual(reassigned.decision.serverInstanceId, firstServer);
  assert.equal(reassigned.decision.reusedExistingSession, false);
});

test("local demo controller skips overloaded instances for new sessions", () => {
  const controller = new LocalDemoController();

  controller.updateInstance("server-a", { load: 0.95 });
  controller.updateInstance("server-b", { load: 0.91 });
  controller.updateInstance("server-c", { load: 0.3 });

  const created = controller.createSession("session-overload-check");

  assert.equal(created.decision.serverInstanceId, "server-c");
});

test("dashboard handler serves the UI shell and live state", async () => {
  const handler = createDashboardHandler();

  const htmlResponse = await invokeHandler(handler, {
    method: "GET",
    url: "/",
  });
  assert.equal(htmlResponse.statusCode, 200);
  assert.match(htmlResponse.body, /Primary local demo/);
  assert.match(htmlResponse.body, /Reusable core plus local MCP scaling demo/);
  assert.match(
    htmlResponse.body,
    /What was added, why it matters, and how tests prove both the core and gateway behavior/,
  );

  const stateResponse = await invokeHandler(handler, {
    method: "GET",
    url: "/api/state",
  });
  assert.equal(stateResponse.statusCode, 200);
  const state = JSON.parse(stateResponse.body);
  assert.equal(state.dashboard.title, "MCP Scaling Demo Dashboard");
  assert.equal(state.operatorConfig.serverCount, 3);
  assert.equal(state.operatorConfig.loadThreshold, 0.7);
  assert.equal(state.instances.length, 3);
  assert.equal(state.runtime.instances.length, 3);
  assert.equal(state.runtime.registry.mode, "file");
  assert.equal(state.runtime.registry.durable, true);
  assert.equal(state.runtime.registry.loadThreshold, 0.7);
  assert.equal(state.runtime.registry.sessionTtlMs, 60_000);
  assert.equal(state.runtime.registry.reconnectGracePeriodMs, 15_000);
  assert.match(state.dashboard.status.implemented, /HTTP\/SSE gateway/);
  assert.match(state.dashboard.status.planned, /operator workflows and observability/);
  assert.ok(state.dashboard.codeAdded.some((item) => item.includes("mcp-application-server.js")));
  assert.ok(state.dashboard.codeAdded.some((item) => item.includes("demo-application-server.js")));
  assert.ok(state.dashboard.testProof.some((item) => item.includes("Transport-agnostic tests")));
});

test("local demo controller exposes the reusable-core milestone copy", () => {
  const state = new LocalDemoController().getState();

  assert.match(state.dashboard.problem, /transport adapters/);
  assert.ok(
    state.dashboard.walkthrough.includes(
      "Mark the assigned server unhealthy, route the session again, and watch the reassignment step appear in the decision log.",
    ),
  );
  assert.equal(
    state.runtime.policy,
    "Runtime sessions now have an explicit lease. Every successful request refreshes the session TTL, and a disconnected client gets a short reconnect grace window before the gateway requires re-initialize.",
  );
  assert.ok(
    state.dashboard.codeAdded.some((item) => item.includes("stdio transport adapter")),
  );
});

test("local demo controller honors custom operator config defaults", () => {
  const controller = new LocalDemoController({
    operatorConfig: {
      serverCount: 4,
      loadThreshold: 0.75,
      sessionTtlMs: 90_000,
      reconnectGracePeriodMs: 12_000,
    },
  });
  const state = controller.getState();

  assert.equal(state.operatorConfig.serverCount, 4);
  assert.equal(state.operatorConfig.loadThreshold, 0.75);
  assert.equal(state.instances.length, 4);
  assert.equal(state.runtime.instances.length, 4);
  assert.equal(state.runtime.registry.loadThreshold, 0.75);
  assert.equal(state.runtime.registry.sessionTtlMs, 90_000);
  assert.equal(state.runtime.registry.reconnectGracePeriodMs, 12_000);
});

test("dashboard handler can create and use a real in-process runtime session", async () => {
  const handler = createDashboardHandler();

  const createdResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/sessions",
    body: {},
  });
  assert.equal(createdResponse.statusCode, 200);
  const created = JSON.parse(createdResponse.body);
  assert.ok(created.result.sessionId);
  assert.equal(created.state.runtime.sessions.length, 1);

  const echoedResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/echo",
    body: {
      sessionId: created.result.sessionId,
    },
  });
  assert.equal(echoedResponse.statusCode, 200);
  const echoed = JSON.parse(echoedResponse.body);
  assert.equal(echoed.result.reusedExistingSession, true);
  assert.ok(echoed.state.runtime.events.length >= 1);
  assert.ok(
    echoed.state.runtime.events.some((event) => Array.isArray(event.details) && event.details.length > 0),
  );
});

test("dashboard handler can restart the runtime gateway and reconnect a durable session", async () => {
  const handler = createDashboardHandler();

  const createdResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/sessions",
    body: {},
  });
  const created = JSON.parse(createdResponse.body);

  const restartedResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/restart",
    body: {},
  });
  assert.equal(restartedResponse.statusCode, 200);
  const restarted = JSON.parse(restartedResponse.body);
  assert.equal(restarted.runtime.registry.durable, true);

  const echoedResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/echo",
    body: {
      sessionId: created.result.sessionId,
    },
  });
  const echoed = JSON.parse(echoedResponse.body);
  assert.equal(echoed.result.recovery.action, "reconnected-from-registry");
});

test("dashboard handler can simulate a disconnect and reconnect within grace", async () => {
  const handler = createDashboardHandler();

  const createdResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/sessions",
    body: {},
  });
  const created = JSON.parse(createdResponse.body);

  const disconnectedResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/disconnect",
    body: {
      sessionId: created.result.sessionId,
    },
  });
  assert.equal(disconnectedResponse.statusCode, 200);
  const disconnected = JSON.parse(disconnectedResponse.body);
  assert.equal(disconnected.runtime.sessions[0].metadata.connectionState, "disconnected");

  const echoedResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/api/runtime/echo",
    body: {
      sessionId: created.result.sessionId,
    },
  });
  const echoed = JSON.parse(echoedResponse.body);
  assert.equal(echoed.result.recovery.action, "reconnected-within-grace-period");
});

async function invokeHandler(handler, { method, url, headers = {}, body }) {
  const request = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      }
    },
  };

  let statusCode = 200;
  let payload = "";
  const response = {
    writeHead(nextStatusCode) {
      statusCode = nextStatusCode;
    },
    end(chunk = "") {
      payload += chunk;
    },
  };

  await handler(request, response);

  return {
    statusCode,
    body: payload,
  };
}
