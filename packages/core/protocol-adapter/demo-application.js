import { createDemoApplicationState } from "./demo-application-state.js";

export function createDemoApplication({ serverInstanceId } = {}) {
  const state = createDemoApplicationState({ serverInstanceId });

  return {
    serverInstanceId: state.serverInstanceId,
    getSessionState: state.getSessionState,
    async handleRequest({ method, params = {}, sessionId, emitEvent } = {}) {
      assertNonEmptyString(method, "method");
      const publish = typeof emitEvent === "function" ? emitEvent : () => {};

      switch (method) {
        case "initialize":
          return state.initializeSession({
            sessionId: sessionId ?? params.sessionId,
            clientId: params.clientId,
            publish,
          });
        case "echo":
          return state.echoMessage({
            sessionId,
            message: params.message,
            publish,
          });
        case "status":
          return state.getStatus({
            sessionId,
            publish,
          });
        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    },
  };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
