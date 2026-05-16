import { randomUUID } from "node:crypto";

import { McpApplicationServer } from "./mcp-application-server.js";
import {
  createErrorResponse,
  createSuccessResponse,
  isNotification,
  validateIncomingMessage,
} from "./jsonrpc-envelope.js";

export function createDemoApplicationServer({ serverInstanceId } = {}) {
  const resolvedServerInstanceId = serverInstanceId ?? "server-unknown";
  const sessions = new Map();
  const server = new McpApplicationServer({
    serverInfo: {
      name: `demo-application-${resolvedServerInstanceId}`,
      version: "0.1.0",
    },
    instructions: "Stateful demo application server for stdio and HTTP/SSE parity flows.",
  });

  server.registerMethod("initialize", async ({ params = {}, context }) => {
    const publish = resolvePublish(context);
    const resolvedSessionId = context.sessionId ?? params.sessionId ?? randomUUID();
    const now = new Date().toISOString();
    const existing = sessions.get(resolvedSessionId);

    const record = {
      sessionId: resolvedSessionId,
      clientId: params.clientId ?? existing?.clientId ?? "anonymous-client",
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
  });

  server.registerMethod("echo", async ({ params = {}, context }) => {
    const publish = resolvePublish(context);
    const sessionId = context.sessionId;
    assertNonEmptyString(sessionId, "sessionId");
    assertNonEmptyString(params.message, "params.message");

    const session = requireSession(sessions, sessionId);
    const now = new Date().toISOString();
    session.requestCount += 1;
    session.lastSeenAt = now;

    const payload = {
      sessionId,
      serverInstanceId: resolvedServerInstanceId,
      message: params.message,
      requestCount: session.requestCount,
      observedAt: now,
    };

    publish("request.received", payload);
    publish("response.ready", payload);
    return payload;
  });

  server.registerMethod("status", async ({ context }) => {
    const publish = resolvePublish(context);
    const sessionId = context.sessionId;
    assertNonEmptyString(sessionId, "sessionId");

    const session = requireSession(sessions, sessionId);
    session.lastSeenAt = new Date().toISOString();
    const status = cloneRecord(session);
    publish("status.reported", status);
    return status;
  });

  return {
    serverInstanceId: resolvedServerInstanceId,
    getSessionState(sessionId) {
      const record = sessions.get(sessionId);
      return record ? cloneRecord(record) : undefined;
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
        const result = await server.handleMessage(message, {
          ...context,
          sessionId: context.sessionId ?? message.sessionId,
        });

        if (!result) {
          return null;
        }

        return result;
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

function requireSession(sessions, sessionId) {
  const record = sessions.get(sessionId);
  if (!record) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  return record;
}

function resolvePublish(context) {
  return typeof context.metadata?.emitEvent === "function" ? context.metadata.emitEvent : () => {};
}

function cloneRecord(record) {
  return { ...record };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
