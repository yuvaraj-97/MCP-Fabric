import assert from "node:assert/strict";
import test from "node:test";

import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
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
