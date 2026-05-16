import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createDemoApplicationServer } from "../../core/protocol-adapter/demo-application-server.js";
import { LoadRouter } from "../../gateway/load-balancer/load-router.js";
import { MemorySessionRegistry } from "../../gateway/session-registry/memory-session-registry.js";

export function createHttpSseGatewayServer({
  serverInstances = [
    { serverInstanceId: "server-a", load: 0.2, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.4, healthy: true, acceptingNewSessions: true },
  ],
  loadThreshold = 0.7,
  sessionRegistry = new MemorySessionRegistry(),
} = {}) {
  const controller = createHttpSseGatewayController({
    serverInstances,
    loadThreshold,
    sessionRegistry,
  });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

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

        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        controller.attachEventStream(sessionId, response);
        writeSse(response, "connected", {
          sessionId,
          route: controller.sessionRegistry.get(sessionId) ?? null,
        });

        request.on("close", () => {
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
      sendJson(response, 500, {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });

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

export function createHttpSseGatewayController({
  serverInstances = [
    { serverInstanceId: "server-a", load: 0.2, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.4, healthy: true, acceptingNewSessions: true },
  ],
  loadThreshold = 0.7,
  sessionRegistry = new MemorySessionRegistry(),
} = {}) {
  const router = new LoadRouter({ sessionRegistry, loadThreshold });
  const applications = new Map();
  const eventStreams = new Map();

  for (const instance of serverInstances) {
    router.upsertInstance(instance);
    applications.set(
      instance.serverInstanceId,
      createDemoApplicationServer({ serverInstanceId: instance.serverInstanceId }),
    );
  }

  return {
    router,
    sessionRegistry,
    applications,
    upsertInstance(instance) {
      const updated = router.upsertInstance(instance);
      if (!applications.has(updated.serverInstanceId)) {
        applications.set(
          updated.serverInstanceId,
          createDemoApplicationServer({ serverInstanceId: updated.serverInstanceId }),
        );
      }

      return updated;
    },
    attachEventStream(sessionId, response) {
      addEventStream(eventStreams, sessionId, response);
    },
    detachEventStream(sessionId, response) {
      removeEventStream(eventStreams, sessionId, response);
    },
    async handleGatewayMessage(body) {
      const method = body.method;
      const sessionId = body.sessionId ?? (method === "initialize" ? randomUUID() : undefined);
      const existingSessionRecord = sessionId ? sessionRegistry.get(sessionId) : undefined;
      const route = router.routeSession(sessionId);
      const application = applications.get(route.serverInstanceId);

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

      if (method === "initialize") {
        sessionRegistry.assign(sessionId, route.serverInstanceId, {
          clientId: body.params?.clientId ?? "anonymous-client",
        });
      }

      publishEvent(eventStreams, sessionId, "route.selected", {
        sessionId,
        serverInstanceId: route.serverInstanceId,
        reusedExistingSession: route.reusedExistingSession,
        observedAt: new Date().toISOString(),
      });

      return {
        sessionId,
        serverInstanceId: route.serverInstanceId,
        reusedExistingSession: route.reusedExistingSession,
        result,
      };
    },
    listPublishedEvents(sessionId) {
      return Array.from(eventStreams.get(sessionId) ?? []);
    },
  };
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
