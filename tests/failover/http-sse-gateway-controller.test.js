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
  controller.attachEventStream("session-test", collector);

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
  controller.attachEventStream(initialized.sessionId, collector);
  controller.detachEventStream(initialized.sessionId, collector);
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
  controller.attachEventStream(initialized.sessionId, collector);
  controller.detachEventStream(initialized.sessionId, collector);
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
  controller.attachEventStream(initialized.sessionId, firstCollector);
  controller.detachEventStream(initialized.sessionId, firstCollector);

  const queuedEvents = controller.listQueuedDisconnectEvents(initialized.sessionId);
  assert.equal(queuedEvents.length, 1);
  assert.equal(queuedEvents[0].event, "disconnect.policy.queued");
  assert.equal(queuedEvents[0].payload.policy, "queue");

  const secondCollector = createEventCollector();
  controller.attachEventStream(initialized.sessionId, secondCollector);

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
  controller.attachEventStream(initialized.sessionId, collector);
  controller.detachEventStream(initialized.sessionId, collector);

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
