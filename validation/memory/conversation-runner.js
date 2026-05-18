import { createMemoryValidationApplication, createMemoryValidationStore } from "../../examples/shared/memory-validation-server.js";
import {
  createGatewayHttpHandler,
  createHttpSseGatewayController,
} from "../../packages/transports/http-sse/gateway-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";

export class MemoryConversationRunner {
  #store;
  #stdioTransport;
  #httpController;
  #httpHandler;
  #state;

  constructor() {
    this.reset();
  }

  reset() {
    this.#store = createMemoryValidationStore();
    this.#state = {
      httpSessionId: null,
      initialHttpServerInstanceId: null,
      latestHttpServerInstanceId: null,
      stepResults: new Map(),
    };

    this.#stdioTransport = new StdioTransportAdapter({
      server: createMemoryValidationApplication({
        store: this.#store,
        serverInstanceId: "stdio-memory-a",
      }),
      output: createNullCollector(),
    });

    this.#httpController = createHttpSseGatewayController({
      serverInstances: [
        { serverInstanceId: "mem-a", load: 0.1, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "mem-b", load: 0.2, healthy: true, acceptingNewSessions: true },
      ],
      createApplication: ({ serverInstanceId }) =>
        createMemoryValidationApplication({
          store: this.#store,
          serverInstanceId,
        }),
    });
    this.#httpHandler = createGatewayHttpHandler({ controller: this.#httpController });

    return this.getState();
  }

  describe() {
    return {
      id: "memory-conversation",
      targetId: "memory",
      targetLabel: "Memory",
      title: "Memory Conversation Validation",
      audience:
        "Validates that a memory-style MCP application preserves shared facts across stdio and gateway-backed HTTP/SSE requests, including sticky routing and unhealthy failover.",
      steps: stepDefinitions().map((step) => ({
        id: step.id,
        title: step.title,
        transport: step.transport,
        userPrompt: step.userPrompt,
        whatTesting: step.whatTesting,
        expected: step.expected,
        completed: this.#state.stepResults.has(step.id),
      })),
    };
  }

  getState() {
    const description = this.describe();
    return {
      ...description,
      storeSnapshot: this.#store.snapshot(),
      observability: this.#httpController.describeObservability(),
      results: description.steps
        .filter((step) => this.#state.stepResults.has(step.id))
        .map((step) => this.#state.stepResults.get(step.id)),
    };
  }

  async runStep(stepId) {
    const step = stepDefinitions().find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new Error(`Unknown validation step: ${stepId}`);
    }

    const result = await step.execute(this);
    const record = {
      id: step.id,
      title: step.title,
      transport: step.transport,
      userPrompt: step.userPrompt,
      whatTesting: step.whatTesting,
      expected: step.expected,
      ...result,
      outputs: {
        ...(result.outputs || {}),
        storeSnapshot: this.#store.snapshot(),
      },
    };
    this.#state.stepResults.set(step.id, record);
    return {
      result: record,
      state: this.getState(),
    };
  }

  async sendStdio(message) {
    return this.#stdioTransport.handleFrame(
      JSON.stringify({
        jsonrpc: "2.0",
        ...message,
      }),
    );
  }

  async sendHttp(body) {
    const response = await invokeHttpHandler(this.#httpHandler, {
      method: "POST",
      url: "/message",
      headers: { host: "127.0.0.1:3000" },
      body,
    });
    return {
      statusCode: response.statusCode,
      payload: JSON.parse(response.body || "{}"),
    };
  }

  setHttpSession(sessionId, serverInstanceId) {
    this.#state.httpSessionId = sessionId;
    this.#state.latestHttpServerInstanceId = serverInstanceId;
    this.#state.initialHttpServerInstanceId ??= serverInstanceId;
  }

  getHttpSessionId() {
    return this.#state.httpSessionId;
  }

  getInitialHttpServer() {
    return this.#state.initialHttpServerInstanceId;
  }

  updateLatestHttpServer(serverInstanceId) {
    this.#state.latestHttpServerInstanceId = serverInstanceId;
  }

  markCurrentHttpInstanceUnhealthy() {
    const current =
      this.#state.latestHttpServerInstanceId ?? this.#state.initialHttpServerInstanceId;
    if (!current) {
      throw new Error("No HTTP session has been initialized yet");
    }

    return this.#httpController.upsertInstance({
      serverInstanceId: current,
      load: 0.97,
      healthy: false,
      acceptingNewSessions: false,
    });
  }

  getObservability() {
    return this.#httpController.describeObservability();
  }
}

function stepDefinitions() {
  return [
    {
      id: "stdio-initialize-and-discover",
      title: "Initialize stdio session and discover memory tools",
      transport: "stdio",
      userPrompt:
        "Connect directly first and tell me what memory tools are available for storing and recalling facts.",
      whatTesting:
        "Proves the memory-style application can initialize over stdio and advertise its reusable MCP tool surface before any gateway behavior is involved.",
      expected:
        "The server should initialize successfully and list tools for remember, recall, list, and forget.",
      async execute(runner) {
        const initialize = await runner.sendStdio({ id: 1, method: "initialize" });
        const tools = await runner.sendStdio({ id: 2, method: "tools/list" });
        return {
          assistantSummary:
            "The stdio-connected memory server is ready and exposes the expected remember, recall, list, and forget tools.",
          outputs: { initialize, tools },
        };
      },
    },
    {
      id: "stdio-remember-fact",
      title: "Remember a fact through stdio",
      transport: "stdio",
      userPrompt:
        "Remember that Asha manages the gateway rollout under the operators namespace with the key primary-contact.",
      whatTesting:
        "Proves the stdio transport can create shared application state that a later HTTP/SSE session should be able to recall.",
      expected:
        "The memory store should save the fact under operators/primary-contact and return the stored value.",
      async execute(runner) {
        const response = await runner.sendStdio({
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
        return {
          assistantSummary:
            "The stdio path stored the fact successfully, so the gateway path now has real memory state to recall.",
          outputs: { response },
        };
      },
    },
    {
      id: "http-initialize-and-recall",
      title: "Initialize HTTP session and recall the remembered fact",
      transport: "http-sse-gateway",
      userPrompt:
        "Reconnect through the gateway and recall the primary-contact fact from the operators namespace.",
      whatTesting:
        "Proves the same memory application code is reachable through the gateway-backed HTTP/SSE path and can read state created over stdio.",
      expected:
        "The gateway should initialize a session, route it to one instance, and return the remembered fact value.",
      async execute(runner) {
        const initialize = await runner.sendHttp({
          method: "initialize",
          params: { clientId: "memory-validation-client" },
        });
        const recall = await runner.sendHttp({
          method: "tools/call",
          sessionId: initialize.payload.sessionId,
          params: {
            name: "memory_recall",
            arguments: {
              namespace: "operators",
              key: "primary-contact",
            },
          },
        });
        runner.setHttpSession(initialize.payload.sessionId, initialize.payload.serverInstanceId);
        return {
          assistantSummary:
            "The HTTP/SSE gateway reached the same memory app and recalled the fact that was created over stdio.",
          outputs: { initialize, recall },
        };
      },
    },
    {
      id: "http-list-with-stickiness",
      title: "List the namespace and confirm sticky routing",
      transport: "http-sse-gateway",
      userPrompt:
        "List the operators namespace and make sure the follow-up request stays on the same gateway-routed server instance.",
      whatTesting:
        "Proves existing HTTP memory sessions stay sticky to the same healthy server instance for follow-up requests.",
      expected:
        "The namespace list should succeed and the gateway should reuse the same server instance as the previous HTTP step.",
      async execute(runner) {
        const response = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "memory_list",
            arguments: { namespace: "operators" },
          },
        });
        runner.updateLatestHttpServer(response.payload.serverInstanceId);
        return {
          assistantSummary:
            "The follow-up HTTP memory request stayed sticky to the same healthy server instance, which is what session affinity requires.",
          outputs: {
            response,
            stickyCheck: {
              initialServerInstanceId: runner.getInitialHttpServer(),
              currentServerInstanceId: response.payload.serverInstanceId,
              reusedExistingSession: response.payload.reusedExistingSession,
            },
          },
        };
      },
    },
    {
      id: "http-reassign-after-unhealthy",
      title: "Mark the sticky server unhealthy and recall again",
      transport: "http-sse-gateway",
      userPrompt:
        "Pretend the current gateway-routed memory server is unhealthy, then recall the fact again and show that the request is reassigned instead of failing silently.",
      whatTesting:
        "Proves the gateway can reassign a previously sticky memory session when the assigned instance becomes unhealthy while preserving useful application behavior.",
      expected:
        "The gateway should route the request to a different instance, record a reassignment-style recovery action, and still return the remembered fact.",
      async execute(runner) {
        const updated = runner.markCurrentHttpInstanceUnhealthy();
        const response = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "memory_recall",
            arguments: {
              namespace: "operators",
              key: "primary-contact",
            },
          },
        });
        runner.updateLatestHttpServer(response.payload.serverInstanceId);
        return {
          assistantSummary:
            "After the originally sticky memory server was marked unhealthy, the gateway reassigned the session to another instance and still completed the recall.",
          outputs: {
            updatedInstance: updated,
            response,
            reassignmentCheck: {
              previousServerInstanceId: runner.getInitialHttpServer(),
              newServerInstanceId: response.payload.serverInstanceId,
              recoveryAction: response.payload.recovery.action,
            },
            observability: runner.getObservability(),
          },
        };
      },
    },
  ];
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
  let payload = "";
  const response = {
    writeHead(nextStatusCode) {
      statusCode = nextStatusCode;
    },
    end(chunk = "") {
      payload += String(chunk);
    },
  };

  await handler(request, response);
  return {
    statusCode,
    body: payload,
  };
}

function createNullCollector() {
  return {
    write() {},
  };
}
