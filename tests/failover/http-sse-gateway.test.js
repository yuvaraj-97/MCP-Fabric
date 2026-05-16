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
