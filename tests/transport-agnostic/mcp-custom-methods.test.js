import assert from "node:assert/strict";
import test from "node:test";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";

test("custom MCP method handlers can be registered on the reusable server", async () => {
  const server = new McpApplicationServer({
    serverInfo: {
      name: "custom-method-server",
      version: "0.1.0",
    },
  });

  server.registerMethod("status", async ({ context, params }) => ({
    sessionId: context.sessionId,
    mode: params.mode ?? "demo",
  }));

  const response = await server.handleMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "status",
      params: { mode: "active" },
    },
    {
      sessionId: "session-77",
      clientId: "client-77",
      transport: "test",
    },
  );

  assert.equal(response.result.sessionId, "session-77");
  assert.equal(response.result.mode, "active");
});
