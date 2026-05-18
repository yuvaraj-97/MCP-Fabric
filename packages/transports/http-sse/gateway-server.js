import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createDemoApplicationServer } from "../../core/protocol-adapter/demo-application-server.js";
import { DEFAULT_GATEWAY_OPERATOR_CONFIG, resolveOperatorConfig } from "../../gateway/config/operator-config.js";
import { LoadRouter } from "../../gateway/load-balancer/load-router.js";
import { createGatewayObserver } from "../../gateway/observability/gateway-observer.js";
import { MemorySessionRegistry } from "../../gateway/session-registry/memory-session-registry.js";

export function createHttpSseGatewayServer({
  serverInstances = [
    { serverInstanceId: "server-a", load: 0.2, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.4, healthy: true, acceptingNewSessions: true },
  ],
  createApplication,
  operatorConfig,
  loadThreshold,
  sessionRegistry,
  sessionTtlMs,
  reconnectGracePeriodMs,
  now = () => Date.now(),
} = {}) {
  const resolvedOperatorConfig = resolveOperatorConfig({
    config: mergeExplicitOperatorConfig(operatorConfig, {
      loadThreshold,
      sessionTtlMs,
      reconnectGracePeriodMs,
    }),
    defaults: DEFAULT_GATEWAY_OPERATOR_CONFIG,
  });
  const controller = createHttpSseGatewayController({
    serverInstances,
    createApplication,
    operatorConfig: resolvedOperatorConfig,
    sessionRegistry,
    now,
  });
  const server = createServer(createGatewayHttpHandler({ controller }));

  return {
    server,
    router: controller.router,
    sessionRegistry: controller.sessionRegistry,
    applications: controller.applications,
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, () => {
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

export function createGatewayHttpHandler({
  controller,
  baseUrl = "http://127.0.0.1",
} = {}) {
  if (!controller) {
    throw new TypeError("controller is required");
  }

  return async (request, response) => {
    try {
      const url = new URL(request.url, request.headers.host ? `http://${request.headers.host}` : baseUrl);

      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          ok: true,
          instances: controller.router.listInstances(),
          sessions: controller.sessionRegistry.list(),
        });
      }

      if (request.method === "GET" && url.pathname === "/sessions") {
        return sendJson(response, 200, {
          instances: controller.router.listInstances(),
          sessions: controller.sessionRegistry.list(),
        });
      }

      if (request.method === "GET" && url.pathname === "/observability") {
        return sendJson(response, 200, controller.describeObservability());
      }

      if (request.method === "POST" && url.pathname === "/instances") {
        const body = await readJsonBody(request);
        const updated = controller.upsertInstance(body);
        return sendJson(response, 200, updated);
      }

      if (request.method === "GET" && url.pathname === "/events") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          return sendJson(response, 400, { error: "sessionId is required" });
        }

        const route = controller.attachEventStream(sessionId, response);

        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        writeSse(response, "connected", {
          sessionId,
          route,
        });

        request.on?.("close", () => {
          controller.detachEventStream(sessionId, response);
        });

        return;
      }

      if (request.method === "POST" && url.pathname === "/message") {
        const body = await readJsonBody(request);
        const result = await controller.handleGatewayMessage(body);
        return sendJson(response, 200, result);
      }

      if (request.method === "GET" && url.pathname === "/inspector") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderInspectorHtml());
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (cause) {
      sendJson(response, cause?.statusCode ?? 500, {
        error: cause instanceof Error ? cause.message : String(cause),
        code: cause?.code,
        sessionId: cause?.sessionId,
      });
    }
  };
}

export function createHttpSseGatewayController({
  serverInstances = [
    { serverInstanceId: "server-a", load: 0.2, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.4, healthy: true, acceptingNewSessions: true },
  ],
  createApplication = defaultApplicationFactory,
  operatorConfig,
  loadThreshold,
  sessionRegistry,
  sessionTtlMs,
  reconnectGracePeriodMs,
  now = () => Date.now(),
} = {}) {
  const resolvedOperatorConfig = resolveOperatorConfig({
    config: mergeExplicitOperatorConfig(operatorConfig, {
      loadThreshold,
      sessionTtlMs,
      reconnectGracePeriodMs,
    }),
    defaults: DEFAULT_GATEWAY_OPERATOR_CONFIG,
  });
  const {
    loadThreshold: effectiveLoadThreshold,
    sessionTtlMs: effectiveSessionTtlMs,
    reconnectGracePeriodMs: effectiveReconnectGracePeriodMs,
  } = resolvedOperatorConfig;
  const resolvedSessionRegistry = sessionRegistry ?? new MemorySessionRegistry({ now });
  const router = new LoadRouter({
    sessionRegistry: resolvedSessionRegistry,
    loadThreshold: effectiveLoadThreshold,
  });
  const applications = new Map();
  const eventStreams = new Map();
  const observer = createGatewayObserver({ now });

  for (const instance of serverInstances) {
    router.upsertInstance(instance);
    applications.set(instance.serverInstanceId, createApplication({ ...instance }));
  }

  return {
    router,
    sessionRegistry: resolvedSessionRegistry,
    applications,
    observer,
    describeRegistry() {
      return {
        mode:
          typeof resolvedSessionRegistry.storageKind === "function"
            ? resolvedSessionRegistry.storageKind()
            : "custom",
        durable:
          typeof resolvedSessionRegistry.isDurable === "function"
            ? resolvedSessionRegistry.isDurable()
            : false,
        loadThreshold: effectiveLoadThreshold,
        sessionTtlMs: effectiveSessionTtlMs,
        reconnectGracePeriodMs: effectiveReconnectGracePeriodMs,
        filePath:
          typeof resolvedSessionRegistry.filePath === "function"
            ? resolvedSessionRegistry.filePath()
            : undefined,
      };
    },
    describeObservability() {
      return {
        summary: observer.summary(),
        recentEvents: observer.listEvents(),
      };
    },
    upsertInstance(instance) {
      const updated = router.upsertInstance(instance);
      observer.record("instance.updated", {
        serverInstanceId: updated.serverInstanceId,
        healthy: updated.healthy,
        load: updated.load,
        acceptingNewSessions: updated.acceptingNewSessions,
      });
      if (!applications.has(updated.serverInstanceId)) {
        applications.set(updated.serverInstanceId, createApplication({ ...updated }));
      }

      return updated;
    },
    attachEventStream(sessionId, response) {
      const record = resolvedSessionRegistry.get(sessionId);
      if (!record) {
        addEventStream(eventStreams, sessionId, response);
        observer.record("stream.attached", {
          sessionId,
          serverInstanceId: null,
          activeSessionRecord: false,
        });
        return null;
      }

      const reconnectState = deriveReconnectState(record, now());
      if (reconnectState === "grace-expired") {
        resolvedSessionRegistry.delete(sessionId);
        throw createGatewaySessionError({
          sessionId,
          code: "reconnect-grace-expired",
          statusCode: 410,
          message: "Reconnect grace period expired. Reinitialize the MCP session.",
        });
      }

      addEventStream(eventStreams, sessionId, response);
      observer.record("stream.attached", {
        sessionId,
        serverInstanceId: record.serverInstanceId,
        activeSessionRecord: true,
        reconnectState,
      });
      return record;
    },
    detachEventStream(sessionId, response) {
      removeEventStream(eventStreams, sessionId, response);
      if (!hasActiveEventStream(eventStreams, sessionId)) {
        resolvedSessionRegistry.markDisconnected?.(sessionId, {
          gracePeriodMs: effectiveReconnectGracePeriodMs,
        });
      }
      observer.record("stream.detached", {
        sessionId,
        remainingAttachments: eventStreams.get(sessionId)?.size ?? 0,
      });
    },
    async handleGatewayMessage(body) {
      resolvedSessionRegistry.pruneExpired?.();
      const method = body.method;
      const sessionId = body.sessionId ?? (method === "initialize" ? randomUUID() : undefined);
      const existingSessionRecord = sessionId ? resolvedSessionRegistry.get(sessionId) : undefined;
      const requestNow = now();
      observer.record("request.received", {
        method,
        sessionId,
        existingSessionRecord: Boolean(existingSessionRecord),
      });

      if (method !== "initialize" && !existingSessionRecord) {
        observer.record("request.rejected", {
          method,
          sessionId,
          code: "session-not-found",
        });
        throw createGatewaySessionError({
          sessionId,
          code: "session-not-found",
          statusCode: 410,
          message: "Session was not found or has expired. Reinitialize the MCP session.",
        });
      }

      const reconnectState = deriveReconnectState(existingSessionRecord, requestNow);
      if (method !== "initialize" && reconnectState === "grace-expired") {
        resolvedSessionRegistry.delete(sessionId);
        observer.record("request.rejected", {
          method,
          sessionId,
          code: "reconnect-grace-expired",
        });
        throw createGatewaySessionError({
          sessionId,
          code: "reconnect-grace-expired",
          statusCode: 410,
          message: "Reconnect grace period expired. Reinitialize the MCP session.",
        });
      }

      const route = router.routeSession(sessionId);
      const application = applications.get(route.serverInstanceId);
      let recoveryAction = determineRecoveryAction({
        method,
        route,
        existingSessionRecord,
        application,
        sessionId,
        reconnectState,
      });

      if (method !== "initialize" && !application.getSessionState(sessionId)) {
        const rehydrated = await application.handleMessage(
          {
            jsonrpc: "2.0",
            id: `${sessionId}:rehydrate`,
            method: "initialize",
            params: {
              clientId: existingSessionRecord?.metadata?.clientId ?? "gateway-rehydrated-client",
            },
            sessionId,
          },
          createGatewayContext({
            sessionId,
            route,
            reusedExistingSession: false,
            eventStreams,
            }),
        );
        assertGatewayResult(rehydrated);
        recoveryAction = route.reusedExistingSession
          ? reconnectState === "within-grace"
            ? "reconnected-from-registry-within-grace"
            : "reconnected-from-registry"
          : reconnectState === "within-grace"
            ? "reassigned-and-rehydrated-within-grace"
            : "reassigned-and-rehydrated";
        publishEvent(eventStreams, sessionId, "session.rehydrated", {
          sessionId,
          serverInstanceId: route.serverInstanceId,
          clientId: existingSessionRecord?.metadata?.clientId ?? "gateway-rehydrated-client",
          observedAt: new Date().toISOString(),
        });
        observer.record("session.rehydrated", {
          sessionId,
          serverInstanceId: route.serverInstanceId,
          recoveryAction,
        });
      }

      const envelope = await application.handleMessage(
        {
          jsonrpc: "2.0",
          id: body.id ?? `${sessionId}:${method}`,
          method,
          params: body.params,
          sessionId,
        },
        createGatewayContext({
          sessionId,
          route,
          reusedExistingSession: route.reusedExistingSession,
          eventStreams,
        }),
      );
      const result = assertGatewayResult(envelope);
      resolvedSessionRegistry.assign(
        sessionId,
        route.serverInstanceId,
        buildLifecycleMetadata({
          existingRecord: existingSessionRecord,
          clientId: body.params?.clientId ?? existingSessionRecord?.metadata?.clientId ?? "anonymous-client",
          now: requestNow,
          sessionTtlMs: effectiveSessionTtlMs,
        }),
      );

      publishEvent(eventStreams, sessionId, "route.selected", {
        sessionId,
        serverInstanceId: route.serverInstanceId,
        reusedExistingSession: route.reusedExistingSession,
        observedAt: new Date().toISOString(),
      });
      observer.record("route.completed", {
        method,
        sessionId,
        serverInstanceId: route.serverInstanceId,
        reusedExistingSession: route.reusedExistingSession,
        recoveryAction,
      });

      return {
        sessionId,
        serverInstanceId: route.serverInstanceId,
        reusedExistingSession: route.reusedExistingSession,
        recovery: {
          action: recoveryAction,
          registry: this.describeRegistry(),
          registryRecordFound: Boolean(existingSessionRecord),
        },
        result,
      };
    },
    listPublishedEvents(sessionId) {
      return Array.from(eventStreams.get(sessionId) ?? []);
    },
    listAuditEvents(limit) {
      return observer.listEvents(typeof limit === "number" ? { limit } : undefined);
    },
  };
}

function defaultApplicationFactory({ serverInstanceId }) {
  return createDemoApplicationServer({ serverInstanceId });
}

function determineRecoveryAction({
  method,
  route,
  existingSessionRecord,
  application,
  sessionId,
  reconnectState,
}) {
  if (method === "initialize") {
    return existingSessionRecord ? "reinitialized-existing-session" : "new-session";
  }

  if (reconnectState === "within-grace") {
    if (!application.getSessionState(sessionId) && existingSessionRecord) {
      return "reconnected-from-registry-within-grace";
    }

    return "reconnected-within-grace-period";
  }

  if (!application.getSessionState(sessionId) && existingSessionRecord) {
    return "reconnected-from-registry";
  }

  if (route.reusedExistingSession) {
    return "sticky-existing-session";
  }

  if (existingSessionRecord) {
    return "reassigned-after-instance-change";
  }

  return "new-session";
}

function createGatewayContext({ sessionId, route, reusedExistingSession, eventStreams }) {
  return {
    sessionId,
    transport: "http-sse",
    metadata: {
      emitEvent(event, payload) {
        publishEvent(eventStreams, sessionId, event, {
          sessionId,
          serverInstanceId: route.serverInstanceId,
          reusedExistingSession,
          payload,
          observedAt: new Date().toISOString(),
        });
      },
    },
  };
}

function assertGatewayResult(envelope) {
  if (!envelope) {
    throw new Error("Expected request response envelope");
  }

  if (envelope.error) {
    throw new Error(envelope.error.message ?? "Gateway request failed");
  }

  return envelope.result;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function addEventStream(eventStreams, sessionId, response) {
  let clients = eventStreams.get(sessionId);
  if (!clients) {
    clients = new Set();
    eventStreams.set(sessionId, clients);
  }

  clients.add(response);
}

function removeEventStream(eventStreams, sessionId, response) {
  const clients = eventStreams.get(sessionId);
  if (!clients) {
    return;
  }

  clients.delete(response);
  if (clients.size === 0) {
    eventStreams.delete(sessionId);
  }
}

function hasActiveEventStream(eventStreams, sessionId) {
  return Boolean(eventStreams.get(sessionId)?.size);
}

function publishEvent(eventStreams, sessionId, event, payload) {
  const clients = eventStreams.get(sessionId);
  if (!clients) {
    return;
  }

  for (const response of clients) {
    writeSse(response, event, payload);
  }
}

function writeSse(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function deriveReconnectState(existingSessionRecord, requestNow) {
  if (existingSessionRecord?.metadata?.connectionState !== "disconnected") {
    return "active";
  }

  if (
    typeof existingSessionRecord.metadata.graceUntil === "number" &&
    existingSessionRecord.metadata.graceUntil >= requestNow
  ) {
    return "within-grace";
  }

  return "grace-expired";
}

function buildLifecycleMetadata({ existingRecord, clientId, now, sessionTtlMs }) {
  return {
    clientId,
    connectionState: "active",
    disconnectedAt: null,
    graceUntil: null,
    lastSeenAt: now,
    expiresAt: now + sessionTtlMs,
    reconnectCount:
      existingRecord?.metadata?.connectionState === "disconnected"
        ? (existingRecord?.metadata?.reconnectCount ?? 0) + 1
        : (existingRecord?.metadata?.reconnectCount ?? 0),
  };
}

function createGatewaySessionError({ sessionId, code, statusCode, message }) {
  const error = new Error(message);
  error.sessionId = sessionId;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function mergeExplicitOperatorConfig(baseConfig = {}, overrides = {}) {
  const merged = { ...baseConfig };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function renderInspectorHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MCP Session Inspector</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffaf2;
        --ink: #1a2233;
        --accent: #c9552d;
        --border: #d7c7b0;
      }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(201, 85, 45, 0.16), transparent 32%),
          linear-gradient(180deg, #f9f2e8 0%, var(--bg) 100%);
        color: var(--ink);
      }

      main {
        max-width: 1080px;
        margin: 0 auto;
        padding: 32px 20px 60px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 3vw, 3.6rem);
      }

      p {
        max-width: 760px;
      }

      .grid {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        margin-top: 24px;
      }

      .panel {
        background: rgba(255, 250, 242, 0.92);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 18px 40px rgba(41, 40, 36, 0.08);
      }

      label,
      button,
      input {
        font: inherit;
      }

      input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        margin: 6px 0 12px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        margin-right: 8px;
        margin-bottom: 8px;
      }

      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #1e2739;
        color: #edf1fa;
        border-radius: 14px;
        padding: 14px;
        min-height: 120px;
        margin: 0;
      }

      code {
        font-family: "Courier New", monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Session And SSE Inspector</h1>
      <p>
        Use this page to initialize a session, send step-by-step requests, inspect
        the routed server instance, and watch SSE events arrive in order.
      </p>

      <div class="grid">
        <section class="panel">
          <h2>Control</h2>
          <label for="sessionId">Session ID</label>
          <input id="sessionId" placeholder="Generated on initialize" />

          <label for="message">Echo Payload</label>
          <input id="message" value="hello from inspector" />

          <div>
            <button id="initializeButton" type="button">Initialize</button>
            <button id="echoButton" type="button">Echo</button>
            <button id="statusButton" type="button">Status</button>
          </div>
        </section>

        <section class="panel">
          <h2>Latest Response</h2>
          <pre id="responseLog"></pre>
        </section>

        <section class="panel">
          <h2>SSE Events</h2>
          <pre id="eventLog"></pre>
        </section>

        <section class="panel">
          <h2>Gateway Snapshot</h2>
          <pre id="gatewayLog"></pre>
        </section>
      </div>
    </main>

    <script>
      const sessionIdInput = document.getElementById("sessionId");
      const messageInput = document.getElementById("message");
      const responseLog = document.getElementById("responseLog");
      const eventLog = document.getElementById("eventLog");
      const gatewayLog = document.getElementById("gatewayLog");

      let eventSource;

      document.getElementById("initializeButton").addEventListener("click", async () => {
        const payload = await sendMessage("initialize", { clientId: "inspector-browser" });
        attachEvents(payload.sessionId);
      });

      document.getElementById("echoButton").addEventListener("click", async () => {
        await sendMessage("echo", { message: messageInput.value });
      });

      document.getElementById("statusButton").addEventListener("click", async () => {
        await sendMessage("status", {});
      });

      async function sendMessage(method, params) {
        const response = await fetch("/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method,
            params,
            sessionId: sessionIdInput.value || undefined,
          }),
        });

        const payload = await response.json();
        sessionIdInput.value = payload.sessionId || sessionIdInput.value;
        responseLog.textContent = JSON.stringify(payload, null, 2);
        await refreshGateway();
        return payload;
      }

      function attachEvents(sessionId) {
        if (!sessionId) {
          return;
        }

        if (eventSource) {
          eventSource.close();
        }

        eventLog.textContent = "";
        eventSource = new EventSource("/events?sessionId=" + encodeURIComponent(sessionId));
        const append = (name) => (event) => {
          eventLog.textContent += "[" + name + "] " + event.data + "\\n\\n";
        };

        eventSource.addEventListener("connected", append("connected"));
        eventSource.addEventListener("session.ready", append("session.ready"));
        eventSource.addEventListener("request.received", append("request.received"));
        eventSource.addEventListener("response.ready", append("response.ready"));
        eventSource.addEventListener("status.reported", append("status.reported"));
        eventSource.addEventListener("route.selected", append("route.selected"));
      }

      async function refreshGateway() {
        const response = await fetch("/sessions");
        gatewayLog.textContent = JSON.stringify(await response.json(), null, 2);
      }

      refreshGateway();
    </script>
  </body>
</html>`;
}
