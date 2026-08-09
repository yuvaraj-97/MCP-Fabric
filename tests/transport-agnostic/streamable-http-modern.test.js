import assert from "node:assert/strict";
import test from "node:test";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";
import { createHttpSseGatewayController as createStreamableHttpGatewayController } from "../../packages/transports/streamable-http/gateway-server.js";
import { createSessionRegistry } from "../../packages/gateway/session-registry/create-session-registry.js";
import { createWorkloadRegistry } from "../../packages/gateway/workload-registry/workload-registry.js";

test("Streamable HTTP Gateway validates Mcp-Method header correctly", async () => {
  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true },
    ],
  });

  // Valid header matches method
  const response = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-1",
    method: "server/discover",
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "server/discover",
  });
  assert.equal(response.result.resultType, "complete");

  // Invalid header mismatch rejects with 400
  await assert.rejects(async () => {
    await controller.handleGatewayMessage({
      jsonrpc: "2.0",
      id: "h-2",
      method: "server/discover",
    }, {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
    });
  }, (err) => {
    return err.statusCode === 400 && err.code === "mcp-method-mismatch";
  });
});

test("Streamable HTTP Gateway validates Mcp-Name header mismatch", async () => {
  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true },
    ],
  });

  // Valid named tool call matches Mcp-Name header
  const response = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-3",
    method: "tools/call",
    params: {
      name: "echo",
      arguments: { message: "test", browser_id: "browser-xyz" },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": "echo",
  });
  assert.equal(response.result.structuredContent.message, "test");

  // Invalid Mcp-Name mismatch throws 400
  await assert.rejects(async () => {
    await controller.handleGatewayMessage({
      jsonrpc: "2.0",
      id: "h-4",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { message: "test", browser_id: "browser-xyz" },
      },
    }, {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "different-tool",
    });
  }, (err) => {
    return err.statusCode === 400 && err.code === "mcp-name-mismatch";
  });
});

test("Streamable HTTP Gateway accepts missing optional Mcp-Name header", async () => {
  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true },
    ],
  });

  // Optional Mcp-Name header omitted is fine
  const response = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-5",
    method: "server/discover",
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "server/discover",
  });
  assert.equal(response.result.resultType, "complete");
});

test("Streamable HTTP Gateway handles custom state-handle using JSON-schema metadata marker", async () => {
  const registry = createSessionRegistry({ backend: "memory" });
  const workloads = createWorkloadRegistry({ backend: "memory" });

  // Custom tool registration with JSON schema marker
  const customApplicationFactory = ({ serverInstanceId }) => {
    const app = new McpApplicationServer({
      serverInfo: { name: `custom-app-${serverInstanceId}`, version: "1.0.0" },
    });
    app.registerTool({
      name: "run_job",
      title: "Run Job",
      description: "Run a specific job with affinity tracking",
      inputSchema: {
        type: "object",
        properties: {
          my_custom_job_id: {
            type: "string",
            "x-mcp-fabric-workload-affinity": true,
          },
        },
      },
      async handler({ arguments: args }) {
        return { job: args.my_custom_job_id };
      },
    });
    return {
      serverInstanceId,
      listTools() {
        return app.listTools();
      },
      getSessionState() {
        return { active: true };
      },
      async handleMessage(message, context) {
        return app.handleMessage(message, context);
      },
    };
  };

  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.2, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "worker-2", load: 0.05, healthy: true, acceptingNewSessions: true },
    ],
    sessionRegistry: registry,
    workloadRegistry: workloads,
    createApplication: customApplicationFactory,
  });

  // Request 1 assigns placement stickily based on the custom schema-marked marker
  const response1 = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-6",
    method: "tools/call",
    params: {
      name: "run_job",
      arguments: {
        my_custom_job_id: "job-999",
      },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
  });

  const worker = response1.serverInstanceId;

  // Request 2 with same custom handle routes to the same worker
  const response2 = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-7",
    method: "tools/call",
    params: {
      name: "run_job",
      arguments: {
        my_custom_job_id: "job-999",
      },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
  });

  assert.equal(response2.serverInstanceId, worker);
  assert.equal(response2.reusedExistingSession, true);

  // Check workload registry has the job placement
  const workloadRecord = await workloads.get("job-999");
  assert.ok(workloadRecord);
  assert.equal(workloadRecord.serverInstanceId, worker);
  assert.equal(workloadRecord.kind, "my_custom_job_id");

  // Verify legacy session registry remains empty
  const sessionRecord = await registry.get("job-999");
  assert.equal(sessionRecord, undefined);
});

test("Streamable HTTP Gateway propagates W3C trace headers", async () => {
  let capturedTraceContext = null;

  const appFactory = ({ serverInstanceId }) => {
    return {
      serverInstanceId,
      getSessionState() { return { active: true }; },
      async handleMessage(message, context) {
        capturedTraceContext = context.metadata?.traceContext;
        return { jsonrpc: "2.0", id: message.id, result: { ok: true } };
      },
    };
  };

  const controller = createStreamableHttpGatewayController({
    serverInstances: [{ serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true }],
    createApplication: appFactory,
  });

  await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-8",
    method: "server/discover",
  }, {
    "mcp-protocol-version": "2026-07-28",
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "tracestate": "congo=t61rcWkgMzE",
    "baggage": "userId=alice",
  });

  assert.ok(capturedTraceContext);
  assert.equal(capturedTraceContext.traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.equal(capturedTraceContext.tracestate, "congo=t61rcWkgMzE");
  assert.equal(capturedTraceContext.baggage, "userId=alice");
});
