import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";
import { createStreamableHttpGatewayController } from "../../packages/transports/streamable-http/gateway-server.js";
import { createSessionRegistry } from "../../packages/gateway/session-registry/create-session-registry.js";
import { createWorkloadRegistry } from "../../packages/gateway/workload-registry/workload-registry.js";

test("A. Discovery payload conforms to MCP 2026-07-28 final wire shape", async () => {
  const server = new McpApplicationServer({
    serverInfo: { name: "conformance-server", version: "2.0.0" },
    instructions: "Strict discovery conformance test.",
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: "disc-conformance",
    method: "server/discover",
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, "disc-conformance");

  const result = response.result;
  assert.equal(result.resultType, "complete");
  assert.deepEqual(result.supportedVersions, ["2026-07-28", "2025-11-25"]);
  assert.ok(result.capabilities);
  assert.equal(result.instructions, "Strict discovery conformance test.");
  assert.equal(typeof result.ttlMs, "number");
  assert.equal(typeof result.cacheScope, "string");

  // Ensure server identity is ONLY under _meta["io.modelcontextprotocol/serverInfo"] and NOT top-level serverInfo
  assert.equal(result.serverInfo, undefined);
  assert.ok(result._meta);
  assert.ok(result._meta["io.modelcontextprotocol/serverInfo"]);
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "conformance-server");
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].version, "2.0.0");
});

test("B. Header requirements: Mcp-Method and Mcp-Name enforcement", async () => {
  const controller = createStreamableHttpGatewayController({
    serverInstances: [{ serverInstanceId: "worker-1", load: 0.1, healthy: true, acceptingNewSessions: true }],
  });

  // Missing Mcp-Method rejected with 400 mcp-method-missing
  await assert.rejects(
    async () => {
      await controller.handleGatewayMessage(
        { jsonrpc: "2.0", id: "b-1", method: "server/discover" },
        { "mcp-protocol-version": "2026-07-28" }
      );
    },
    (err) => err.statusCode === 400 && err.code === "mcp-method-missing"
  );

  // Mismatched Mcp-Method rejected with 400 mcp-method-mismatch
  await assert.rejects(
    async () => {
      await controller.handleGatewayMessage(
        { jsonrpc: "2.0", id: "b-2", method: "server/discover" },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call" }
      );
    },
    (err) => err.statusCode === 400 && err.code === "mcp-method-mismatch"
  );

  // Missing Mcp-Name for named operations (tools/call) rejected with 400 mcp-name-missing
  await assert.rejects(
    async () => {
      await controller.handleGatewayMessage(
        {
          jsonrpc: "2.0",
          id: "b-3",
          method: "tools/call",
          params: { name: "echo", arguments: { message: "hi" } },
        },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call" }
      );
    },
    (err) => err.statusCode === 400 && err.code === "mcp-name-missing"
  );

  // Mismatched Mcp-Name for tools/call rejected with 400 mcp-name-mismatch
  await assert.rejects(
    async () => {
      await controller.handleGatewayMessage(
        {
          jsonrpc: "2.0",
          id: "b-4",
          method: "tools/call",
          params: { name: "echo", arguments: { message: "hi" } },
        },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "wrong_name" }
      );
    },
    (err) => err.statusCode === 400 && err.code === "mcp-name-mismatch"
  );

  // resources/read maps Mcp-Name to params.uri
  await assert.rejects(
    async () => {
      await controller.handleGatewayMessage(
        {
          jsonrpc: "2.0",
          id: "b-5",
          method: "resources/read",
          params: { uri: "file:///path/to/resource" },
        },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "resources/read", "mcp-name": "file:///path/to/other" }
      );
    },
    (err) => err.statusCode === 400 && err.code === "mcp-name-mismatch"
  );
});

test("C. Trace context normalization: _meta propagation and HTTP fallback", async () => {
  let capturedTraceContext = null;
  const appFactory = ({ serverInstanceId }) => ({
    serverInstanceId,
    async handleMessage(msg, ctx) {
      capturedTraceContext = ctx.metadata?.traceContext;
      return { jsonrpc: "2.0", id: msg.id, result: { ok: true } };
    },
  });

  const controller = createStreamableHttpGatewayController({
    serverInstances: [{ serverInstanceId: "w-1", load: 0.1, healthy: true, acceptingNewSessions: true }],
    createApplication: appFactory,
  });

  // _meta propagation takes precedence over HTTP headers
  await controller.handleGatewayMessage(
    {
      jsonrpc: "2.0",
      id: "c-1",
      method: "server/discover",
      params: {
        _meta: { traceparent: "00-META_TRACE-01", tracestate: "meta=1", baggage: "meta=b" },
      },
    },
    {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
      traceparent: "00-HTTP_TRACE-01",
      tracestate: "http=1",
      baggage: "http=b",
    }
  );
  assert.equal(capturedTraceContext.traceparent, "00-META_TRACE-01");
  assert.equal(capturedTraceContext.tracestate, "meta=1");
  assert.equal(capturedTraceContext.baggage, "meta=b");

  // HTTP fallback when _meta is missing
  await controller.handleGatewayMessage(
    { jsonrpc: "2.0", id: "c-2", method: "server/discover", params: {} },
    {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
      traceparent: "00-HTTP_ONLY_TRACE-01",
    }
  );
  assert.equal(capturedTraceContext.traceparent, "00-HTTP_ONLY_TRACE-01");
});

test("D. Stateless request: no SessionRegistry or WorkloadRegistry entry created", async () => {
  const sessionRegistry = createSessionRegistry({ backend: "memory" });
  const workloadRegistry = createWorkloadRegistry({ backend: "memory" });

  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "w-1", load: 0.2, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "w-2", load: 0.1, healthy: true, acceptingNewSessions: true },
    ],
    sessionRegistry,
    workloadRegistry,
  });

  const res = await controller.handleGatewayMessage(
    { jsonrpc: "2.0", id: "d-1", method: "server/discover" },
    { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" }
  );
  assert.equal(res.serverInstanceId, "w-2");
  assert.equal(res.runtimeMode, "stateless");

  const sessions = await sessionRegistry.list();
  assert.equal(sessions.length, 0);
  const workloads = await workloadRegistry.list();
  assert.equal(workloads.length, 0);
});

test("E. Stateful workload: WorkloadRegistry entry exists, no SessionRegistry entry, repeat requests preserve placement without synthetic initialize", async () => {
  const sessionRegistry = createSessionRegistry({ backend: "memory" });
  const workloadRegistry = createWorkloadRegistry({ backend: "memory" });
  let syntheticInitializeCalled = false;

  const appFactory = ({ serverInstanceId }) => ({
    serverInstanceId,
    getWorkloadState(workloadId) {
      return { workloadId, active: true };
    },
    async ensureWorkload({ workloadId, workloadKind }) {
      return { workloadId, workloadKind };
    },
    async handleWorkloadMessage(msg) {
      if (msg.method === "initialize") {
        syntheticInitializeCalled = true;
      }
      return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } };
    },
  });

  const controller = createStreamableHttpGatewayController({
    serverInstances: [
      { serverInstanceId: "w-1", load: 0.1, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "w-2", load: 0.05, healthy: true, acceptingNewSessions: true },
    ],
    sessionRegistry,
    workloadRegistry,
    createApplication: appFactory,
  });

  // Initial stateful request with state handle browser_id
  const req = {
    jsonrpc: "2.0",
    id: "e-1",
    method: "tools/call",
    params: { name: "echo", arguments: { message: "test", browser_id: "browser-session-999" } },
  };
  const headers = { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "echo" };

  const res1 = await controller.handleGatewayMessage(req, headers);
  const assignedWorker = res1.serverInstanceId;

  // WorkloadRegistry entry exists
  const wlRecord = await workloadRegistry.get("browser-session-999");
  assert.ok(wlRecord);
  assert.equal(wlRecord.serverInstanceId, assignedWorker);

  // SessionRegistry entry MUST NOT exist
  const sessRecord = await sessionRegistry.get("browser-session-999");
  assert.equal(sessRecord, undefined);

  // Repeat request reaches same worker
  const res2 = await controller.handleGatewayMessage(req, headers);
  assert.equal(res2.serverInstanceId, assignedWorker);
  assert.equal(res2.workloadPlacementReused, true);

  // Assert no synthetic initialize was called
  assert.equal(syntheticInitializeCalled, false);
});

test("F. Legacy MCP initialize/session lifecycle remains isolated and functional", async () => {
  const sessionRegistry = createSessionRegistry({ backend: "memory" });
  const controller = createStreamableHttpGatewayController({
    serverInstances: [{ serverInstanceId: "w-1", load: 0.1, healthy: true, acceptingNewSessions: true }],
    sessionRegistry,
  });

  // Legacy initialize request (without mcp-protocol-version 2026-07-28 header)
  const initRes = await controller.handleGatewayMessage({
    jsonrpc: "2.0",
    id: "f-1",
    method: "initialize",
    params: { clientId: "legacy-client" },
  });

  assert.ok(initRes.sessionId);
  assert.equal(initRes.serverInstanceId, "w-1");

  // Legacy SessionRegistry entry exists
  const sessRecord = await sessionRegistry.get(initRes.sessionId);
  assert.ok(sessRecord);
  assert.equal(sessRecord.metadata.clientId, "legacy-client");
});

test("G. Registry backend capabilities: memory reports non-durable, redis/file report durable", async () => {
  const memRegistry = createWorkloadRegistry({ backend: "memory" });
  assert.equal(memRegistry.storageKind(), "memory");
  assert.equal(memRegistry.isDurable(), false);

  const tmpFile = join(tmpdir(), `workload-cap-test-${Date.now()}.json`);
  try {
    const fileRegistry = createWorkloadRegistry({ backend: "file", filePath: tmpFile });
    assert.equal(fileRegistry.storageKind(), "file");
    assert.equal(fileRegistry.isDurable(), true);
  } finally {
    rmSync(tmpFile, { force: true });
  }
});
