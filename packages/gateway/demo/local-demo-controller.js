import { LoadRouter } from "../load-balancer/load-router.js";
import { FileSessionRegistry, removeRegistryFile } from "../session-registry/file-session-registry.js";
import { MemorySessionRegistry } from "../session-registry/memory-session-registry.js";
import { createHttpSseGatewayController } from "../../transports/http-sse/gateway-server.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const DEFAULT_LOAD_THRESHOLD = 0.7;
const DEFAULT_RUNTIME_SESSION_TTL_MS = 60_000;
const DEFAULT_RUNTIME_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_INSTANCES = [
  { serverInstanceId: "server-a", healthy: true, load: 0.22, acceptingNewSessions: true },
  { serverInstanceId: "server-b", healthy: true, load: 0.48, acceptingNewSessions: true },
  { serverInstanceId: "server-c", healthy: true, load: 0.82, acceptingNewSessions: true },
];

const DASHBOARD_COPY = {
  title: "MCP Scaling Demo Dashboard",
  problem:
    "This repo keeps MCP protocol semantics intact while adding reusable core logic, transport adapters, and deployment infrastructure for multi-instance routing, session stickiness, and load-aware decisions.",
  concepts: [
    {
      title: "Session affinity",
      body:
        "Session affinity means once a client session is assigned to a server instance, later requests for that same session go back to the same instance while it stays healthy.",
    },
    {
      title: "Load-aware routing",
      body:
        "Load-aware routing means new sessions prefer the healthiest, least-loaded instance instead of blindly spreading traffic.",
    },
    {
      title: "Option 1 library",
      body:
        "Option 1 packages the shared MCP logic, session context, and transport hooks as reusable library code that other MCP deployments can embed.",
    },
    {
      title: "Option 2 gateway",
      body:
        "Option 2 runs a standalone self-hosted gateway in front of multiple MCP server instances so teams can centralize sticky routing, SSE visibility, and failover behavior without changing server business logic.",
    },
  ],
  status: {
    implemented:
      "Today the repo has a reusable MCP core, a session context helper, a framed stdio adapter, a newline stdio demo harness, an HTTP/SSE gateway, a durable file-backed runtime session registry, explicit restart and reconnect recovery behavior, session TTL plus reconnect grace-window enforcement, a load-aware router, and this local dashboard.",
    planned:
      "Next comes external production-grade state backends, clearer operator policy controls for TTL and reconnect rules, and fuller self-hosted gateway packaging for real MCP deployments.",
  },
  improvements: [
    {
      title: "What improved",
      body:
        "The prototype now has both transport-level demos and a reusable core slice, plus durable runtime session storage, explicit restart/reconnect behavior, and gateway-enforced session lease rules.",
    },
    {
      title: "Why it matters",
      body:
        "It proves the same application behavior can be reached through stdio and HTTP/SSE while sticky sessions survive runtime restarts, overloaded servers are skipped, unhealthy-instance reassignment remains visible at the gateway layer, and stale sessions are rejected instead of silently lingering forever.",
    },
  ],
  codeAdded: [
    "packages/gateway/load-balancer/load-router.js now exposes routing traces for explanation.",
    "packages/core/protocol-adapter/mcp-application-server.js now provides a transport-neutral MCP-compatible request dispatcher.",
    "packages/core/protocol-adapter/demo-application-server.js now gives the demo application the same handleMessage boundary used by multiple transports.",
    "packages/transports/stdio/stdio-transport.js now provides a real stdio transport adapter with Content-Length framing.",
    "packages/transports/http-sse/gateway-server.js now provides a sticky-session HTTP/SSE gateway with an inspector and SSE event streaming.",
    "packages/gateway/session-registry/file-session-registry.js now provides durable file-backed session persistence for restart and reconnect flows.",
    "packages/gateway/session-registry/*.js now track session expiry, disconnect state, and reconnect grace metadata.",
    "examples/shared/scaling-demo-server.js, examples/stdio-server/server.js, and examples/http-sse-server/server.js prove the transports can be exercised locally.",
    "packages/gateway/demo/local-demo-controller.js simulates fake MCP instances, sessions, and decision logs.",
    "apps/local-dashboard/server.js serves the local dashboard and JSON API.",
    "apps/local-dashboard/public/* renders the self-explaining UI and interactive controls.",
  ],
  testProof: [
    "Transport-agnostic tests verify initialize, tools/list, tools/call, and notifications through the reusable core.",
    "Stdio adapter tests verify framed MCP-style input and output behavior.",
    "Demo-application parity tests verify the same basic behavior can run through both stdio and HTTP/SSE-oriented flows.",
    "Session registry unit tests verify assign, update, delete, deleteByServer, and list copy behavior.",
    "Lifecycle tests verify session TTL expiry, disconnect grace windows, and explicit reinitialize requirements after grace expiration.",
    "Router tests verify least-loaded selection, sticky existing sessions, overload blocking, unhealthy reassignment, and trace output.",
    "Dashboard smoke tests verify the local UI and API start correctly and expose live state.",
    "Gateway failover tests now prove durable restart reconnects and explicit recovery actions such as reconnected-from-registry and reassigned-and-rehydrated.",
  ],
  walkthrough: [
    "Create a new session and watch the least-loaded healthy instance win.",
    "Raise one instance above the threshold, then create another session and confirm it is skipped.",
    "Route an existing session again and confirm it stays sticky to the same server.",
    "Mark the assigned server unhealthy, route the session again, and watch the reassignment step appear in the decision log.",
    "In the runtime panel, disconnect a session, reconnect within the grace window, and observe the explicit recovery action.",
  ],
  runtime: {
    title: "Real HTTP/SSE gateway view",
    body:
      "This section uses the real in-process HTTP/SSE gateway controller, so the main dashboard can show both the explainer model and actual transport-backed gateway behavior on the same page.",
    policy:
      "Runtime sessions now have an explicit lease. Every successful request refreshes the session TTL, and a disconnected client gets a short reconnect grace window before the gateway requires re-initialize.",
  },
};

export class LocalDemoController {
  #loadThreshold;
  #registry;
  #router;
  #events = [];
  #nextSessionNumber = 1;
  #runtimeController;
  #runtimeCollectors = new Map();
  #runtimeEvents = [];
  #runtimeRegistryPath;
  #runtimeInstances = [];
  #runtimeSessionTtlMs;
  #runtimeReconnectGraceMs;

  constructor({
    loadThreshold = DEFAULT_LOAD_THRESHOLD,
    initialInstances = DEFAULT_INSTANCES,
    runtimeRegistryPath,
  } = {}) {
    if (typeof loadThreshold !== "number" || loadThreshold < 0 || loadThreshold > 1) {
      throw new RangeError("loadThreshold must be a number between 0 and 1");
    }

    this.#loadThreshold = loadThreshold;
    this.#runtimeRegistryPath = runtimeRegistryPath ?? join("/tmp", `mcp-dashboard-registry-${randomUUID()}.json`);
    this.#runtimeSessionTtlMs = DEFAULT_RUNTIME_SESSION_TTL_MS;
    this.#runtimeReconnectGraceMs = DEFAULT_RUNTIME_RECONNECT_GRACE_MS;
    this.reset(initialInstances);
  }

  reset(initialInstances = DEFAULT_INSTANCES) {
    removeRegistryFile(this.#runtimeRegistryPath);
    this.#registry = new MemorySessionRegistry();
    this.#router = new LoadRouter({
      sessionRegistry: this.#registry,
      loadThreshold: this.#loadThreshold,
    });
    this.#runtimeInstances = initialInstances.map((instance) => ({ ...instance }));
    this.#runtimeController = this.#buildRuntimeController();
    this.#events = [];
    this.#runtimeCollectors = new Map();
    this.#runtimeEvents = [];
    this.#nextSessionNumber = 1;

    for (const instance of initialInstances) {
      this.#router.upsertInstance(instance);
    }

    this.#recordEvent({
      kind: "system",
      title: "Dashboard reset",
      summary: "Seeded fake MCP server instances for a fresh local demo.",
      steps: [
        `Loaded ${initialInstances.length} fake server instances.`,
        `New session threshold is ${this.#loadThreshold}.`,
      ],
    });

    return this.getState();
  }

  getState() {
    const instances = sortInstances(this.#router.listInstances());
    const sessions = sortSessions(this.#registry.list());

    return {
      dashboard: DASHBOARD_COPY,
      loadThreshold: this.#loadThreshold,
      instances,
      sessions,
      events: this.#events.map((event) => ({
        ...event,
        steps: [...event.steps],
      })),
      summary: {
        totalInstances: instances.length,
        healthyInstances: instances.filter((instance) => instance.healthy).length,
        overloadedInstances: instances.filter((instance) => instance.load >= this.#loadThreshold).length,
        activeSessions: sessions.length,
      },
      runtime: this.#getRuntimeState(),
    };
  }

  createSession(sessionId) {
    const normalizedSessionId = normalizeOptionalSessionId(sessionId) ?? `session-${this.#nextSessionNumber++}`;
    return this.#routeSession(normalizedSessionId, { mode: "create" });
  }

  routeSession(sessionId) {
    const normalizedSessionId = normalizeRequiredSessionId(sessionId);
    return this.#routeSession(normalizedSessionId, { mode: "route" });
  }

  updateInstance(serverInstanceId, updates) {
    const normalizedServerInstanceId = normalizeRequiredServerInstanceId(serverInstanceId);
    const current = this.#router.listInstances().find(
      (instance) => instance.serverInstanceId === normalizedServerInstanceId,
    );

    if (!current) {
      throw new Error(`Unknown server instance: ${normalizedServerInstanceId}`);
    }

    const next = this.#router.upsertInstance({
      ...current,
      ...updates,
    });
    const nextRuntime = this.#runtimeController.upsertInstance({
      ...current,
      ...updates,
    });
    this.#runtimeInstances = this.#runtimeInstances.map((instance) =>
      instance.serverInstanceId === nextRuntime.serverInstanceId ? { ...nextRuntime } : instance,
    );

    this.#recordEvent({
      kind: "instance-update",
      title: `Updated ${normalizedServerInstanceId}`,
      summary: "Changed fake server health or load for the local demo.",
      steps: [
        `healthy = ${next.healthy}`,
        `acceptingNewSessions = ${next.acceptingNewSessions}`,
        `load = ${next.load}`,
      ],
    });

    return {
      instance: next,
      state: this.getState(),
    };
  }

  async createRuntimeSession(clientId) {
    const result = await this.#runtimeController.handleGatewayMessage({
      method: "initialize",
      params: {
        clientId: clientId ?? `dashboard-client-${this.#runtimeCollectors.size + 1}`,
      },
    });

    this.#attachRuntimeCollector(result.sessionId);
    this.#recordRuntimeEvent({
      kind: "runtime-session",
      title: `Initialized runtime session ${result.sessionId}`,
      summary: `The in-process HTTP/SSE gateway assigned ${result.sessionId} to ${result.serverInstanceId}.`,
      details: [
        `sessionId = ${result.sessionId}`,
        `serverInstanceId = ${result.serverInstanceId}`,
        `reusedExistingSession = ${result.reusedExistingSession}`,
        `recovery.action = ${result.recovery.action}`,
      ],
    });

    return {
      result,
      state: this.getState(),
    };
  }

  async echoRuntimeSession(sessionId, message) {
    const normalizedSessionId = normalizeRequiredSessionId(sessionId);
    this.#attachRuntimeCollector(normalizedSessionId);
    const result = await this.#runtimeController.handleGatewayMessage({
      method: "echo",
      sessionId: normalizedSessionId,
      params: {
        message: message ?? "dashboard runtime echo",
      },
    });

    this.#recordRuntimeEvent({
      kind: "runtime-echo",
      title: `Echoed runtime session ${normalizedSessionId}`,
      summary: `The in-process HTTP/SSE gateway kept ${normalizedSessionId} on ${result.serverInstanceId}.`,
      details: [
        `sessionId = ${result.sessionId}`,
        `serverInstanceId = ${result.serverInstanceId}`,
        `message = ${result.result.message}`,
        `requestCount = ${result.result.requestCount}`,
        `recovery.action = ${result.recovery.action}`,
      ],
    });

    return {
      result,
      state: this.getState(),
    };
  }

  disconnectRuntimeSession(sessionId) {
    const normalizedSessionId = normalizeRequiredSessionId(sessionId);
    const collector = this.#runtimeCollectors.get(normalizedSessionId);
    if (collector) {
      this.#runtimeController.detachEventStream(normalizedSessionId, collector);
      this.#runtimeCollectors.delete(normalizedSessionId);
    } else {
      this.#runtimeController.sessionRegistry.markDisconnected?.(normalizedSessionId, {
        gracePeriodMs: this.#runtimeReconnectGraceMs,
      });
    }

    const record = this.#runtimeController.sessionRegistry.get(normalizedSessionId);
    this.#recordRuntimeEvent({
      kind: "runtime-disconnect",
      title: `Disconnected runtime session ${normalizedSessionId}`,
      summary: `The gateway marked ${normalizedSessionId} as disconnected and started its reconnect grace window.`,
      details: record
        ? [
            `sessionId = ${record.sessionId}`,
            `connectionState = ${record.metadata.connectionState}`,
            `graceUntil = ${record.metadata.graceUntil}`,
          ]
        : [`sessionId = ${normalizedSessionId}`, "No registry record was found after disconnect."],
    });

    return this.getState();
  }

  restartRuntimeController() {
    this.#runtimeCollectors = new Map();
    this.#runtimeController = this.#buildRuntimeController();
    this.#recordRuntimeEvent({
      kind: "runtime-restart",
      title: "Restarted runtime gateway controller",
      summary: "A fresh in-process HTTP/SSE gateway controller was created using the same durable session registry file.",
      details: [
        `registry.mode = ${this.#runtimeController.describeRegistry().mode}`,
        `registry.durable = ${this.#runtimeController.describeRegistry().durable}`,
      ],
    });

    return this.getState();
  }

  #routeSession(sessionId, { mode }) {
    try {
      const decision = this.#router.explainRoute(sessionId);
      const title = mode === "create" ? `Created ${sessionId}` : `Routed ${sessionId}`;
      const summary = decision.reusedExistingSession
        ? `${sessionId} stayed on ${decision.serverInstanceId} because the assigned instance is still healthy.`
        : `${sessionId} was assigned to ${decision.serverInstanceId} using the new-session policy.`;

      this.#recordEvent({
        kind: "routing",
        title,
        summary,
        steps: decision.trace.map((entry) => describeTraceEntry(entry, this.#loadThreshold)),
      });

      return {
        decision,
        state: this.getState(),
      };
    } catch (error) {
      this.#recordEvent({
        kind: "routing-error",
        title: `Routing failed for ${sessionId}`,
        summary: error.message,
        steps: Array.isArray(error.trace)
          ? error.trace.map((entry) => describeTraceEntry(entry, this.#loadThreshold))
          : ["No trace details were available."],
      });
      throw error;
    }
  }

  #recordEvent(event) {
    const entry = {
      id: `event-${this.#events.length + 1}`,
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.#events = [entry, ...this.#events].slice(0, 20);
  }

  #getRuntimeState() {
    const instances = sortInstances(this.#runtimeController.router.listInstances());
    const sessions = sortSessions(this.#runtimeController.sessionRegistry.list());
    return {
      title: DASHBOARD_COPY.runtime.title,
      body: DASHBOARD_COPY.runtime.body,
      policy: DASHBOARD_COPY.runtime.policy,
      instances,
      sessions,
      events: this.#runtimeEvents.map((event) => ({ ...event })),
      latestSessionId: sessions.at(-1)?.sessionId ?? null,
      registry: this.#runtimeController.describeRegistry(),
    };
  }

  #attachRuntimeCollector(sessionId) {
    if (this.#runtimeCollectors.has(sessionId)) {
      return this.#runtimeCollectors.get(sessionId);
    }

    const collector = {
      sessionId,
      chunks: [],
      write: (chunk) => {
        collector.chunks.push(String(chunk));
        if (String(chunk).includes("\n\n")) {
          for (const event of parseRuntimeEvents(collector.chunks.join(""))) {
            this.#recordRuntimeEvent({
              kind: "runtime-sse",
              title: `Runtime SSE: ${event.event}`,
              summary: `${event.event} for ${sessionId} on ${event.data?.serverInstanceId ?? "unknown-server"}.`,
              details: flattenRuntimeEventDetails(event),
            });
          }
          collector.chunks = [];
        }
      },
    };
    this.#runtimeCollectors.set(sessionId, collector);
    this.#runtimeController.attachEventStream(sessionId, collector);
    return collector;
  }

  #recordRuntimeEvent(event) {
    const entry = {
      id: `runtime-event-${this.#runtimeEvents.length + 1}`,
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.#runtimeEvents = [entry, ...this.#runtimeEvents].slice(0, 20);
  }

  #buildRuntimeController() {
    return createHttpSseGatewayController({
      serverInstances: this.#runtimeInstances,
      loadThreshold: this.#loadThreshold,
      sessionRegistry: new FileSessionRegistry({
        filePath: this.#runtimeRegistryPath,
      }),
      sessionTtlMs: this.#runtimeSessionTtlMs,
      reconnectGracePeriodMs: this.#runtimeReconnectGraceMs,
    });
  }
}

function describeTraceEntry(entry, loadThreshold) {
  switch (entry.type) {
    case "lookup":
      return entry.existingServerInstanceId
        ? `Checked session registry: ${entry.sessionId} already points to ${entry.existingServerInstanceId}.`
        : `Checked session registry: ${entry.sessionId} does not have an assigned server yet.`;
    case "reuse-existing-session":
      return `Reused existing assignment on ${entry.serverInstanceId} because it is still healthy.`;
    case "existing-session-reassignment-required":
      return `Existing assignment could not be reused because ${entry.previousServerInstanceId} was ${entry.reason.replaceAll("-", " ")}.`;
    case "instance-evaluated":
      return entry.eligible
        ? `Evaluated ${entry.serverInstanceId}: healthy=${entry.healthy}, accepting=${entry.acceptingNewSessions}, load=${entry.load}. Eligible for new sessions.`
        : `Evaluated ${entry.serverInstanceId}: skipped because ${entry.reasons.join("; ")}.`;
    case "instance-selected":
      return `Selected ${entry.serverInstanceId} as the least-loaded healthy instance below threshold ${loadThreshold}.`;
    case "session-assigned":
      return `Stored session affinity: ${entry.sessionId} -> ${entry.serverInstanceId}.`;
    case "no-instance-selected":
      return "No healthy server instance was available for a new session.";
    default:
      return `Observed routing step: ${entry.type}.`;
  }
}

function sortInstances(instances) {
  return [...instances].sort((left, right) => left.serverInstanceId.localeCompare(right.serverInstanceId));
}

function sortSessions(sessions) {
  return [...sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function normalizeOptionalSessionId(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeRequiredSessionId(value);
}

function normalizeRequiredSessionId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("sessionId must be a non-empty string");
  }

  return value.trim();
}

function normalizeRequiredServerInstanceId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("serverInstanceId must be a non-empty string");
  }

  return value.trim();
}

function parseRuntimeEvents(rawBody) {
  return rawBody
    .split("\n\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
      const data = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
      return {
        event,
        data: data ? JSON.parse(data) : null,
      };
    });
}

function flattenRuntimeEventDetails(event) {
  if (!event?.data || typeof event.data !== "object") {
    return [];
  }

  return Object.entries(event.data).map(([key, value]) => {
    if (value && typeof value === "object") {
      return `${key} = ${JSON.stringify(value)}`;
    }

    return `${key} = ${String(value)}`;
  });
}
