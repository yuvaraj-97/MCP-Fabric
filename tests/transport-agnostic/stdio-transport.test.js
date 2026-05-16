import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";

import { createScalingDemoServer } from "../../examples/shared/scaling-demo-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";

test("stdio adapter returns MCP responses for valid JSON-RPC messages", async () => {
  const server = createScalingDemoServer();
  const output = createStringCollector();
  const transport = new StdioTransportAdapter({
    server,
    output,
  });

  const response = await transport.handleFrame(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "sum_load",
        arguments: {
          loads: [0.2, 0.15, 0.4],
        },
      },
    }),
    {
      sessionId: "stdio-session-1",
      clientId: "cli-user",
      transport: "stdio",
    },
  );

  assert.equal(response.result.structuredContent.totalLoad, 0.75);
  assert.equal(output.value, "");
});

test("stdio adapter converts parse failures into JSON-RPC parse errors", async () => {
  const server = createScalingDemoServer();
  const error = createStringCollector();
  const transport = new StdioTransportAdapter({
    server,
    error,
  });

  const response = await transport.handleFrame("{not-json");

  assert.equal(response.error.code, -32700);
  assert.match(error.value, /Invalid JSON input/);
});

test("stdio adapter streams Content-Length framed responses when started", async () => {
  const server = createScalingDemoServer();
  const input = new PassThrough();
  const output = createStringCollector();
  const transport = new StdioTransportAdapter({
    server,
    input,
    output,
  }).start();

  const requestPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 21,
    method: "ping",
  });
  input.write(`Content-Length: ${Buffer.byteLength(requestPayload, "utf8")}\r\n\r\n${requestPayload}`);

  await waitFor(() => output.value.includes("Content-Length:"));

  transport.stop();

  const parsed = readFramedMessage(output.value);
  assert.equal(parsed.result.ok, true);
  assert.equal(parsed.result.session.transport, "stdio");
});

function createStringCollector() {
  const collector = new Writable({
    write(chunk, encoding, callback) {
      collector.value += chunk.toString();
      callback();
    },
  });
  collector.value = "";
  return collector;
}

async function waitFor(predicate, timeoutMs = 200) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for stdio output");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readFramedMessage(raw) {
  const separatorIndex = raw.indexOf("\r\n\r\n");
  assert.notEqual(separatorIndex, -1);
  const payload = raw.slice(separatorIndex + 4);
  return JSON.parse(payload);
}
