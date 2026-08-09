import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";
import { createStreamableHttpGatewayController } from "../../packages/transports/streamable-http/gateway-server.js";
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

  // Missing Mcp-Method header throws 400
  await assert.rejects(async () => {
    await controller.handleGatewayMessage({
      jsonrpc: "2.0",
      id: "h-missing",
      method: "server/discover",
    }, {
      "mcp-protocol-version": "2026-07-28",
    });
  }, (err) => {
    return err.statusCode === 400 && err.code === "mcp-method-missing";
  });

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

test("Streamable HTTP Gateway validates Mcp-Name header mismatch and missing", async () => {
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

  // Missing Mcp-Name header for named operation throws 400
  await assert.rejects(async () => {
    await controller.handleGatewayMessage({
      jsonrpc: "2.0",
      id: "h-missing-name",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { message: "test", browser_id: "browser-xyz" },
      },
    }, {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
    });
  }, (err) => {
    return err.statusCode === 400 && err.code === "mcp-name-missing";
  });

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

test("Streamable HTTP Gateway validates resources/read Mcp-Name to params.uri", async () => {
  let resourcesReadParams = null;
  const appFactory = ({ serverInstanceId }) => {
    return {
      serverInstanceId,
      getSessionState() { return { active: true }; },
      async handleWorkloadMessage(message) {
        if (message.method === "resources/read") {
          resourcesReadParams = message.params;
          return { jsonrpc: "2.0", id: message.id, result: { contents: [{ uri: message.params.uri, text: "content" }] } };
        }
        return { jsonrpc: "2.0", id: message.id, result: { ok: true } };
      },
    };
  };

  const controller = createStreamableHttpGatewayController({
    serverInstances: [{ serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true }],
    createApplication: appFactory,
  });

  // Valid resources/read matches URI in Mcp-Name
  const response = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "r-1",
    method: "resources/read",
    params: {
      uri: "file://some/resource",
      browser_id: "browser-xyz",
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "resources/read",
    "mcp-name": "file://some/resource",
  });
  assert.equal(response.result.contents[0].text, "content");
  assert.equal(resourcesReadParams.uri, "file://some/resource");

  // Mismatched URI rejects with 400
  await assert.rejects(async () => {
    await controller.handleGatewayMessage({
      jsonrpc: "2.0",
      id: "r-2",
      method: "resources/read",
      params: {
        uri: "file://some/resource",
        browser_id: "browser-xyz",
      },
    }, {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "resources/read",
      "mcp-name": "file://other/uri",
    });
  }, (err) => {
    return err.statusCode === 400 && err.code === "mcp-name-mismatch";
  });
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
      async ensureWorkload({ workloadId }) {
        return { workloadId };
      },
      async handleWorkloadMessage(message, { workloadId }) {
        return app.handleMessage(message, { sessionId: workloadId });
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
    "mcp-name": "run_job",
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
    "mcp-name": "run_job",
  });

  assert.equal(response2.serverInstanceId, worker);
  assert.equal(response2.reusedExistingWorkload, true);

  // Check workload registry has the job placement
  const workloadRecord = await workloads.get("job-999");
  assert.ok(workloadRecord);
  assert.equal(workloadRecord.serverInstanceId, worker);
  assert.equal(workloadRecord.kind, "my_custom_job_id");

  // Verify legacy session registry remains empty
  const sessionRecord = await registry.get("job-999");
  assert.equal(sessionRecord, undefined);
});

test("Streamable HTTP Gateway propagates and prioritizes W3C trace headers", async () => {
  let capturedTraceContext = null;

  const appFactory = ({ serverInstanceId }) => {
    return {
      serverInstanceId,
      getSessionState() { return { active: true }; },
      async handleMessage(message, context) {
        capturedTraceContext = context.metadata?.traceContext;
        return { jsonrpc: "2.0", id: message.id, result: { ok: true } };
      },
      async handleWorkloadMessage(message, context) {
        capturedTraceContext = context.traceContext;
        return { jsonrpc: "2.0", id: message.id, result: { ok: true } };
      },
    };
  };

  const controller = createStreamableHttpGatewayController({
    serverInstances: [{ serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true }],
    createApplication: appFactory,
  });

  // Precedence test: Both exist, _meta wins
  await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-8",
    method: "server/discover",
    params: {
      _meta: {
        traceparent: "00-META_TRACEPARENT-01",
        tracestate: "meta=state",
        baggage: "meta=baggage",
      },
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "server/discover",
    "traceparent": "00-HEADER_TRACEPARENT-01",
    "tracestate": "header=state",
    "baggage": "header=baggage",
  });

  assert.ok(capturedTraceContext);
  assert.equal(capturedTraceContext.traceparent, "00-META_TRACEPARENT-01");
  assert.equal(capturedTraceContext.tracestate, "meta=state");
  assert.equal(capturedTraceContext.baggage, "meta=baggage");

  // Fallback test: Only headers exist
  await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "h-9",
    method: "server/discover",
    params: {},
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "server/discover",
    "traceparent": "00-HEADER_ONLY-01",
  });

  assert.equal(capturedTraceContext.traceparent, "00-HEADER_ONLY-01");
});

test("Stateless request does not create sessions in registry", async () => {
  const sessionRegistry = createSessionRegistry({ backend: "memory" });
  const workloadRegistry = createWorkloadRegistry({ backend: "memory" });

  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "worker-2", load: 0.05, healthy: true, acceptingNewSessions: true },
    ],
    sessionRegistry,
    workloadRegistry,
  });

  const response = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "stateless-1",
    method: "server/discover",
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "server/discover",
  });

  assert.equal(response.result.resultType, "complete");

  // No legacy sessions should have been created
  const sessionList = await sessionRegistry.list();
  assert.equal(sessionList.length, 0);

  // No workload should have been created since no affinity handle was present
  const workloadList = await workloadRegistry.list();
  assert.equal(workloadList.length, 0);
});

test("Durable FileWorkloadRegistry backend correctness", async () => {
  const filePath = join(tmpdir(), `workloads-${Date.now()}-${Math.random()}.json`);

  try {
    const registry = createWorkloadRegistry({
      backend: "file",
      filePath,
    });

    assert.equal(registry.storageKind(), "file");
    assert.equal(registry.isDurable(), true);

    // Create entry
    await registry.create("workload-1", {
      kind: "browser_id",
      serverInstanceId: "worker-abc",
    });

    // Verify it is flushed
    await registry.close();

    // Reopen and check persistency
    const reopened = createWorkloadRegistry({
      backend: "file",
      filePath,
    });

    const record = await reopened.get("workload-1");
    assert.ok(record);
    assert.equal(record.serverInstanceId, "worker-abc");
    assert.equal(record.kind, "browser_id");
  } finally {
    rmSync(filePath, { force: true });
  }
});
