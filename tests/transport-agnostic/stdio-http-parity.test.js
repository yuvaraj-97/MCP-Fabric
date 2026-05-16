import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
} from "../../packages/transports/http-sse/gateway-server.js";
import { startStdioServer } from "../../packages/transports/stdio/stdio-server.js";
import { invokeHttpHandler, parseJsonBody } from "../helpers/http-handler-harness.js";

test("stdio and HTTP/SSE expose the same initialize and echo behavior", async (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  const stdio = startStdioServer({
    input,
    output,
    error,
    serverInstanceId: "server-a",
  });
  t.after(() => stdio.close());

  const controller = createHttpSseGatewayController({
    serverInstances: [{ serverInstanceId: "server-a", load: 0.1 }],
  });
  const handler = createGatewayHttpHandler({ controller });

  const stdioInitialize = await sendStdioMessage(stdio, {
    id: 1,
    method: "initialize",
    params: { clientId: "parity-client" },
    input,
    output,
  });

  const stdioEcho = await sendStdioMessage(stdio, {
    id: 2,
    method: "echo",
    sessionId: stdioInitialize.result.sessionId,
    params: { message: "hello parity" },
    input,
    output,
  });

  const httpInitialize = await sendHttpMessage(handler, {
    method: "initialize",
    params: { clientId: "parity-client" },
  });

  const httpEcho = await sendHttpMessage(handler, {
    method: "echo",
    sessionId: httpInitialize.sessionId,
    params: { message: "hello parity" },
  });

  assert.deepEqual(stdioInitialize.result.capabilities, httpInitialize.result.capabilities);
  assert.equal(stdioEcho.result.message, httpEcho.result.message);
  assert.equal(stdioEcho.result.requestCount, httpEcho.result.requestCount);
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

async function sendStdioMessage(server, payload) {
  const { input, output, ...message } = payload;
  input.write(`${JSON.stringify(message)}\n`);
  return waitForMessage(output, (candidate) => candidate.id === message.id);
}

function waitForMessage(stream, predicate) {
  return new Promise((resolve) => {
    let buffer = "";

    function onData(chunk) {
      buffer += String(chunk);
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";

      for (const line of parts) {
        if (!line.trim()) {
          continue;
        }

        const message = JSON.parse(line);
        if (!predicate(message)) {
          continue;
        }

        stream.off("data", onData);
        resolve(message);
        return;
      }
    }

    stream.on("data", onData);
  });
}
