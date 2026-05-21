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

test("stdio adapter parses multi-byte UTF-8 payloads using Content-Length bytes", async () => {
  const server = createEchoServer();
  const input = new PassThrough();
  const output = createStringCollector();
  const transport = new StdioTransportAdapter({
    server,
    input,
    output,
  }).start();

  const firstPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 31,
    method: "echo",
    params: {
      message: "hello 🌍 नमस्ते",
    },
  });
  const secondPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 32,
    method: "echo",
    params: {
      message: "boundary-ok",
    },
  });

  input.write(createFrame(firstPayload));
  input.write(createFrame(secondPayload));

  await waitFor(() => readFramedMessages(output.value).length === 2);

  transport.stop();

  const [first, second] = readFramedMessages(output.value);
  assert.equal(first.result.message, "hello 🌍 नमस्ते");
  assert.equal(second.result.message, "boundary-ok");
});

test("stdio adapter waits for complete frame when chunk splits inside multi-byte characters", async () => {
  const server = createEchoServer();
  const input = new PassThrough();
  const output = createStringCollector();
  const transport = new StdioTransportAdapter({
    server,
    input,
    output,
  }).start();

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 41,
    method: "echo",
    params: {
      message: "split 🔧 frame",
    },
  });
  const frame = Buffer.from(createFrame(payload), "utf8");
  const splitAt = frame.indexOf(Buffer.from("🔧", "utf8")) + 1;

  input.write(frame.subarray(0, splitAt));
  assert.equal(output.value, "");

  input.write(frame.subarray(splitAt));

  await waitFor(() => output.value.includes("Content-Length:"));

  transport.stop();

  const [parsed] = readFramedMessages(output.value);
  assert.equal(parsed.result.message, "split 🔧 frame");
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

function createEchoServer() {
  return {
    async handleMessage(message) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          message: message.params?.message,
        },
      };
    },
  };
}

function createFrame(payload) {
  return `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
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
  return readFramedMessages(raw)[0];
}

function readFramedMessages(raw) {
  const messages = [];
  let remaining = raw;

  while (remaining.length > 0) {
    const separatorIndex = remaining.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      break;
    }

    const headerBlock = remaining.slice(0, separatorIndex);
    const contentLengthMatch = headerBlock.match(/Content-Length:\s*(\d+)/i);
    assert.ok(contentLengthMatch);

    const bodyStart = separatorIndex + 4;
    const bodyBuffer = Buffer.from(remaining.slice(bodyStart), "utf8");
    const contentLength = Number(contentLengthMatch[1]);
    if (bodyBuffer.length < contentLength) {
      break;
    }

    const payload = bodyBuffer.subarray(0, contentLength).toString("utf8");
    messages.push(JSON.parse(payload));
    remaining = bodyBuffer.subarray(contentLength).toString("utf8");
  }

  return messages;
}
