import assert from "node:assert/strict";
import test from "node:test";

import { createScalingDemoServer } from "../../examples/shared/scaling-demo-server.js";

test("initialize returns MCP-compatible server info and tool capability", async () => {
  const server = createScalingDemoServer();

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, "scaling-demo-server");
  assert.equal(response.result.capabilities.tools.listChanged, false);
});

test("tools/list exposes tools registered in the transport-neutral core", async () => {
  const server = createScalingDemoServer();

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });

  assert.equal(response.result.tools.length, 2);
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name).sort(),
    ["explain_scaling", "sum_load"],
  );
});

test("tools/call runs shared application logic and preserves session context", async () => {
  const server = createScalingDemoServer();

  const response = await server.handleMessage(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "explain_scaling",
        arguments: {
          audience: "operator",
        },
      },
    },
    {
      clientId: "client-7",
      sessionId: "session-42",
      transport: "test",
    },
  );

  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.audience, "operator");
  assert.equal(response.result.structuredContent.session.sessionId, "session-42");
  assert.equal(response.result.structuredContent.session.transport, "test");
});

test("notifications do not emit responses and are still recorded", async () => {
  const server = createScalingDemoServer();

  const response = await server.handleMessage(
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {
        phase: "ready",
      },
    },
    {
      sessionId: "session-9",
      clientId: "client-9",
      transport: "test",
    },
  );

  assert.equal(response, null);
  assert.equal(server.listNotifications().length, 1);
  assert.equal(server.listNotifications()[0].method, "notifications/initialized");
});

test("unsupported methods return JSON-RPC errors", async () => {
  const server = createScalingDemoServer();

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/list",
  });

  assert.equal(response.error.code, -32601);
  assert.match(response.error.message, /Unsupported MCP method/);
});
