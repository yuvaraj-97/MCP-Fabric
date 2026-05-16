export function validateIncomingMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "Incoming message must be an object";
  }
  if (message.jsonrpc !== "2.0") {
    return "Incoming message must use JSON-RPC 2.0";
  }
  if (typeof message.method !== "string" || message.method.length === 0) {
    return "Incoming message must include a method";
  }

  return null;
}

export function isNotification(message) {
  return !Object.hasOwn(message, "id");
}

export function createSuccessResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function createErrorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}
