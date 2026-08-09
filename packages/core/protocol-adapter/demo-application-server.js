import { createDemoApplicationState } from "./demo-application-state.js";
import { McpApplicationServer } from "./mcp-application-server.js";

export function createDemoApplicationServer({ serverInstanceId } = {}) {
  const state = createDemoApplicationState({ serverInstanceId });
  const server = new McpApplicationServer({
    serverInfo: {
      name: `demo-application-${state.serverInstanceId}`,
      version: "0.1.0",
    },
    instructions: "Stateful demo application server for stdio and HTTP/SSE parity flows.",
  });

  server.registerMethod("initialize", async ({ params = {}, context }) => {
    return state.initializeSession({
      sessionId: context.sessionId ?? params.sessionId,
      clientId: params.clientId,
      publish: resolvePublish(context),
    });
  });

  server.registerMethod("echo", async ({ params = {}, context }) => {
    return state.echoMessage({
      sessionId: context.sessionId,
      message: params.message,
      publish: resolvePublish(context),
    });
  });

  server.registerMethod("status", async ({ context }) => {
    return state.getStatus({
      sessionId: context.sessionId,
      publish: resolvePublish(context),
    });
  });

  server.registerTool({
    name: "echo",
    title: "Echo message",
    description: "Echo a message through the demo application session state.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments, context }) {
      return state.echoMessage({
        sessionId: context.sessionId,
        message: toolArguments.message,
        publish: resolvePublish(context),
      });
    },
  });

  server.registerTool({
    name: "status",
    title: "Session status",
    description: "Return demo application request counts for the current session.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ context }) {
      return state.getStatus({
        sessionId: context.sessionId,
        publish: resolvePublish(context),
      });
    },
  });

  return {
    serverInstanceId: state.serverInstanceId,
    getSessionState: state.getSessionState,
    getWorkloadState(workloadId) {
      return state.getWorkloadState(workloadId);
    },
    async ensureWorkload({ workloadId, workloadKind, metadata }) {
      return state.ensureWorkload({ workloadId, workloadKind, metadata });
    },
    async handleWorkloadMessage(message, { workloadId, workloadKind, traceContext } = {}) {
      return server.handleMessage(message, {
        sessionId: workloadId,
        transport: "streamable-http",
        metadata: {
          workloadId,
          workloadKind,
          traceContext,
        },
      });
    },
    listTools() {
      return server.listTools();
    },
    async handleMessage(message, context = {}) {
      return server.handleMessage(message, {
        ...context,
        sessionId: context.sessionId ?? message.sessionId,
      });
    },
  };
}

function resolvePublish(context) {
  return typeof context.metadata?.emitEvent === "function" ? context.metadata.emitEvent : () => {};
}
