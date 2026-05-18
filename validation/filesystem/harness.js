import { rmSync } from "node:fs";
import { Writable } from "node:stream";

import { createFilesystemValidationApplication } from "../../examples/shared/filesystem-validation-server.js";
import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
} from "../../packages/transports/http-sse/gateway-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";
import {
  createFilesystemValidationWorkspace,
  describeFilesystemValidationFile,
  snapshotFilesystemValidationWorkspace,
} from "./workspace.js";

export async function runFilesystemValidation({
  rootDir = createFilesystemValidationWorkspace("filesystem-headless"),
  cleanup = false,
} = {}) {
  try {
    const stdioServer = createFilesystemValidationApplication({
      rootDir,
      serverInstanceId: "stdio-filesystem-a",
    });
    const stdioOutput = createStringCollector();
    const stdioTransport = new StdioTransportAdapter({
      server: stdioServer,
      output: stdioOutput,
    });

    const gatewayController = createHttpSseGatewayController({
      serverInstances: [
        { serverInstanceId: "fs-a", load: 0.1, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "fs-b", load: 0.2, healthy: true, acceptingNewSessions: true },
      ],
      createApplication: ({ serverInstanceId }) =>
        createFilesystemValidationApplication({ rootDir, serverInstanceId }),
    });
    const httpHandler = createGatewayHttpHandler({ controller: gatewayController });

    const stdioInitialize = await sendStdioMessage(stdioTransport, {
      id: 1,
      method: "initialize",
    });
    const stdioTools = await sendStdioMessage(stdioTransport, {
      id: 2,
      method: "tools/list",
    });
    const stdioWrite = await sendStdioMessage(stdioTransport, {
      id: 3,
      method: "tools/call",
      params: {
        name: "fs_write_text",
        arguments: {
          path: "notes/hello.txt",
          content: "filesystem validation works",
        },
      },
    });

    const httpInitialize = await sendHttpMessage(httpHandler, {
      method: "initialize",
      params: { clientId: "filesystem-http-client" },
    });
    const httpRead = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "fs_read_text",
        arguments: {
          path: "notes/hello.txt",
        },
      },
    });
    const httpList = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "fs_list",
        arguments: {
          path: "notes",
        },
      },
    });
    const stickyEcho = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "fs_stat",
        arguments: {
          path: "notes/hello.txt",
        },
      },
    });

    gatewayController.upsertInstance({
      serverInstanceId: httpInitialize.serverInstanceId,
      load: 0.95,
      healthy: false,
      acceptingNewSessions: false,
    });
    const reassignedRead = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "fs_read_text",
        arguments: {
          path: "notes/hello.txt",
        },
      },
    });

    return {
      ok: true,
      rootDir,
      createdFile: describeFilesystemValidationFile(rootDir),
      workspaceSnapshot: snapshotFilesystemValidationWorkspace(rootDir),
      stdio: {
        initialize: stdioInitialize,
        toolNames: stdioTools.result.tools.map((tool) => tool.name).sort(),
        writeResult: stdioWrite.result.structuredContent,
      },
      http: {
        initialize: httpInitialize,
        readResult: httpRead.result.structuredContent,
        listResult: httpList.result.structuredContent,
        stickyServerInstanceId: stickyEcho.serverInstanceId,
        reassignedServerInstanceId: reassignedRead.serverInstanceId,
        reassignedReadResult: reassignedRead.result.structuredContent,
      },
      observability: gatewayController.describeObservability(),
    };
  } finally {
    if (cleanup) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  }
}

async function sendStdioMessage(transport, message) {
  const response = await transport.handleFrame(JSON.stringify({
    jsonrpc: "2.0",
    ...message,
  }));
  return response;
}

async function sendHttpMessage(handler, body) {
  const response = await invokeHttpHandler(handler, {
    method: "POST",
    url: "/message",
    headers: { host: "127.0.0.1:3000" },
    body,
  });

  if (response.statusCode !== 200) {
    throw new Error(`Expected HTTP 200, received ${response.statusCode}: ${response.body}`);
  }

  return JSON.parse(response.body);
}

async function invokeHttpHandler(handler, { method, url, headers = {}, body } = {}) {
  const request = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };

  let statusCode = 200;
  const responseHeaders = {};
  let payload = "";
  const response = {
    writeHead(nextStatusCode, nextHeaders = {}) {
      statusCode = nextStatusCode;
      Object.assign(responseHeaders, nextHeaders);
    },
    end(chunk = "") {
      payload += String(chunk);
    },
  };

  await handler(request, response);

  return {
    statusCode,
    headers: responseHeaders,
    body: payload,
  };
}

function createStringCollector() {
  const collector = new Writable({
    write(chunk, _encoding, callback) {
      collector.value += chunk.toString();
      callback();
    },
  });
  collector.value = "";
  return collector;
}
