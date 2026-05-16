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
  assert.match(htmlResponse.body, /Self-explaining MCP scaling dashboard/);

  const stateResponse = await invokeHandler(handler, {
    method: "GET",
    url: "/api/state",
  });
  assert.equal(stateResponse.statusCode, 200);
  const state = JSON.parse(stateResponse.body);
  assert.equal(state.dashboard.title, "MCP Scaling Demo Dashboard");
  assert.equal(state.instances.length, 3);
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
