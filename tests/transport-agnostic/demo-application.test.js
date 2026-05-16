import assert from "node:assert/strict";
import test from "node:test";

import { createDemoApplication } from "../../packages/core/protocol-adapter/demo-application.js";

test("demo application exposes the same basic behavior independent of transport", async () => {
  const events = [];
  const app = createDemoApplication({ serverInstanceId: "server-a" });

  const initialized = await app.handleRequest({
    method: "initialize",
    params: { clientId: "test-client" },
    emitEvent(event, payload) {
      events.push({ event, payload });
    },
  });

  const echoed = await app.handleRequest({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "hello" },
    emitEvent(event, payload) {
      events.push({ event, payload });
    },
  });

  const status = await app.handleRequest({
    method: "status",
    sessionId: initialized.sessionId,
    emitEvent(event, payload) {
      events.push({ event, payload });
    },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(echoed.serverInstanceId, "server-a");
  assert.equal(echoed.message, "hello");
  assert.equal(echoed.requestCount, 1);
  assert.equal(status.requestCount, 1);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["session.ready", "request.received", "response.ready", "status.reported"],
  );
});
