import { randomUUID } from "node:crypto";

export function createDemoApplicationState({ serverInstanceId } = {}) {
  const resolvedServerInstanceId = serverInstanceId ?? "server-unknown";
  const sessions = new Map();

  return {
    serverInstanceId: resolvedServerInstanceId,
    getSessionState(sessionId) {
      const record = sessions.get(sessionId);
      return record ? cloneRecord(record) : undefined;
    },
    getWorkloadState(workloadId) {
      const record = sessions.get(workloadId);
      return record ? cloneRecord(record) : undefined;
    },
    ensureWorkload({ workloadId, workloadKind, metadata = {} } = {}) {
      assertNonEmptyString(workloadId, "workloadId");
      const now = new Date().toISOString();
      const existing = sessions.get(workloadId);

      const record = {
        sessionId: workloadId,
        clientId: metadata.clientId ?? existing?.clientId ?? "anonymous-client",
        serverInstanceId: resolvedServerInstanceId,
        initializedAt: existing?.initializedAt ?? now,
        lastSeenAt: now,
        requestCount: existing?.requestCount ?? 0,
        workloadKind: workloadKind || "unknown",
      };

      sessions.set(workloadId, record);
      return cloneRecord(record);
    },
    initializeSession({ sessionId, clientId, publish = () => {} } = {}) {
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
    },
    echoMessage({ sessionId, message, publish = () => {} } = {}) {
      assertNonEmptyString(sessionId, "sessionId");
      assertNonEmptyString(message, "params.message");

      const session = requireSession(sessions, sessionId);
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
    },
    getStatus({ sessionId, publish = () => {} } = {}) {
      assertNonEmptyString(sessionId, "sessionId");

      const session = requireSession(sessions, sessionId);
      session.lastSeenAt = new Date().toISOString();
      const status = cloneRecord(session);
      publish("status.reported", status);
      return status;
    },
  };
}

function requireSession(sessions, sessionId) {
  const record = sessions.get(sessionId);
  if (!record) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  return record;
}

function cloneRecord(record) {
  return { ...record };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
