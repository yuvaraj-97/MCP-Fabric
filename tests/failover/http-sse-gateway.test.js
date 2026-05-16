import assert from "node:assert/strict";
import test from "node:test";

import { createHttpSseGatewayServer } from "../../packages/transports/http-sse/gateway-server.js";

test("HTTP/SSE gateway keeps a session sticky and exposes SSE events", async (t) => {
  const gateway = createHttpSseGatewayServer({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1 },
      { serverInstanceId: "server-b", load: 0.2 },
    ],
  });

  const address = await gateway.listen(0);
  t.after(async () => {
    await gateway.close();
  });

  const initialized = await sendHttpMessage(address.port, {
    method: "initialize",
    params: { clientId: "sse-test" },
  });

  const eventCollector = createSseCollector(address.port, initialized.sessionId);
  await eventCollector.waitForEvent("connected");

  const echoed = await sendHttpMessage(address.port, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "sticky session" },
  });

  assert.equal(initialized.serverInstanceId, "server-a");
  assert.equal(echoed.serverInstanceId, "server-a");
  assert.equal(echoed.reusedExistingSession, true);

  const requestEvent = await eventCollector.waitForEvent("request.received");
  const responseEvent = await eventCollector.waitForEvent("response.ready");
  const routeEvent = await eventCollector.waitForEvent("route.selected");

  assert.equal(requestEvent.payload.message, "sticky session");
  assert.equal(responseEvent.payload.requestCount, 1);
  assert.equal(routeEvent.serverInstanceId, "server-a");

  eventCollector.close();
});

test("HTTP/SSE gateway reassigns the session when the original instance becomes unhealthy", async (t) => {
  const gateway = createHttpSseGatewayServer({
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
    ],
  });

  const address = await gateway.listen(0);
  t.after(async () => {
    await gateway.close();
  });

  const initialized = await sendHttpMessage(address.port, {
    method: "initialize",
    params: { clientId: "failover-test" },
  });

  await sendInstanceUpdate(address.port, {
    serverInstanceId: initialized.serverInstanceId,
    load: 0.9,
    healthy: false,
    acceptingNewSessions: false,
  });

  const echoed = await sendHttpMessage(address.port, {
    method: "echo",
    sessionId: initialized.sessionId,
    params: { message: "reroute me" },
  });

  assert.equal(echoed.serverInstanceId, "server-b");
  assert.equal(echoed.reusedExistingSession, false);
});

async function sendHttpMessage(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 200);
  return response.json();
}

async function sendInstanceUpdate(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/instances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 200);
  return response.json();
}

function createSseCollector(port, sessionId) {
  const controller = new AbortController();
  const queue = [];
  const waiters = [];

  const promise = fetch(`http://127.0.0.1:${port}/events?sessionId=${encodeURIComponent(sessionId)}`, {
    signal: controller.signal,
    headers: { Accept: "text/event-stream" },
  }).then(async (response) => {
    assert.equal(response.status, 200);
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });

      while (buffer.includes("\n\n")) {
        const boundary = buffer.indexOf("\n\n");
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const parsed = parseSseEvent(rawEvent);
        queue.push(parsed);
        flushWaiters();
      }
    }
  });

  return {
    close() {
      controller.abort();
      return promise.catch(() => {});
    },
    waitForEvent(name) {
      const existing = queue.find((event) => event.event === name);
      if (existing) {
        return Promise.resolve(existing.data);
      }

      return new Promise((resolve) => {
        waiters.push({ name, resolve });
      });
    },
  };

  function flushWaiters() {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      const matchIndex = queue.findIndex((event) => event.event === waiter.name);
      if (matchIndex === -1) {
        continue;
      }

      const [match] = queue.splice(matchIndex, 1);
      waiters.splice(index, 1);
      index -= 1;
      waiter.resolve(match.data);
    }
  }
}

function parseSseEvent(rawEvent) {
  const eventLine = rawEvent
    .split("\n")
    .find((line) => line.startsWith("event:"));
  const dataLine = rawEvent
    .split("\n")
    .find((line) => line.startsWith("data:"));

  return {
    event: eventLine.slice("event:".length).trim(),
    data: JSON.parse(dataLine.slice("data:".length).trim()),
  };
}
