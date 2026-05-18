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

export class FilesystemConversationRunner {
  #rootDir;
  #stdioTransport;
  #httpController;
  #httpHandler;
  #state;

  constructor() {
    this.reset();
  }

  reset() {
    this.#cleanup();
    this.#rootDir = createFilesystemValidationWorkspace("filesystem-conversation");
    this.#state = {
      stdioSessionId: null,
      httpSessionId: null,
      initialHttpServerInstanceId: null,
      latestHttpServerInstanceId: null,
      stepResults: new Map(),
    };

    this.#stdioTransport = new StdioTransportAdapter({
      server: createFilesystemValidationApplication({
        rootDir: this.#rootDir,
        serverInstanceId: "stdio-filesystem-a",
      }),
      output: createStringCollector(),
    });

    this.#httpController = createHttpSseGatewayController({
      serverInstances: [
        { serverInstanceId: "fs-a", load: 0.1, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "fs-b", load: 0.2, healthy: true, acceptingNewSessions: true },
      ],
      createApplication: ({ serverInstanceId }) =>
        createFilesystemValidationApplication({
          rootDir: this.#rootDir,
          serverInstanceId,
        }),
    });
    this.#httpHandler = createGatewayHttpHandler({ controller: this.#httpController });

    return this.getState();
  }

  describe() {
    return {
      id: "filesystem-conversation",
      targetId: "filesystem",
      targetLabel: "Filesystem",
      title: "Filesystem Conversation Validation",
      audience:
        "Validates that the same filesystem-style MCP application can support a conversation-like workflow over stdio and gateway-backed HTTP/SSE.",
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
      rootDir: this.#rootDir,
      createdFile: describeFilesystemValidationFile(this.#rootDir),
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
        workspaceSnapshot: snapshotFilesystemValidationWorkspace(this.#rootDir),
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

  markCurrentHttpInstanceUnhealthy() {
    const current = this.#state.latestHttpServerInstanceId ?? this.#state.initialHttpServerInstanceId;
    if (!current) {
      throw new Error("No HTTP session has been initialized yet");
    }

    return this.#httpController.upsertInstance({
      serverInstanceId: current,
      load: 0.96,
      healthy: false,
      acceptingNewSessions: false,
    });
  }

  setStdioSessionId(sessionId) {
    this.#state.stdioSessionId = sessionId;
  }

  getStdioSessionId() {
    return this.#state.stdioSessionId;
  }

  setHttpSession(sessionId, serverInstanceId) {
    this.#state.httpSessionId = sessionId;
    this.#state.latestHttpServerInstanceId = serverInstanceId;
    this.#state.initialHttpServerInstanceId ??= serverInstanceId;
  }

  getHttpSessionId() {
    return this.#state.httpSessionId;
  }

  updateLatestHttpServer(serverInstanceId) {
    this.#state.latestHttpServerInstanceId = serverInstanceId;
  }

  getInitialHttpServer() {
    return this.#state.initialHttpServerInstanceId;
  }

  getLatestHttpServer() {
    return this.#state.latestHttpServerInstanceId;
  }

  getObservability() {
    return this.#httpController.describeObservability();
  }

  #cleanup() {
    if (this.#rootDir) {
      rmSync(this.#rootDir, { recursive: true, force: true });
    }
  }
}

export async function runFilesystemConversationValidation() {
  const runner = new FilesystemConversationRunner();
  const results = [];
  for (const step of stepDefinitions()) {
    const executed = await runner.runStep(step.id);
    results.push(executed.result);
  }

  return {
    scenario: runner.describe(),
    rootDir: runner.getState().rootDir,
    results,
    observability: runner.getObservability(),
  };
}

function stepDefinitions() {
  return [
    {
      id: "stdio-initialize-and-discover",
      title: "Initialize stdio session and discover filesystem tools",
      transport: "stdio",
      userPrompt:
        "You are helping me inspect a workspace. First, connect and tell me what filesystem tools are available.",
      whatTesting:
        "Proves the same application can initialize and expose tool metadata over stdio before any gateway behavior is involved.",
      expected:
        "The server should initialize successfully and list filesystem tools such as list, read, write, and stat.",
      async execute(runner) {
        const initialize = await runner.sendStdio({
          id: 1,
          method: "initialize",
        });
        const tools = await runner.sendStdio({
          id: 2,
          method: "tools/list",
        });

        runner.setStdioSessionId("stdio-session");
        return {
          assistantSummary:
            "The stdio-connected MCP server is ready and exposes the expected filesystem tools.",
          requests: [
            { method: "initialize", transport: "stdio" },
            { method: "tools/list", transport: "stdio" },
          ],
          outputs: {
            initialize,
            tools,
          },
        };
      },
    },
    {
      id: "stdio-write-file",
      title: "Write a file through the stdio path",
      transport: "stdio",
      userPrompt:
        "Create a note at notes/hello.txt containing the sentence 'filesystem validation works'.",
      whatTesting:
        "Proves that the stdio transport can perform a meaningful state-changing filesystem action using the shared MCP application code.",
      expected:
        "A file should be created inside the validation workspace and the write result should report the relative path and bytes written.",
      async execute(runner) {
        const response = await runner.sendStdio({
          id: 3,
          method: "tools/call",
          params: {
            name: "fs_write_text",
            arguments: {
              path: "notes/filesystem-note.txt",
              content: "filesystem validation works",
            },
          },
        });

        return {
          assistantSummary:
            "The stdio path created the file successfully, so there is now real shared state for the gateway-backed HTTP path to read.",
          requests: [
            {
              method: "tools/call",
              tool: "fs_write_text",
              transport: "stdio",
            },
          ],
          outputs: {
            response,
          },
        };
      },
    },
    {
      id: "http-initialize-and-read",
      title: "Initialize HTTP session and read the file through the gateway",
      transport: "http-sse-gateway",
      userPrompt:
        "Now connect through the gateway and read back notes/hello.txt so we can confirm the same app behavior works through HTTP.",
      whatTesting:
        "Proves the same filesystem application code is reachable through the gateway-backed HTTP/SSE path, not just through stdio.",
      expected:
        "The gateway should initialize a session, route it to one server instance, and return the same file content that stdio wrote.",
      async execute(runner) {
        const initialize = await runner.sendHttp({
          method: "initialize",
          params: { clientId: "laptop-validation-client" },
        });
        const read = await runner.sendHttp({
          method: "tools/call",
          sessionId: initialize.payload.sessionId,
          params: {
            name: "fs_read_text",
            arguments: {
              path: "notes/filesystem-note.txt",
            },
          },
        });

        runner.setHttpSession(
          initialize.payload.sessionId,
          initialize.payload.serverInstanceId,
        );

        return {
          assistantSummary:
            "The HTTP/SSE gateway reached the same filesystem app and read the file that was created over stdio.",
          requests: [
            { method: "initialize", transport: "http-sse-gateway" },
            { method: "tools/call", tool: "fs_read_text", transport: "http-sse-gateway" },
          ],
          outputs: {
            initialize,
            read,
          },
        };
      },
    },
    {
      id: "http-list-with-stickiness",
      title: "List the directory and confirm sticky routing",
      transport: "http-sse-gateway",
      userPrompt:
        "List the notes directory and make sure the follow-up request stays on the same gateway-routed server instance.",
      whatTesting:
        "Proves existing HTTP sessions stay sticky to the same healthy server instance for follow-up requests.",
      expected:
        "The list operation should succeed and the gateway should reuse the same server instance as the previous HTTP step.",
      async execute(runner) {
        const response = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "fs_list",
            arguments: {
              path: "notes",
            },
          },
        });

        runner.updateLatestHttpServer(response.payload.serverInstanceId);

        return {
          assistantSummary:
            "The follow-up HTTP request stayed sticky to the same healthy server instance, which is what session affinity requires.",
          requests: [
            { method: "tools/call", tool: "fs_list", transport: "http-sse-gateway" },
          ],
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
      title: "Mark the sticky server unhealthy and read again",
      transport: "http-sse-gateway",
      userPrompt:
        "Pretend the current gateway-routed server is unhealthy, then read the file again and show that the request is reassigned instead of failing silently.",
      whatTesting:
        "Proves the gateway can reassign a previously sticky session when the assigned instance becomes unhealthy, while preserving useful application behavior.",
      expected:
        "The gateway should route the request to a different instance, record a reassignment-style recovery action, and still return the file content.",
      async execute(runner) {
        const updated = runner.markCurrentHttpInstanceUnhealthy();
        const response = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "fs_read_text",
            arguments: {
              path: "notes/filesystem-note.txt",
            },
          },
        });
        runner.updateLatestHttpServer(response.payload.serverInstanceId);

        return {
          assistantSummary:
            "After the originally sticky server was marked unhealthy, the gateway reassigned the session to another instance and still completed the read.",
          requests: [
            { method: "instance.update", transport: "http-sse-gateway" },
            { method: "tools/call", tool: "fs_read_text", transport: "http-sse-gateway" },
          ],
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

function createStringCollector() {
  const collector = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return collector;
}
