import assert from "node:assert/strict";
import test from "node:test";

import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
  createHttpSseGatewayServer,
} from "../../packages/transports/http-sse/gateway-server.js";
import {
  invokeHttpHandler,
  parseJsonBody,
  parseSseEvents,
} from "../helpers/http-handler-harness.js";

test("HTTP/SSE gateway keeps a session sticky and exposes SSE events", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1 },
      { serverInstanceId: "server-b", load: 0.2 },
    ],
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    params: { clientId: "sse-test" },
  });
  assert.equal(initialized.recovery.action, "new-session");

  const eventStream = await invokeHttpHandler(handler, {
    method: "GET",
    url: `/events?sessionId=${encodeURIComponent(initialized.sessionId)}`,
    headers: { host: "127.0.0.1:3000", accept: "text/event-stream" },
  });
  assert.equal(eventStream.statusCode, 200);
  assert.equal(eventStream.headers["Content-Type"], "text/event-stream");
  const initialEvents = parseSseEvents(eventStream.body);
  assert.equal(initialEvents[0].event, "connected");

  const echoed = await sendHttpMessage(handler, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "sticky session" },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(echoed.serverInstanceId, "server-a");
  assert.equal(echoed.reusedExistingSession, true);
  assert.equal(echoed.recovery.action, "sticky-existing-session");

  const allEvents = parseSseEvents(eventStream.body);
  const requestEvent = allEvents.find((event) => event.event === "request.received").data;
  const responseEvent = allEvents.find((event) => event.event === "response.ready").data;
  const routeEvent = allEvents.find((event) => event.event === "route.selected").data;

  assert.equal(requestEvent.payload.message, "sticky session");
  assert.equal(responseEvent.payload.requestCount, 1);
  assert.equal(routeEvent.serverInstanceId, "server-a");
  eventStream.close();
});

test("HTTP/SSE gateway reassigns the session when the original instance becomes unhealthy", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    params: { clientId: "failover-test" },
  });

  await sendInstanceUpdate(handler, {
    serverInstanceId: initialized.serverInstanceId,
    load: 0.9,
    healthy: false,
    acceptingNewSessions: false,
  });

  const echoed = await sendHttpMessage(handler, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "reroute me" },
  });

  assert.equal(echoed.serverInstanceId, "server-b");
  assert.equal(echoed.reusedExistingSession, false);
  assert.equal(echoed.recovery.action, "reassigned-and-rehydrated");
});

test("HTTP/SSE gateway exposes explicit stateless runtime mode decisions", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    sessionId: "http-stateless",
    params: {
      clientId: "http-stateless-test",
      runtimeMode: "stateless",
    },
  });

  await sendInstanceUpdate(handler, {
    serverInstanceId: "server-a",
    load: 0.6,
    healthy: true,
    acceptingNewSessions: true,
  });
  await sendInstanceUpdate(handler, {
    serverInstanceId: "server-b",
    load: 0.1,
    healthy: true,
    acceptingNewSessions: true,
  });

  const echoed = await sendHttpMessage(handler, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "stateless over http" },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(initialized.runtimeMode, "stateless");
  assert.equal(echoed.serverInstanceId, "server-b");
  assert.equal(echoed.reusedExistingSession, false);
  assert.equal(echoed.runtimeMode, "stateless");

  const observability = await invokeHttpHandler(handler, {
    method: "GET",
    url: "/observability",
    headers: { host: "127.0.0.1:3000" },
  });
  const payload = parseJsonBody(observability);
  assert.ok(
    payload.recentEvents.some(
      (event) => event.eventType === "route.completed" && event.runtimeMode === "stateless",
    ),
  );
});

test("HTTP/SSE gateway rejects unsupported runtime modes with a client error", async () => {
  const controller = createHttpSseGatewayController();
  const handler = createGatewayHttpHandler({ controller });

  const response = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/message",
    headers: { host: "127.0.0.1:3000" },
    body: {
      method: "initialize",
      sessionId: "http-invalid-mode",
      params: {
        clientId: "invalid-mode-test",
        runtimeMode: "pinned",
      },
    },
  });

  assert.equal(response.statusCode, 400);
  const payload = parseJsonBody(response);
  assert.equal(payload.code, "invalid-runtime-mode");
});

test("HTTP/SSE gateway exposes recommendation-only classifier diagnostics", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    sessionId: "http-recommendation",
    params: {
      clientId: "http-recommendation-test",
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
  assert.equal(initialized.runtimeRecommendation.automaticPlacement, false);

  const echoed = await sendHttpMessage(handler, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: {
      message: "recommend only",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(echoed.serverInstanceId, initialized.serverInstanceId);
  assert.equal(echoed.reusedExistingSession, true);
  assert.equal(echoed.runtimeRecommendation.recommendedMode, "stateless");

  const observability = await invokeHttpHandler(handler, {
    method: "GET",
    url: "/observability",
    headers: { host: "127.0.0.1:3000" },
  });
  const payload = parseJsonBody(observability);
  assert.ok(payload.summary.totalRuntimeRecommendations >= 2);
  assert.ok(
    payload.recentEvents.some(
      (event) =>
        event.eventType === "route.completed" &&
        event.runtimeRecommendation.recommendedMode === "stateless" &&
        event.runtimeMode === "sticky",
    ),
  );
});

test("HTTP/SSE gateway exposes adaptive placement response and observability over HTTP", async () => {
  const controller = createHttpSseGatewayController({
    operatorConfig: { adaptivePlacementEnabled: true },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    sessionId: "http-adaptive-quality",
    params: {
      clientId: "http-adaptive-quality-test",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  assert.equal(initialized.runtimeMode, "stateless");
  assert.equal(initialized.runtimeRecommendation.phase, "adaptive-placement");
  assert.equal(initialized.runtimeRecommendation.adaptivePlacement.applied, true);
  assert.equal(
    initialized.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    "adaptive-classifier",
  );

  await sendHttpMessage(handler, {
    method: "initialize",
    sessionId: "http-adaptive-fallback",
    params: {
      clientId: "http-adaptive-fallback-test",
      runtimeMode: "sticky",
      runtimeHints: {
        replaySafe: true,
        readOnly: true,
        externalState: true,
      },
    },
  });

  const observability = await invokeHttpHandler(handler, {
    method: "GET",
    url: "/observability",
    headers: { host: "127.0.0.1:3000" },
  });
  const payload = parseJsonBody(observability);
  assert.equal(payload.operatorConfig.adaptivePlacementEnabled, true);
  assert.equal(payload.summary.totalAdaptivePlacementStateless, 1);
  assert.equal(payload.summary.totalAdaptivePlacementFallbacks, 1);
  assert.equal(typeof payload.summary.totalAdaptivePlacementMismatches, "number");
  assert.ok(
    payload.recentEvents.some(
      (event) =>
        event.eventType === "adaptive.placement.fallback" &&
        event.runtimeModeSource === "explicit" &&
        event.clientId === "http-adaptive-fallback-test",
    ),
  );
});

test("HTTP/SSE gateway treats malformed runtime hints as diagnostics only", async () => {
  const controller = createHttpSseGatewayController();
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    sessionId: "http-invalid-hints",
    params: {
      clientId: "invalid-hints-test",
      runtimeHints: {
        runtimeDurationMs: -1,
      },
    },
  });

  assert.equal(initialized.runtimeMode, "sticky");
  assert.deepEqual(initialized.runtimeRecommendation.signals.invalidHints, [
    "runtimeDurationMs",
  ]);
  assert.ok(
    initialized.runtimeRecommendation.reasons.some(
      (reason) => reason.code === "invalid-runtime-hints-ignored",
    ),
  );
});

test("HTTP/SSE gateway reconnects within grace and rejects reconnects after grace expiry", async () => {
  const clock = createClock();
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    sessionTtlMs: 5_000,
    reconnectGracePeriodMs: 100,
    now: clock.now,
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    params: { clientId: "grace-http-test" },
  });

  const eventStream = await invokeHttpHandler(handler, {
    method: "GET",
    url: `/events?sessionId=${encodeURIComponent(initialized.sessionId)}`,
    headers: { host: "127.0.0.1:3000", accept: "text/event-stream" },
  });
  eventStream.close();

  clock.advance(50);
  const withinGrace = await sendHttpMessage(handler, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "back in time" },
  });
  assert.equal(withinGrace.recovery.action, "reconnected-within-grace-period");

  const secondEventStream = await invokeHttpHandler(handler, {
    method: "GET",
    url: `/events?sessionId=${encodeURIComponent(initialized.sessionId)}`,
    headers: { host: "127.0.0.1:3000", accept: "text/event-stream" },
  });
  secondEventStream.close();

  clock.advance(101);
  const expiredReconnect = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/message",
    headers: { host: "127.0.0.1:3000" },
    body: {
      method: "echo",
      sessionId: initialized.sessionId,
      params: { message: "too late" },
    },
  });

  assert.equal(expiredReconnect.statusCode, 410);
  const payload = parseJsonBody(expiredReconnect);
  assert.equal(payload.code, "reconnect-grace-expired");
});

test("HTTP/SSE gateway flushes queued disconnect events when onDisconnect=queue", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    operatorConfig: {
      onDisconnect: "queue",
    },
  });
  const handler = createGatewayHttpHandler({ controller });

  const initialized = await sendHttpMessage(handler, {
    method: "initialize",
    sessionId: "http-queue-policy",
    params: { clientId: "http-queue-test" },
  });

  const firstStream = await invokeHttpHandler(handler, {
    method: "GET",
    url: `/events?sessionId=${encodeURIComponent(initialized.sessionId)}`,
    headers: { host: "127.0.0.1:3000", accept: "text/event-stream" },
  });
  firstStream.close();

  const secondStream = await invokeHttpHandler(handler, {
    method: "GET",
    url: `/events?sessionId=${encodeURIComponent(initialized.sessionId)}`,
    headers: { host: "127.0.0.1:3000", accept: "text/event-stream" },
  });

  const replayedEvents = parseSseEvents(secondStream.body);
  assert.ok(replayedEvents.some((event) => event.event === "disconnect.policy.queued"));
  secondStream.close();
});

test("HTTP/SSE gateway exposes operator observability over HTTP", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
    operatorConfig: {
      onDisconnect: "queue",
    },
  });
  const handler = createGatewayHttpHandler({ controller });

  await sendHttpMessage(handler, {
    method: "initialize",
    params: { clientId: "obs-http-test" },
  }).then((initialized) => {
    assert.equal(initialized.recovery.registry.onDisconnect, "queue");
  });

  const response = await invokeHttpHandler(handler, {
    method: "GET",
    url: "/observability",
    headers: { host: "127.0.0.1:3000" },
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJsonBody(response);
  assert.ok(payload.summary.totalRequests >= 1);
  assert.ok(payload.recentEvents.some((event) => event.eventType === "request.received"));
});

test("HTTP/SSE gateway rejects request bodies above 1MB", async () => {
  const controller = createHttpSseGatewayController();
  const handler = createGatewayHttpHandler({ controller });

  const response = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/message",
    headers: { host: "127.0.0.1:3000" },
    body: `{"method":"initialize","params":{"payload":"${"x".repeat(1_048_576)}"}}`,
  });

  assert.equal(response.statusCode, 413);
  const payload = parseJsonBody(response);
  assert.equal(payload.code, "request-body-too-large");
});

test("HTTP/SSE gateway tolerates SSE write failures and drops the failed stream", async () => {
  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1, healthy: true }],
  });

  const initialized = await controller.handleGatewayMessage({
    method: "initialize",
    sessionId: "write-failure-session",
    params: { clientId: "write-failure-test" },
  });
  const brokenStream = {
    writes: 0,
    destroyed: false,
    write() {
      this.writes += 1;
      if (this.writes > 1) {
        throw new Error("socket closed");
      }
    },
    destroy() {
      this.destroyed = true;
    },
  };

  await controller.attachEventStream(initialized.sessionId, brokenStream);
  await controller.handleGatewayMessage({
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "publish through broken stream" },
  });

  assert.equal(brokenStream.destroyed, true);
  assert.equal(controller.listPublishedEvents(initialized.sessionId).length, 0);
});

test("HTTP/SSE gateway installs HTTP server error handlers", () => {
  const logs = [];
  const gateway = createHttpSseGatewayServer({
    auditLogger: {
      error(...args) {
        logs.push(args);
      },
    },
  });
  const socketWrites = [];
  const socket = {
    writable: true,
    end(chunk) {
      socketWrites.push(chunk);
    },
  };

  assert.doesNotThrow(() => gateway.server.emit("error", new Error("listen failed")));
  assert.doesNotThrow(() => gateway.server.emit("clientError", new Error("bad request"), socket));
  assert.equal(logs.length, 2);
  assert.match(socketWrites[0], /400 Bad Request/);
});

test("HTTP/SSE gateway closes the session registry when startup audit fails", async () => {
  let closed = false;
  const gateway = createHttpSseGatewayServer({
    sessionRegistry: {
      assign() {},
      get() {},
      list() {
        return [];
      },
      close() {
        closed = true;
      },
    },
    fetchImpl: async () => ({ ok: true }),
    auditLogger: {
      error() {},
    },
  });

  await assert.rejects(() =>
    gateway.listen({
      port: 0,
      host: "0.0.0.0",
      allowPublicBind: true,
      enforceStartupSecurityAudit: true,
    }),
  );
  assert.equal(closed, true);
});

async function sendHttpMessage(handler, body) {
  const response = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/message",
    headers: { host: "127.0.0.1:3000" },
    body,
  });

  assert.equal(response.statusCode, 200);
  return parseJsonBody(response);
}

async function sendInstanceUpdate(handler, body) {
  const response = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/instances",
    headers: { host: "127.0.0.1:3000" },
    body,
  });

  assert.equal(response.statusCode, 200);
  return parseJsonBody(response);
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
