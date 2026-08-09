import assert from "node:assert/strict";
import test from "node:test";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";
import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";
import { createSessionRegistry } from "../../packages/gateway/session-registry/create-session-registry.js";

test("server/discover returns correct MCP 2026-07-28 discovery payload", async () => {
  const server = new McpApplicationServer({
    serverInfo: { name: "test-server", version: "1.2.3" },
    instructions: "Instructions for discovery test.",
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: "disc-1",
    method: "server/discover",
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, "disc-1");
  assert.equal(response.result.resultType, "complete");
  assert.deepEqual(response.result.supportedVersions, ["2026-07-28", "2025-11-25"]);
  assert.equal(response.result._meta["io.modelcontextprotocol/serverInfo"].name, "test-server");
  assert.equal(response.result._meta["io.modelcontextprotocol/serverInfo"].version, "1.2.3");
  assert.equal(response.result.instructions, "Instructions for discovery test.");
});

test("HTTP-SSE Gateway handleGatewayMessage handles stateless fast path without creating a registry session", async () => {
  const registry = createSessionRegistry({ backend: "memory" });
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "worker-2", load: 0.8, healthy: true, acceptingNewSessions: true },
    ],
    sessionRegistry: registry,
  });

  const response = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "msg-1",
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
  });

  assert.equal(response.serverInstanceId, "worker-1");
  assert.equal(response.runtimeMode, "stateless");
  assert.equal(response.result.resultType, "complete");

  // Verify no session was created in the registry
  const sessions = await registry.list();
  assert.equal(sessions.length, 0);
});

test("HTTP-SSE Gateway routes stateful requests stickily based on the extracted state handle", async () => {
  const registry = createSessionRegistry({ backend: "memory" });
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "worker-2", load: 0.05, healthy: true, acceptingNewSessions: true },
    ],
    sessionRegistry: registry,
  });

  // Call 1 with a browser_id state handle
  const response1 = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "msg-2",
    method: "tools/call",
    params: {
      name: "echo",
      arguments: {
        message: "hello",
        browser_id: "browser-xyz",
      },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
  });

  const assignedWorker = response1.serverInstanceId;

  // Call 2 with the same browser_id state handle should land on the same worker
  const response2 = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "msg-3",
    method: "tools/call",
    params: {
      name: "echo",
      arguments: {
        message: "world",
        browser_id: "browser-xyz",
      },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
  });

  assert.equal(response2.serverInstanceId, assignedWorker);
  assert.equal(response2.reusedExistingSession, true);

  // Verify session registry has an entry for the browser handle
  const record = await registry.get("browser-xyz");
  assert.ok(record);
  assert.equal(record.serverInstanceId, assignedWorker);
});
