export function createSessionContext({
  clientId = "local-client",
  sessionId = "session-local",
  transport = "in-memory",
  metadata = {},
} = {}) {
  assertNonEmptyString(clientId, "clientId");
  assertNonEmptyString(sessionId, "sessionId");
  assertNonEmptyString(transport, "transport");

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object");
  }

  return {
    clientId,
    sessionId,
    transport,
    metadata: { ...metadata },
  };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
