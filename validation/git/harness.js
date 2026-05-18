import { rmSync } from "node:fs";
import { Writable } from "node:stream";

import { createGitValidationApplication } from "../../examples/shared/git-validation-server.js";
import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
} from "../../packages/transports/http-sse/gateway-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";
import {
  createGitValidationWorkspace,
  describeGitValidationFile,
  snapshotGitValidationWorkspace,
} from "./workspace.js";

export async function runGitValidation({
  rootDir = createGitValidationWorkspace("git-headless"),
  cleanup = false,
} = {}) {
  try {
    const stdioServer = createGitValidationApplication({
      rootDir,
      serverInstanceId: "stdio-git-a",
    });
    const stdioOutput = createStringCollector();
    const stdioTransport = new StdioTransportAdapter({
      server: stdioServer,
      output: stdioOutput,
    });

    const gatewayController = createHttpSseGatewayController({
      serverInstances: [
        { serverInstanceId: "git-a", load: 0.1, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "git-b", load: 0.2, healthy: true, acceptingNewSessions: true },
      ],
      createApplication: ({ serverInstanceId }) =>
        createGitValidationApplication({ rootDir, serverInstanceId }),
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
        name: "git_write_file",
        arguments: {
          path: "notes/hello.txt",
          content: "git validation works",
        },
      },
    });

    const httpInitialize = await sendHttpMessage(httpHandler, {
      method: "initialize",
      params: { clientId: "git-http-client" },
    });
    const httpStatusBeforeStage = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "git_status",
        arguments: {},
      },
    });
    const httpStage = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "git_stage_paths",
        arguments: {
          paths: ["notes/hello.txt"],
        },
      },
    });
    const stickyDiff = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "git_diff_cached",
        arguments: {},
      },
    });

    gatewayController.upsertInstance({
      serverInstanceId: httpInitialize.serverInstanceId,
      load: 0.95,
      healthy: false,
      acceptingNewSessions: false,
    });
    const reassignedStatus = await sendHttpMessage(httpHandler, {
      method: "tools/call",
      sessionId: httpInitialize.sessionId,
      params: {
        name: "git_status",
        arguments: {},
      },
    });

    return {
      ok: true,
      rootDir,
      createdFile: describeGitValidationFile(rootDir),
      workspaceSnapshot: snapshotGitValidationWorkspace(rootDir),
      stdio: {
        initialize: stdioInitialize,
        toolNames: stdioTools.result.tools.map((tool) => tool.name).sort(),
        writeResult: stdioWrite.result.structuredContent,
      },
      http: {
        initialize: httpInitialize,
        statusBeforeStage: httpStatusBeforeStage.result.structuredContent,
        stageResult: httpStage.result.structuredContent,
        stickyServerInstanceId: stickyDiff.serverInstanceId,
        stickyDiffResult: stickyDiff.result.structuredContent,
        reassignedServerInstanceId: reassignedStatus.serverInstanceId,
        reassignedStatusResult: reassignedStatus.result.structuredContent,
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
  return transport.handleFrame(
    JSON.stringify({
      jsonrpc: "2.0",
      ...message,
    }),
  );
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
