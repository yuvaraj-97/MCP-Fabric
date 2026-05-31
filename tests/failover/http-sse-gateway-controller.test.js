import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHttpSseGatewayController,
  isPublicBindHost,
  runStartupSecurityAudit,
} from "../../packages/transports/http-sse/gateway-server.js";
import { FileSessionRegistry } from "../../packages/gateway/session-registry/file-session-registry.js";

test("gateway controller keeps a session sticky and publishes route events without sockets", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1 },
      { serverInstanceId: "server-b", load: 0.2 },
    ],
  });

  const collector = createEventCollector();
  await controller.attachEventStream("session-test", collector);

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-test",
    params: { clientId: "controller-test" },
  });

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: "session-test",
    params: { message: "sticky session" },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(echoed.serverInstanceId, "server-a");
  assert.equal(echoed.reusedExistingSession, true);

  const joined = collector.chunks.join("");
  assert.match(joined, /event: connected|event: session.ready|event: request.received|event: route.selected/);
  assert.match(joined, /sticky session/);
});

test("gateway controller reassigns the session when the original instance becomes unhealthy", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    params: { clientId: "failover-test" },
  });

  controller.upsertInstance({
    serverInstanceId: initialized.serverInstanceId,
    load: 0.9,
    healthy: false,
    acceptingNewSessions: false,
  });

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "reroute me" },
  });

  assert.equal(echoed.serverInstanceId, "server-b");
  assert.equal(echoed.reusedExistingSession, false);
});

test("gateway controller honors explicit stateless runtime mode", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-stateless",
    params: {
      clientId: "stateless-test",
      runtimeMode: "stateless",
    },
  });

  controller.upsertInstance({
    serverInstanceId: "server-a",
    load: 0.6,
    healthy: true,
    acceptingNewSessions: true,
  });
  controller.upsertInstance({
    serverInstanceId: "server-b",
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "stateless follow-up" },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(initialized.runtimeMode, "stateless");
  assert.equal(echoed.serverInstanceId, "server-b");
  assert.equal(echoed.reusedExistingSession, false);
  assert.equal(echoed.runtimeMode, "stateless");
  assert.equal(controller.sessionRegistry.get(initialized.sessionId).metadata.runtimeMode, "stateless");
});

test("gateway controller rejects unsupported runtime modes", async () => {
  const controller = createHttpSseGatewayController();

  await assert.rejects(
    () =>
      controller.handleGatewayMessage({
        method: "initialize",
        sessionId: "session-invalid-mode",
        params: {
          clientId: "invalid-mode-test",
          runtimeMode: "pinned",
        },
      }),
    /runtimeMode must be one of: stateless, sticky/,
  );
});

test("gateway controller returns recommendation-only classifier diagnostics", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-recommendation",
    params: {
      clientId: "recommendation-test",
      runtimeMode: "sticky",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(initialized.runtimeMode, "sticky");
  assert.equal(initialized.runtimeRecommendation.phase, "recommendation-only");
  assert.equal(initialized.runtimeRecommendation.automaticPlacement, false);
  assert.equal(initialized.runtimeRecommendation.recommendedMode, "stateless");
  assert.equal(initialized.runtimeRecommendation.explicitOverride, true);
  assert.equal(initialized.serverInstanceId, "server-a");

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: {
      message: "still sticky",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(echoed.serverInstanceId, "server-a");
  assert.equal(echoed.reusedExistingSession, true);
  assert.equal(echoed.runtimeMode, "sticky");
  assert.equal(echoed.runtimeRecommendation.recommendedMode, "stateless");

  const observability = controller.describeObservability();
  assert.ok(observability.summary.totalRuntimeRecommendations >= 2);
  assert.ok(observability.summary.totalRuntimeOverrideWarnings >= 1);
  assert.ok(
    observability.recentEvents.some(
      (event) =>
        event.eventType === "runtime.recommendation" &&
        event.runtimeRecommendation.recommendedMode === "stateless",
    ),
  );
});

test("adaptive placement uses classifier recommendation for new sessions when enabled", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: { adaptivePlacementEnabled: true },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-adaptive-stateless",
    params: {
      clientId: "adaptive-test",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(initialized.runtimeMode, "stateless");
  assert.equal(initialized.runtimeRecommendation.phase, "adaptive-placement");
  assert.equal(initialized.runtimeRecommendation.automaticPlacement, true);
  assert.equal(initialized.runtimeRecommendation.recommendedMode, "stateless");
  assert.equal(initialized.runtimeRecommendation.effectiveRuntimeMode, "stateless");
  assert.deepEqual(initialized.runtimeRecommendation.adaptivePlacement, {
    enabled: true,
    applied: true,
    source: "classifier-recommendation",
    driftFromPhase2Mode: true,
  });

  const observability = controller.describeObservability();
  assert.equal(observability.summary.totalAdaptivePlacements, 1);
  assert.equal(observability.summary.totalAdaptivePlacementDrifts, 1);
  assert.equal(observability.operatorConfig.adaptivePlacementEnabled, true);
  assert.ok(
    observability.recentEvents.some(
      (event) =>
        event.eventType === "adaptive.placement.applied" &&
        event.runtimeMode === "stateless" &&
        event.phase2RuntimeMode === "sticky",
    ),
  );
});

test("adaptive placement preserves explicit runtimeMode overrides", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: { adaptivePlacementEnabled: true },
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-adaptive-explicit",
    params: {
      clientId: "adaptive-explicit-test",
      runtimeMode: "sticky",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(initialized.runtimeMode, "sticky");
  assert.equal(initialized.runtimeRecommendation.recommendedMode, "stateless");
  assert.deepEqual(initialized.runtimeRecommendation.adaptivePlacement, {
    enabled: true,
    applied: false,
    source: "explicit-runtime-mode",
    driftFromPhase2Mode: false,
  });
  assert.equal(controller.describeObservability().summary.totalAdaptivePlacements, 0);
});

test("adaptive placement does not flip existing sessions mid-lifecycle", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: { adaptivePlacementEnabled: true },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-adaptive-existing",
    params: { clientId: "adaptive-existing-test" },
  });

  assert.equal(initialized.runtimeMode, "sticky");

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: {
      message: "keep existing mode",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(echoed.runtimeMode, "sticky");
  assert.equal(echoed.serverInstanceId, initialized.serverInstanceId);
  assert.equal(echoed.reusedExistingSession, true);
  assert.equal(echoed.runtimeRecommendation.recommendedMode, "stateless");
  assert.deepEqual(echoed.runtimeRecommendation.adaptivePlacement, {
    enabled: true,
    applied: false,
    source: "existing-session-mode",
    driftFromPhase2Mode: false,
  });
});

test("adaptive placement can be rolled back without recreating the controller", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: { adaptivePlacementEnabled: true },
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
  });

  const adaptive = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-adaptive-before-rollback",
    params: {
      clientId: "adaptive-rollback-test",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(adaptive.runtimeMode, "stateless");
  assert.equal(controller.setAdaptivePlacementEnabled(false), false);

  const reverted = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-adaptive-after-rollback",
    params: {
      clientId: "adaptive-rollback-test",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(reverted.runtimeMode, "sticky");
  assert.equal(reverted.runtimeRecommendation.recommendedMode, "stateless");
  assert.equal(reverted.runtimeRecommendation.automaticPlacement, false);
  assert.equal(controller.describeRegistry().adaptivePlacementEnabled, false);
});

test("gateway controller treats malformed runtime hints as diagnostics only", async () => {
  const controller = createHttpSseGatewayController();

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-invalid-hints",
    params: {
      clientId: "invalid-hints-test",
      runtimeHints: {
        resourceHandles: ["browser", 42],
      },
    },
  });

  assert.equal(initialized.runtimeMode, "sticky");
  assert.deepEqual(initialized.runtimeRecommendation.signals.invalidHints, ["resourceHandles"]);
  assert.ok(
    initialized.runtimeRecommendation.reasons.some(
      (reason) => reason.code === "invalid-runtime-hints-ignored",
    ),
  );
  assert.ok(
    controller
      .listAuditEvents()
      .some(
        (event) =>
          event.eventType === "runtime.recommendation" &&
          event.runtimeRecommendation.signals.invalidHints.includes("resourceHandles"),
      ),
  );
});

test("gateway controller preserves routing when classifier diagnostics fail", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
  });
  const params = {
    clientId: "classifier-failure-test",
  };
  Object.defineProperty(params, "runtimeHints", {
    get() {
      throw new Error("runtime hints unavailable");
    },
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-classifier-failure",
    params,
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(initialized.runtimeMode, "sticky");
  assert.equal(initialized.runtimeRecommendation.recommendedMode, "sticky");
  assert.ok(
    initialized.runtimeRecommendation.reasons.some(
      (reason) => reason.code === "classifier-error-ignored",
    ),
  );
});

test("gateway controller reconnects after restart when using a durable registry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-runtime-"));
  const filePath = join(dir, "sessions.json");
  const registry = new FileSessionRegistry({ filePath });

  const first = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionRegistry: registry,
  });

  const initialized = await first.handleGatewayMessage({
    method: "initialize",
    params: { clientId: "restart-test" },
  });

  const restarted = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionRegistry: new FileSessionRegistry({ filePath }),
  });

  const echoed = await restarted.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "after restart" },
  });

  assert.equal(restarted.describeRegistry().durable, true);
  assert.equal(echoed.reusedExistingSession, true);
  assert.equal(echoed.recovery.action, "reconnected-from-registry");
  assert.equal(echoed.result.message, "after restart");
});

test("gateway controller reconnects within the grace period", async () => {
  const clock = createClock();
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionTtlMs: 5_000,
    reconnectGracePeriodMs: 300,
    now: clock.now,
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-grace",
    params: { clientId: "grace-test" },
  });

  const collector = createEventCollector();
  await controller.attachEventStream(initialized.sessionId, collector);
  await controller.detachEventStream(initialized.sessionId, collector);
  clock.advance(200);

  const echoed = await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "within grace" },
  });

  assert.equal(echoed.serverInstanceId, initialized.serverInstanceId);
  assert.equal(echoed.recovery.action, "reconnected-within-grace-period");
});

test("gateway controller requires reinitialize after the reconnect grace period expires", async () => {
  const clock = createClock();
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionTtlMs: 5_000,
    reconnectGracePeriodMs: 100,
    now: clock.now,
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-expired-grace",
    params: { clientId: "grace-expire-test" },
  });

  const collector = createEventCollector();
  await controller.attachEventStream(initialized.sessionId, collector);
  await controller.detachEventStream(initialized.sessionId, collector);
  clock.advance(101);

  await assert.rejects(
    () =>
      controller.handleGatewayMessage({
        method: "echo",
        sessionId: initialized.sessionId,
        params: { message: "too late" },
      }),
    /Reconnect grace period expired/,
  );
});

test("gateway controller requires reinitialize after the session TTL expires", async () => {
  const clock = createClock();
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionTtlMs: 100,
    reconnectGracePeriodMs: 300,
    now: clock.now,
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-ttl",
    params: { clientId: "ttl-test" },
  });

  clock.advance(101);

  await assert.rejects(
    () =>
      controller.handleGatewayMessage({
        method: "echo",
        sessionId: initialized.sessionId,
        params: { message: "expired ttl" },
      }),
    /Session was not found or has expired/,
  );
});

test("gateway controller exposes operator-configured lifecycle policy values", () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: {
      loadThreshold: 0.75,
      sessionTtlMs: 90_000,
      reconnectGracePeriodMs: 12_000,
      onDisconnect: "queue",
    },
  });

  const registry = controller.describeRegistry();
  assert.equal(registry.loadThreshold, 0.75);
  assert.equal(registry.sessionTtlMs, 90_000);
  assert.equal(registry.reconnectGracePeriodMs, 12_000);
  assert.equal(registry.onDisconnect, "queue");
});

test("gateway controller queues a disconnect policy event when onDisconnect=queue", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    operatorConfig: {
      onDisconnect: "queue",
    },
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-queue-policy",
    params: { clientId: "queue-policy-test" },
  });

  const firstCollector = createEventCollector();
  await controller.attachEventStream(initialized.sessionId, firstCollector);
  await controller.detachEventStream(initialized.sessionId, firstCollector);

  const queuedEvents = controller.listQueuedDisconnectEvents(initialized.sessionId);
  assert.equal(queuedEvents.length, 1);
  assert.equal(queuedEvents[0].event, "disconnect.policy.queued");
  assert.equal(queuedEvents[0].payload.policy, "queue");

  const secondCollector = createEventCollector();
  await controller.attachEventStream(initialized.sessionId, secondCollector);

  const replayed = secondCollector.chunks.join("");
  assert.match(replayed, /event: disconnect\.policy\.queued/);
  assert.equal(controller.listQueuedDisconnectEvents(initialized.sessionId).length, 0);
  assert.ok(
    controller
      .listAuditEvents()
      .some((event) => event.eventType === "disconnect.queue.flushed" && event.sessionId === initialized.sessionId),
  );
});

test("gateway controller records cancel policy without queueing reconnect output when onDisconnect=cancel", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    operatorConfig: {
      onDisconnect: "cancel",
    },
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-cancel-policy",
    params: { clientId: "cancel-policy-test" },
  });

  const collector = createEventCollector();
  await controller.attachEventStream(initialized.sessionId, collector);
  await controller.detachEventStream(initialized.sessionId, collector);

  assert.equal(controller.listQueuedDisconnectEvents(initialized.sessionId).length, 0);
  assert.ok(
    controller.listAuditEvents().some(
      (event) =>
        event.eventType === "disconnect.policy.applied" &&
        event.sessionId === initialized.sessionId &&
        event.policy === "cancel",
    ),
  );
});

test("gateway controller drops queued disconnect events when their session expires", async () => {
  const clock = createClock();
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    operatorConfig: {
      onDisconnect: "queue",
      sessionTtlMs: 100,
    },
    now: clock.now,
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-expiring-queue",
    params: { clientId: "queue-expiry-test" },
  });
  const collector = createEventCollector();
  await controller.attachEventStream(initialized.sessionId, collector);
  await controller.detachEventStream(initialized.sessionId, collector);
  assert.equal(controller.listQueuedDisconnectEvents(initialized.sessionId).length, 1);

  clock.advance(101);
  await assert.rejects(
    () =>
      controller.handleGatewayMessage({
        method: "echo",
        sessionId: initialized.sessionId,
        params: { message: "expired" },
      }),
    /Session was not found or has expired/,
  );
  assert.equal(controller.listQueuedDisconnectEvents(initialized.sessionId).length, 0);
});

test("gateway controller caps queued disconnect events per session", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    operatorConfig: {
      onDisconnect: "queue",
    },
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-capped-queue",
    params: { clientId: "queue-cap-test" },
  });
  for (let index = 0; index < 105; index += 1) {
    await controller.detachEventStream(initialized.sessionId, createEventCollector());
  }

  assert.equal(controller.listQueuedDisconnectEvents(initialized.sessionId).length, 100);
});

test("gateway controller persists lifecycle metadata before invoking application logic", async () => {
  let registry;
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    createApplication({ serverInstanceId }) {
      return {
        getSessionState() {
          return true;
        },
        async handleMessage(message) {
          const record = await registry.get(message.sessionId);
          assert.equal(record.serverInstanceId, serverInstanceId);
          assert.equal(record.metadata.clientId, "atomic-assignment-test");
          assert.equal(record.metadata.connectionState, "active");
          return {
            jsonrpc: "2.0",
            id: message.id,
            result: { ok: true },
          };
        },
      };
    },
  });
  registry = controller.sessionRegistry;

  await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "atomic-session",
    params: { clientId: "atomic-assignment-test" },
  });
});

test("gateway controller records observability events and counters", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "session-observe",
    params: { clientId: "observe-test" },
  });

  await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "observe me" },
  });

  const observability = controller.describeObservability();
  assert.equal(observability.summary.totalRequests, 2);
  assert.equal(observability.summary.totalInitializations, 1);
  assert.ok(observability.summary.totalEvents >= 4);
  assert.ok(observability.recentEvents.some((event) => event.eventType === "request.received"));
  assert.ok(observability.recentEvents.some((event) => event.eventType === "route.completed"));
});

test("startup security helpers classify public bind hosts correctly", () => {
  assert.equal(isPublicBindHost("127.0.0.1"), false);
  assert.equal(isPublicBindHost("0.0.0.0"), true);
  assert.equal(isPublicBindHost("::"), true);
});

test("startup security audit rejects unsafe public binds by default", async () => {
  const logs = [];

  await assert.rejects(
    () =>
      runStartupSecurityAudit({
        host: "0.0.0.0",
        port: 3000,
        allowPublicBind: false,
        enforceStartupSecurityAudit: true,
        auditLogger: {
          error(message) {
            logs.push(message);
          },
        },
      }),
    /FATAL: Gateway is publicly accessible and vulnerable to hijacking/,
  );

  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[SECURITY WARNING\]/);
});

test("startup security audit can allow public bind only when the self-hijack probe stays disabled", async () => {
  const logs = [];

  await runStartupSecurityAudit({
    host: "0.0.0.0",
    port: 3000,
    allowPublicBind: true,
    enforceStartupSecurityAudit: false,
    auditLogger: {
      error(message) {
        logs.push(message);
      },
    },
  });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[SECURITY WARNING\]/);
});

test("startup security audit fails when the self-hijack probe succeeds", async () => {
  await assert.rejects(
    () =>
      runStartupSecurityAudit({
        host: "0.0.0.0",
        port: 3000,
        allowPublicBind: true,
        enforceStartupSecurityAudit: true,
        fetchImpl: async () => ({
          ok: true,
        }),
        auditLogger: {
          error() {},
        },
      }),
    /FATAL: Gateway is publicly accessible and vulnerable to hijacking/,
  );
});

test("startup security audit allows public bind when the self-hijack probe is unauthorized", async () => {
  await runStartupSecurityAudit({
    host: "0.0.0.0",
    port: 3000,
    allowPublicBind: true,
    enforceStartupSecurityAudit: true,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
    }),
    auditLogger: {
      error() {},
    },
  });
});

test("startup security audit rejects unexpected self-hijack probe failures", async () => {
  await assert.rejects(
    () =>
      runStartupSecurityAudit({
        host: "0.0.0.0",
        port: 3000,
        allowPublicBind: true,
        enforceStartupSecurityAudit: true,
        fetchImpl: async () => ({
          ok: false,
          status: 500,
        }),
        auditLogger: {
          error() {},
        },
      }),
    /Startup self-hijack probe did not receive an unauthorized failure/,
  );
});

function createEventCollector() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
    },
  };
}

function createClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
  };
}
