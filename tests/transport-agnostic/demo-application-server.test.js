import assert from "node:assert/strict";
import test from "node:test";

import { createDemoApplicationServer } from "../../packages/core/protocol-adapter/demo-application-server.js";

test("demo application server returns JSON-RPC errors for invalid envelopes", async () => {
  const server = createDemoApplicationServer({ serverInstanceId: "server-a" });

  const response = await server.handleMessage({
    id: 1,
    method: "initialize",
  });

  assert.equal(response.error.code, -32600);
  assert.match(response.error.message, /JSON-RPC 2.0/);
});

test("demo application server returns null for notifications", async () => {
  const server = createDemoApplicationServer({ serverInstanceId: "server-a" });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    method: "status",
  });

  assert.equal(response, null);
});

test("demo application server emits consistent JSON-RPC success envelopes", async () => {
  const server = createDemoApplicationServer({ serverInstanceId: "server-a" });

  const initialized = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientId: "demo-client" },
  });

  const echoed = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "echo",
    sessionId: initialized.result.sessionId,
    params: { message: "hello" },
  }, {
    sessionId: initialized.result.sessionId,
  });

  assert.equal(initialized.jsonrpc, "2.0");
  assert.equal(echoed.jsonrpc, "2.0");
  assert.equal(echoed.result.message, "hello");
  assert.equal(echoed.result.requestCount, 1);
});
