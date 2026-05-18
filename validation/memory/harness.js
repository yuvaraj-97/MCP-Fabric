import { createMemoryValidationApplication, createMemoryValidationStore } from "../../examples/shared/memory-validation-server.js";
import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
} from "../../packages/transports/http-sse/gateway-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";

export async function runMemoryValidation() {
  const store = createMemoryValidationStore();
  const stdioServer = createMemoryValidationApplication({
    store,
    serverInstanceId: "stdio-memory-a",
  });
  const stdioTransport = new StdioTransportAdapter({
    server: stdioServer,
    output: createNullCollector(),
  });

  const gatewayController = createHttpSseGatewayController({
    serverInstances: [
      { serverInstanceId: "mem-a", load: 0.1, healthy: true, acceptingNewSessions: true },
      { serverInstanceId: "mem-b", load: 0.2, healthy: true, acceptingNewSessions: true },
    ],
    createApplication: ({ serverInstanceId }) =>
      createMemoryValidationApplication({
        store,
        serverInstanceId,
      }),
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
  const stdioRemember = await sendStdioMessage(stdioTransport, {
    id: 3,
    method: "tools/call",
    params: {
      name: "memory_remember",
      arguments: {
        namespace: "operators",
        key: "primary-contact",
        value: "Asha manages the gateway rollout.",
      },
    },
  });

  const httpInitialize = await sendHttpMessage(httpHandler, {
    method: "initialize",
    params: { clientId: "memory-http-client" },
  });
  const httpRecall = await sendHttpMessage(httpHandler, {
    method: "tools/call",
    sessionId: httpInitialize.sessionId,
    params: {
      name: "memory_recall",
      arguments: {
        namespace: "operators",
        key: "primary-contact",
      },
    },
  });
  const httpList = await sendHttpMessage(httpHandler, {
    method: "tools/call",
    sessionId: httpInitialize.sessionId,
    params: {
      name: "memory_list",
      arguments: {
        namespace: "operators",
      },
    },
  });
  const stickyRecall = await sendHttpMessage(httpHandler, {
    method: "tools/call",
    sessionId: httpInitialize.sessionId,
    params: {
      name: "memory_recall",
      arguments: {
        namespace: "operators",
        key: "primary-contact",
      },
    },
  });

  gatewayController.upsertInstance({
    serverInstanceId: httpInitialize.serverInstanceId,
    load: 0.98,
    healthy: false,
    acceptingNewSessions: false,
  });
  const reassignedRecall = await sendHttpMessage(httpHandler, {
    method: "tools/call",
    sessionId: httpInitialize.sessionId,
    params: {
      name: "memory_recall",
      arguments: {
        namespace: "operators",
        key: "primary-contact",
      },
    },
  });

  return {
    ok: true,
    namespace: "operators",
    key: "primary-contact",
    stdio: {
      initialize: stdioInitialize,
      toolNames: stdioTools.result.tools.map((tool) => tool.name).sort(),
      rememberResult: stdioRemember.result.structuredContent,
    },
    http: {
      initialize: httpInitialize,
      recallResult: httpRecall.result.structuredContent,
      listResult: httpList.result.structuredContent,
      stickyServerInstanceId: stickyRecall.serverInstanceId,
      reassignedServerInstanceId: reassignedRecall.serverInstanceId,
      reassignedRecallResult: reassignedRecall.result.structuredContent,
    },
    storeSnapshot: store.snapshot(),
    observability: gatewayController.describeObservability(),
  };
}

async function sendStdioMessage(transport, message) {
  return transport.handleFrame(JSON.stringify({
    jsonrpc: "2.0",
    ...message,
  }));
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

function createNullCollector() {
  return {
    write() {},
  };
}
