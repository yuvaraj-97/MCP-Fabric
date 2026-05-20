import {
  ErrorCode,
  JSONRPCMessageSchema,
  JSONRPCNotificationSchema,
  JSONRPC_VERSION,
} from "@modelcontextprotocol/sdk/types.js";

export { ErrorCode };

export function validateIncomingMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "Incoming message must be an object";
  }

  const result = JSONRPCMessageSchema.safeParse(toSdkEnvelope(message));
  if (result.success) {
    return null;
  }

  if (message.jsonrpc !== JSONRPC_VERSION) {
    return `Incoming message must use JSON-RPC ${JSONRPC_VERSION}`;
  }

  if (typeof message.method !== "string" || message.method.length === 0) {
    return "Incoming message must include a method";
  }

  return result.error.issues[0]?.message ?? "Incoming message failed MCP SDK validation";
}

export function isNotification(message) {
  return JSONRPCNotificationSchema.safeParse(toSdkEnvelope(message)).success;
}

export function createSuccessResponse(id, result) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

export function createErrorResponse(id, code = ErrorCode.InternalError, message) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: {
      code,
      message,
    },
  };
}

export function toSdkEnvelope(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return message;
  }

  const normalized = {};
  for (const key of ["jsonrpc", "id", "method", "params", "result", "error"]) {
    if (Object.hasOwn(message, key)) {
      normalized[key] = message[key];
    }
  }

  return normalized;
}
