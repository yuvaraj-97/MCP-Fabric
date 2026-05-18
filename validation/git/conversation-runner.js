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

export class GitConversationRunner {
  #rootDir;
  #stdioTransport;
  #httpController;
  #httpHandler;
  #state;

  constructor() {
    this.reset();
  }

  reset() {
    this.#rootDir = createGitValidationWorkspace("git-conversation");
    this.#state = {
      httpSessionId: null,
      initialHttpServerInstanceId: null,
      latestHttpServerInstanceId: null,
      stepResults: new Map(),
    };

    this.#stdioTransport = new StdioTransportAdapter({
      server: createGitValidationApplication({
        rootDir: this.#rootDir,
        serverInstanceId: "stdio-git-a",
      }),
      output: createNullCollector(),
    });

    this.#httpController = createHttpSseGatewayController({
      serverInstances: [
        { serverInstanceId: "git-a", load: 0.1, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "git-b", load: 0.2, healthy: true, acceptingNewSessions: true },
      ],
      createApplication: ({ serverInstanceId }) =>
        createGitValidationApplication({ rootDir: this.#rootDir, serverInstanceId }),
    });
    this.#httpHandler = createGatewayHttpHandler({ controller: this.#httpController });
    return this.getState();
  }

  describe() {
    return {
      id: "git-conversation",
      targetId: "git",
      targetLabel: "Git",
      title: "Git Conversation Validation",
      audience:
        "Validates that a git-style MCP application preserves repository state across stdio and gateway-backed HTTP/SSE requests, including sticky routing and unhealthy failover.",
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
      createdFile: describeGitValidationFile(this.#rootDir),
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
        workspaceSnapshot: snapshotGitValidationWorkspace(this.#rootDir),
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
      title: "Initialize stdio session and discover git tools",
      transport: "stdio",
      userPrompt:
        "Connect directly first and tell me what git tools are available for reading, writing, staging, and inspecting repository state.",
      whatTesting:
        "Proves the git-style application can initialize over stdio and advertise its reusable MCP tool surface before any gateway behavior is involved.",
      expected:
        "The server should initialize successfully and list tools for reading files, writing files, status, staging, and diff inspection.",
      async execute(runner) {
        const initialize = await runner.sendStdio({ id: 1, method: "initialize" });
        const tools = await runner.sendStdio({ id: 2, method: "tools/list" });
        return {
          assistantSummary:
            "The stdio-connected git server is ready and exposes the expected repository tools.",
          outputs: { initialize, tools },
        };
      },
    },
    {
      id: "stdio-write-file",
      title: "Write a repository file through stdio",
      transport: "stdio",
      userPrompt:
        "Create notes/hello.txt with the text 'git validation works' so we can inspect repository state afterward.",
      whatTesting:
        "Proves the stdio transport can make a real repository change that the gateway path can inspect and stage later.",
      expected:
        "A file should be created inside the validation repository and the write result should report the relative path and bytes written.",
      async execute(runner) {
        const response = await runner.sendStdio({
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
        return {
          assistantSummary:
            "The stdio path created a real repository change, so the gateway path now has git state to inspect and stage.",
          outputs: { response },
        };
      },
    },
    {
      id: "http-initialize-and-status",
      title: "Initialize HTTP session and inspect git status",
      transport: "http-sse-gateway",
      userPrompt:
        "Reconnect through the gateway and show me the git status so we can confirm the same repository state is visible over HTTP.",
      whatTesting:
        "Proves the same git application code is reachable through the gateway-backed HTTP/SSE path and can observe the repository change created over stdio.",
      expected:
        "The gateway should initialize a session, route it to one instance, and return a git status showing the untracked notes file.",
      async execute(runner) {
        const initialize = await runner.sendHttp({
          method: "initialize",
          params: { clientId: "git-validation-client" },
        });
        const status = await runner.sendHttp({
          method: "tools/call",
          sessionId: initialize.payload.sessionId,
          params: {
            name: "git_status",
            arguments: {},
          },
        });
        runner.setHttpSession(initialize.payload.sessionId, initialize.payload.serverInstanceId);
        return {
          assistantSummary:
            "The HTTP/SSE gateway reached the same git app and saw the repository change that was created over stdio.",
          outputs: { initialize, status },
        };
      },
    },
    {
      id: "http-stage-with-stickiness",
      title: "Stage the file and confirm sticky routing",
      transport: "http-sse-gateway",
      userPrompt:
        "Stage notes/hello.txt and make sure the follow-up request stays on the same gateway-routed server instance.",
      whatTesting:
        "Proves existing HTTP git sessions stay sticky to the same healthy server instance for follow-up requests while preserving repository state.",
      expected:
        "The stage operation should succeed, a diff should be available, and the gateway should reuse the same server instance as the previous HTTP step.",
      async execute(runner) {
        const stage = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "git_stage_paths",
            arguments: { paths: ["notes/hello.txt"] },
          },
        });
        const diff = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "git_diff_cached",
            arguments: {},
          },
        });
        runner.updateLatestHttpServer(diff.payload.serverInstanceId);
        return {
          assistantSummary:
            "The follow-up HTTP git request stayed sticky to the same healthy server instance, and the staged diff remained visible.",
          outputs: {
            stage,
            diff,
            stickyCheck: {
              initialServerInstanceId: runner.getInitialHttpServer(),
              currentServerInstanceId: diff.payload.serverInstanceId,
              reusedExistingSession: diff.payload.reusedExistingSession,
            },
          },
        };
      },
    },
    {
      id: "http-reassign-after-unhealthy",
      title: "Mark the sticky server unhealthy and inspect status again",
      transport: "http-sse-gateway",
      userPrompt:
        "Pretend the current gateway-routed git server is unhealthy, then inspect status again and show that the request is reassigned without losing the staged state.",
      whatTesting:
        "Proves the gateway can reassign a previously sticky git session when the assigned instance becomes unhealthy while preserving useful repository behavior.",
      expected:
        "The gateway should route the request to a different instance, record a reassignment-style recovery action, and still return the staged repository state.",
      async execute(runner) {
        const updated = runner.markCurrentHttpInstanceUnhealthy();
        const response = await runner.sendHttp({
          method: "tools/call",
          sessionId: runner.getHttpSessionId(),
          params: {
            name: "git_status",
            arguments: {},
          },
        });
        runner.updateLatestHttpServer(response.payload.serverInstanceId);
        return {
          assistantSummary:
            "After the originally sticky git server was marked unhealthy, the gateway reassigned the session to another instance and still preserved the repository state.",
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
