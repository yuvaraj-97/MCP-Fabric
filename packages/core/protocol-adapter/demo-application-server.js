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

  return {
    serverInstanceId: state.serverInstanceId,
    getSessionState: state.getSessionState,
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
