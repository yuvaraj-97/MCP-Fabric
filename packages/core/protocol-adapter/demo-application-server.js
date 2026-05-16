import { createDemoApplication } from "./demo-application.js";

export function createDemoApplicationServer({ serverInstanceId } = {}) {
  const application = createDemoApplication({ serverInstanceId });

  return {
    serverInstanceId: application.serverInstanceId,
    getSessionState(sessionId) {
      return application.getSessionState(sessionId);
    },
    async handleMessage(message, context = {}) {
      validateMessage(message);

      if (!Object.hasOwn(message, "id")) {
        return null;
      }

      try {
        const result = await application.handleRequest({
          method: message.method,
          params: message.params,
          sessionId: context.sessionId ?? message.sessionId,
          emitEvent: context.metadata?.emitEvent,
        });

        return {
          jsonrpc: "2.0",
          id: message.id,
          result,
        };
      } catch (cause) {
        return {
          jsonrpc: "2.0",
          id: message.id ?? null,
          error: {
            message: cause instanceof Error ? cause.message : String(cause),
          },
        };
      }
    },
  };
}

function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("message must be an object");
  }

  if (typeof message.method !== "string" || message.method.length === 0) {
    throw new TypeError("message.method must be a non-empty string");
  }
}
