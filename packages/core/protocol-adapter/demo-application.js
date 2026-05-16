import { randomUUID } from "node:crypto";

export function createDemoApplication({ serverInstanceId } = {}) {
  const resolvedServerInstanceId = serverInstanceId ?? "server-unknown";
  const sessions = new Map();

  return {
    serverInstanceId: resolvedServerInstanceId,
    handleRequest,
    getSessionState,
  };

  async function handleRequest({ method, params = {}, sessionId, emitEvent } = {}) {
    assertNonEmptyString(method, "method");
    const publish = typeof emitEvent === "function" ? emitEvent : () => {};

    switch (method) {
      case "initialize":
        return initializeSession({ sessionId: sessionId ?? params.sessionId, clientId: params.clientId, publish });
      case "echo":
        return echoMessage({ sessionId, message: params.message, publish });
      case "status":
        return getStatus({ sessionId, publish });
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  function getSessionState(sessionId) {
    const record = sessions.get(sessionId);
    return record ? cloneRecord(record) : undefined;
  }

  function initializeSession({ sessionId, clientId, publish }) {
    const resolvedSessionId = sessionId ?? randomUUID();
    const now = new Date().toISOString();
    const existing = sessions.get(resolvedSessionId);

    const record = {
      sessionId: resolvedSessionId,
      clientId: clientId ?? existing?.clientId ?? "anonymous-client",
      serverInstanceId: resolvedServerInstanceId,
      initializedAt: existing?.initializedAt ?? now,
      lastSeenAt: now,
      requestCount: existing?.requestCount ?? 0,
    };

    sessions.set(resolvedSessionId, record);
    publish("session.ready", cloneRecord(record));

    return {
      sessionId: resolvedSessionId,
      serverInstanceId: resolvedServerInstanceId,
      capabilities: ["echo", "status"],
      initialized: true,
      requestCount: record.requestCount,
    };
  }

  function echoMessage({ sessionId, message, publish }) {
    assertNonEmptyString(sessionId, "sessionId");
    assertNonEmptyString(message, "params.message");

    const session = requireSession(sessionId);
    const now = new Date().toISOString();
    session.requestCount += 1;
    session.lastSeenAt = now;

    const payload = {
      sessionId,
      serverInstanceId: resolvedServerInstanceId,
      message,
      requestCount: session.requestCount,
      observedAt: now,
    };

    publish("request.received", payload);
    publish("response.ready", payload);
    return payload;
  }

  function getStatus({ sessionId, publish }) {
    assertNonEmptyString(sessionId, "sessionId");

    const session = requireSession(sessionId);
    session.lastSeenAt = new Date().toISOString();
    const status = cloneRecord(session);
    publish("status.reported", status);
    return status;
  }

  function requireSession(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return record;
  }
}

function cloneRecord(record) {
  return { ...record };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
