import assert from "node:assert/strict";
import test from "node:test";

import { createScalingDemoServer } from "../../examples/shared/scaling-demo-server.js";
import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";

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

test("notification log keeps a capped sliding window of the most recent entries", async () => {
  const server = new McpApplicationServer({
    maxNotificationLogEntries: 2,
  });

  await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/alpha",
    params: { order: 1 },
  });
  await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/beta",
    params: { order: 2 },
  });
  await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/gamma",
    params: { order: 3 },
  });

  assert.deepEqual(
    server.listNotifications().map((entry) => ({
      method: entry.method,
      order: entry.params.order,
    })),
    [
      { method: "notifications/beta", order: 2 },
      { method: "notifications/gamma", order: 3 },
    ],
  );
  assert.deepEqual(server.getNotificationLogState(), {
    size: 2,
    maxEntries: 2,
  });
});

test("notification hooks and subscribers receive structured events with overflow metadata", async () => {
  const hookedEvents = [];
  const subscribedEvents = [];
  const server = new McpApplicationServer({
    maxNotificationLogEntries: 1,
    onNotificationEvent(event) {
      hookedEvents.push(event);
    },
  });
  const unsubscribe = server.subscribeToNotificationEvents((event) => {
    subscribedEvents.push(event);
  });

  await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/alpha",
    params: { phase: "one" },
  });
  await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/beta",
    params: { phase: "two" },
  });
  unsubscribe();
  await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/gamma",
    params: { phase: "three" },
  });

  assert.equal(hookedEvents.length, 3);
  assert.equal(subscribedEvents.length, 2);
  assert.equal(hookedEvents[1].eventType, "notification.recorded");
  assert.equal(hookedEvents[1].notification.method, "notifications/beta");
  assert.equal(hookedEvents[1].log.maxEntries, 1);
  assert.equal(hookedEvents[1].log.size, 1);
  assert.equal(hookedEvents[1].log.droppedEntries, 1);
  assert.equal(subscribedEvents[0].log.droppedEntries, 0);
  assert.equal(subscribedEvents[1].log.droppedEntries, 1);
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
