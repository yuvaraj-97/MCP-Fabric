import { createDemoApplication } from "./demo-application.js";
import {
  createErrorResponse,
  createSuccessResponse,
  isNotification,
  validateIncomingMessage,
} from "./jsonrpc-envelope.js";

export function createDemoApplicationServer({ serverInstanceId } = {}) {
  const application = createDemoApplication({ serverInstanceId });

  return {
    serverInstanceId: application.serverInstanceId,
    getSessionState(sessionId) {
      return application.getSessionState(sessionId);
    },
    async handleMessage(message, context = {}) {
      const messageValidationError = validateIncomingMessage(message);
      if (messageValidationError) {
        return createErrorResponse(null, -32600, messageValidationError);
      }

      if (isNotification(message)) {
        return null;
      }

      try {
        const result = await application.handleRequest({
          method: message.method,
          params: message.params,
          sessionId: context.sessionId ?? message.sessionId,
          emitEvent: context.metadata?.emitEvent,
        });

        return createSuccessResponse(message.id, result);
      } catch (cause) {
        return createErrorResponse(
          message.id ?? null,
          -32603,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
  };
}
