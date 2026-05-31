import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createDemoApplicationServer } from "../../core/protocol-adapter/demo-application-server.js";
import { DEFAULT_GATEWAY_OPERATOR_CONFIG, resolveOperatorConfig } from "../../gateway/config/operator-config.js";
import { LoadRouter, normalizeRuntimeMode } from "../../gateway/load-balancer/load-router.js";
import { createGatewayObserver } from "../../gateway/observability/gateway-observer.js";
import { analyzeRuntimeAffinity } from "../../gateway/runtime-classifier/runtime-classifier.js";
import { createSessionRegistry } from "../../gateway/session-registry/create-session-registry.js";

const MAX_JSON_BODY_BYTES = 1_048_576;
const MAX_QUEUED_DISCONNECT_EVENTS_PER_SESSION = 100;

export function createHttpSseGatewayServer({
  serverInstances = [
    { serverInstanceId: "server-a", load: 0.2, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.4, healthy: true, acceptingNewSessions: true },
  ],
  createApplication,
  operatorConfig,
  loadThreshold,
  autoScaleThreshold,
  sessionRegistry,
  sessionTtlMs,
  reconnectGracePeriodMs,
  onDisconnect,
  redisUrl,
  autoScalerHook,
  redisClient,
  fetchImpl = globalThis.fetch,
  auditLogger = console,
  now = () => Date.now(),
} = {}) {
  const resolvedOperatorConfig = resolveOperatorConfig({
    config: mergeExplicitOperatorConfig(operatorConfig, {
      loadThreshold,
      autoScaleThreshold,
      sessionTtlMs,
      reconnectGracePeriodMs,
      onDisconnect,
      sessionRegistryRedisUrl: redisUrl,
    }),
    defaults: DEFAULT_GATEWAY_OPERATOR_CONFIG,
  });
  const controller = createHttpSseGatewayController({
    serverInstances,
    createApplication,
    operatorConfig: resolvedOperatorConfig,
    sessionRegistry,
    redisUrl,
    redisClient,
    now,
  });
  const server = createServer(createGatewayHttpHandler({ controller }));
  server.on("error", (error) => {
    auditLogger.error?.("[HTTP/SSE gateway] HTTP server error", error);
  });
  server.on("clientError", (error, socket) => {
    auditLogger.error?.("[HTTP/SSE gateway] HTTP client error", error);
    if (!socket?.writable) {
      return;
    }

    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return {
    server,
    router: controller.router,
    sessionRegistry: controller.sessionRegistry,
    applications: controller.applications,
    async listen(portOrOptions = resolvedOperatorConfig.port, maybeHost) {
      const listenOptions = normalizeGatewayListenOptions({
        defaults: resolvedOperatorConfig,
        portOrOptions,
        maybeHost,
      });
      let address;
      try {
        address = await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve(server.address());
          };
          server.once("error", onError);
          server.listen(listenOptions.port, listenOptions.host, () => {
            onListening();
          });
        });

        await runStartupSecurityAudit({
          address,
          allowPublicBind: listenOptions.allowPublicBind,
          auditLogger: listenOptions.auditLogger ?? auditLogger,
          enforceStartupSecurityAudit: listenOptions.enforceStartupSecurityAudit,
          fetchImpl: listenOptions.fetchImpl ?? fetchImpl,
          host: listenOptions.host,
          port: address.port,
        });
      } catch (error) {
        await closeHttpServer(server);
        await controller.sessionRegistry.close?.();
        throw error;
      }

      return address;
    },
    async close() {
      await controller.sessionRegistry.close?.();
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
          sessions: await controller.sessionRegistry.list(),
        });
      }

      if (request.method === "GET" && url.pathname === "/sessions") {
        return sendJson(response, 200, {
          instances: controller.router.listInstances(),
          sessions: await controller.sessionRegistry.list(),
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

        const route = await controller.attachEventStream(sessionId, response);

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
        for (const queuedEvent of route?.queuedDisconnectEvents ?? []) {
          writeSse(response, queuedEvent.event, queuedEvent.payload);
        }

        request.on?.("close", () => {
          controller.detachEventStream(sessionId, response).catch(() => {});
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
  autoScaleThreshold,
  autoScalerHook,
  sessionRegistry,
  sessionTtlMs,
  reconnectGracePeriodMs,
  onDisconnect,
  redisUrl,
  redisClient,
  now = () => Date.now(),
} = {}) {
  const resolvedOperatorConfig = resolveOperatorConfig({
    config: mergeExplicitOperatorConfig(operatorConfig, {
      loadThreshold,
      autoScaleThreshold,
      sessionTtlMs,
      reconnectGracePeriodMs,
      onDisconnect,
      sessionRegistryRedisUrl: redisUrl,
    }),
    defaults: DEFAULT_GATEWAY_OPERATOR_CONFIG,
  });
  const {
    loadThreshold: effectiveLoadThreshold,
    autoScaleThreshold: effectiveAutoScaleThreshold,
    sessionTtlMs: effectiveSessionTtlMs,
    reconnectGracePeriodMs: effectiveReconnectGracePeriodMs,
    onDisconnect: effectiveOnDisconnect,
    host: effectiveHost,
    allowPublicBind: effectiveAllowPublicBind,
    enforceStartupSecurityAudit: effectiveEnforceStartupSecurityAudit,
  } = resolvedOperatorConfig;
  let adaptivePlacementEnabled = resolvedOperatorConfig.adaptivePlacementEnabled;
  const resolvedSessionRegistry =
    sessionRegistry ??
    createSessionRegistry({
      backend: resolvedOperatorConfig.sessionRegistryBackend,
      filePath: resolvedOperatorConfig.sessionRegistryFilePath,
      now,
      redisClient,
      redisKey: resolvedOperatorConfig.sessionRegistryRedisKey,
      redisUrl: resolvedOperatorConfig.sessionRegistryRedisUrl,
    });
  const router = new LoadRouter({
    sessionRegistry: resolvedSessionRegistry,
    loadThreshold: effectiveLoadThreshold,
    autoScaleThreshold: effectiveAutoScaleThreshold,
    autoScalerHook,
  });
  const applications = new Map();
  const eventStreams = new Map();
  const queuedDisconnectEvents = new Map();
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
        autoScaleThreshold: effectiveAutoScaleThreshold,
        sessionTtlMs: effectiveSessionTtlMs,
        reconnectGracePeriodMs: effectiveReconnectGracePeriodMs,
        onDisconnect: effectiveOnDisconnect,
        host: effectiveHost,
        allowPublicBind: effectiveAllowPublicBind,
        enforceStartupSecurityAudit: effectiveEnforceStartupSecurityAudit,
        adaptivePlacementEnabled,
        filePath:
          typeof resolvedSessionRegistry.filePath === "function"
            ? resolvedSessionRegistry.filePath()
            : undefined,
        redisKey:
          typeof resolvedSessionRegistry.redisKey === "function"
            ? resolvedSessionRegistry.redisKey()
            : undefined,
        redisUrlConfigured: Boolean(resolvedOperatorConfig.sessionRegistryRedisUrl),
      };
    },
    describeObservability() {
      return {
        operatorConfig: {
          adaptivePlacementEnabled,
        },
        summary: observer.summary(),
        recentEvents: observer.listEvents(),
      };
    },
    setAdaptivePlacementEnabled(enabled) {
      if (typeof enabled !== "boolean") {
        throw new TypeError("adaptivePlacementEnabled must be a boolean");
      }
      adaptivePlacementEnabled = enabled;
      observer.record("adaptive.placement.flag.updated", {
        adaptivePlacementEnabled,
      });
      return adaptivePlacementEnabled;
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
    async attachEventStream(sessionId, response) {
      const record = await resolvedSessionRegistry.get(sessionId);
      if (!record) {
        queuedDisconnectEvents.delete(sessionId);
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
        await resolvedSessionRegistry.delete(sessionId);
        queuedDisconnectEvents.delete(sessionId);
        throw createGatewaySessionError({
          sessionId,
          code: "reconnect-grace-expired",
          statusCode: 410,
          message: "Reconnect grace period expired. Reinitialize the MCP session.",
        });
      }

      addEventStream(eventStreams, sessionId, response);
      const queuedEvents = takeQueuedDisconnectEvents({
        eventStreams,
        observer,
        queuedDisconnectEvents,
        response,
        sessionId,
      });
      if (typeof response.writeHead !== "function") {
        for (const queuedEvent of queuedEvents) {
          writeSse(response, queuedEvent.event, queuedEvent.payload);
        }
      }
      observer.record("stream.attached", {
        sessionId,
        serverInstanceId: record.serverInstanceId,
        activeSessionRecord: true,
        reconnectState,
      });
      return {
        ...record,
        queuedDisconnectEvents: queuedEvents,
      };
    },
    async detachEventStream(sessionId, response) {
      removeEventStream(eventStreams, sessionId, response);
      if (!hasActiveEventStream(eventStreams, sessionId)) {
        await resolvedSessionRegistry.markDisconnected?.(sessionId, {
          gracePeriodMs: effectiveReconnectGracePeriodMs,
        });
        const record = await resolvedSessionRegistry.get(sessionId);
        applyDisconnectPolicy({
          eventStreams,
          observer,
          queuedDisconnectEvents,
          response,
          sessionId,
          policy: effectiveOnDisconnect,
          serverInstanceId: record?.serverInstanceId ?? null,
        });
      }
      observer.record("stream.detached", {
        sessionId,
        remainingAttachments: eventStreams.get(sessionId)?.size ?? 0,
      });
    },
    async handleGatewayMessage(body) {
      const method = body.method;
      const sessionId = body.sessionId ?? (method === "initialize" ? randomUUID() : undefined);
      try {
        await resolvedSessionRegistry.pruneExpired?.();
        await pruneQueuedDisconnectEvents({
          queuedDisconnectEvents,
          sessionRegistry: resolvedSessionRegistry,
        });
        const existingSessionRecord = sessionId
          ? await resolvedSessionRegistry.get(sessionId)
          : undefined;
        const phase2RuntimeMode = resolveRuntimeMode({
          body,
          existingSessionRecord,
        });
        const baseRuntimeRecommendation = resolveRuntimeRecommendation({
          body,
          existingSessionRecord,
          method,
          runtimeMode: phase2RuntimeMode,
        });
        const placement = resolvePlacementRuntimeMode({
          adaptivePlacementEnabled,
          existingSessionRecord,
          explicitRuntimeMode: body.runtimeMode ?? body.params?.runtimeMode,
          phase2RuntimeMode,
          runtimeRecommendation: baseRuntimeRecommendation,
        });
        const runtimeMode = placement.runtimeMode;
        const runtimeRecommendation = {
          ...baseRuntimeRecommendation,
          phase: adaptivePlacementEnabled ? "adaptive-placement" : baseRuntimeRecommendation.phase,
          automaticPlacement: adaptivePlacementEnabled,
          effectiveRuntimeMode: runtimeMode,
          adaptivePlacement: {
            enabled: adaptivePlacementEnabled,
            applied: placement.applied,
            source: placement.source,
            driftFromPhase2Mode: placement.driftFromPhase2Mode,
          },
        };
        const requestNow = now();
        observer.record("request.received", {
          method,
          sessionId,
          existingSessionRecord: Boolean(existingSessionRecord),
          runtimeMode,
          runtimeRecommendation,
        });
        observer.record("runtime.recommendation", {
          method,
          sessionId,
          runtimeMode,
          runtimeRecommendation,
        });
        if (placement.applied) {
          observer.record("adaptive.placement.applied", {
            method,
            sessionId,
            phase2RuntimeMode,
            runtimeMode,
            recommendedMode: runtimeRecommendation.recommendedMode,
            driftFromPhase2Mode: placement.driftFromPhase2Mode,
            source: placement.source,
          });
        }

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
          await resolvedSessionRegistry.delete(sessionId);
          queuedDisconnectEvents.delete(sessionId);
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

        const route = await router.routeSession(sessionId, { runtimeMode });
        const lifecycleMetadata = buildLifecycleMetadata({
          existingRecord: existingSessionRecord,
          clientId: body.params?.clientId ?? existingSessionRecord?.metadata?.clientId ?? "anonymous-client",
          now: requestNow,
          runtimeMode,
          sessionTtlMs: effectiveSessionTtlMs,
        });
        await resolvedSessionRegistry.assign(
          sessionId,
          route.serverInstanceId,
          lifecycleMetadata,
        );
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

        publishEvent(eventStreams, sessionId, "route.selected", {
          sessionId,
          serverInstanceId: route.serverInstanceId,
          reusedExistingSession: route.reusedExistingSession,
          runtimeMode: route.runtimeMode,
          observedAt: new Date().toISOString(),
        });
        observer.record("route.completed", {
          method,
          sessionId,
          serverInstanceId: route.serverInstanceId,
          reusedExistingSession: route.reusedExistingSession,
          recoveryAction,
          runtimeMode: route.runtimeMode,
          runtimeRecommendation,
        });

        return {
          sessionId,
          serverInstanceId: route.serverInstanceId,
          reusedExistingSession: route.reusedExistingSession,
          runtimeMode: route.runtimeMode,
          runtimeRecommendation,
          recovery: {
            action: recoveryAction,
            registry: this.describeRegistry(),
            registryRecordFound: Boolean(existingSessionRecord),
          },
          result,
        };
      } catch (error) {
        if (error?.code !== "session-not-found" && error?.code !== "reconnect-grace-expired") {
          observer.record("request.failed", {
            method,
            sessionId: sessionId ?? null,
            code: error?.code ?? "gateway-request-failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
    listPublishedEvents(sessionId) {
      return Array.from(eventStreams.get(sessionId) ?? []);
    },
    listQueuedDisconnectEvents(sessionId) {
      return (queuedDisconnectEvents.get(sessionId) ?? []).map((entry) => ({
        event: entry.event,
        payload: { ...entry.payload },
      }));
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
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_JSON_BODY_BYTES) {
      throw createHttpError({
        statusCode: 413,
        code: "request-body-too-large",
        message: "Request body exceeds the 1MB limit.",
      });
    }

    chunks.push(buffer);
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

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (!error || error.code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }

      reject(error);
    });
  });
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
    if (!writeSse(response, event, payload)) {
      clients.delete(response);
    }
  }

  if (clients.size === 0) {
    eventStreams.delete(sessionId);
  }
}

function writeSse(response, event, payload) {
  try {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    response.destroy?.();
    return false;
  }
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

function buildLifecycleMetadata({ existingRecord, clientId, now, runtimeMode, sessionTtlMs }) {
  return {
    clientId,
    runtimeMode,
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

function resolveRuntimeMode({ body, existingSessionRecord }) {
  const requestedRuntimeMode =
    body.runtimeMode ??
    body.params?.runtimeMode ??
    existingSessionRecord?.metadata?.runtimeMode ??
    "sticky";

  try {
    return normalizeRuntimeMode(requestedRuntimeMode);
  } catch (cause) {
    throw createGatewaySessionError({
      sessionId: body.sessionId,
      code: "invalid-runtime-mode",
      statusCode: 400,
      message: cause.message,
    });
  }
}

function resolveRuntimeRecommendation({ body, existingSessionRecord, method, runtimeMode }) {
  try {
    return analyzeRuntimeAffinity({
      explicitRuntimeMode:
        body.runtimeMode ?? body.params?.runtimeMode,
      existingRuntimeMode: existingSessionRecord?.metadata?.runtimeMode,
      method,
      runtimeHints: body.runtimeHints ?? body.params?.runtimeHints ?? {},
      transport: "http-sse",
    });
  } catch (cause) {
    return {
      phase: "recommendation-only",
      automaticPlacement: false,
      transport: "http-sse",
      method: method ?? null,
      effectiveRuntimeMode: runtimeMode,
      explicitRuntimeMode: body.runtimeMode ?? body.params?.runtimeMode ?? null,
      existingRuntimeMode: existingSessionRecord?.metadata?.runtimeMode ?? null,
      recommendedMode: runtimeMode,
      confidence: "low",
      scores: {
        stateless: 0,
        sticky: 0,
      },
      signals: {
        invalidHints: ["classifier-error"],
      },
      reasons: [
        {
          code: "classifier-error-ignored",
          message: "Runtime recommendation failed and was ignored; explicit routing mode was preserved.",
          weight: 0,
          error: cause instanceof Error ? cause.message : String(cause),
        },
      ],
      explicitOverride: false,
    };
  }
}

function resolvePlacementRuntimeMode({
  adaptivePlacementEnabled,
  existingSessionRecord,
  explicitRuntimeMode,
  phase2RuntimeMode,
  runtimeRecommendation,
}) {
  if (!adaptivePlacementEnabled) {
    return {
      runtimeMode: phase2RuntimeMode,
      applied: false,
      source: "phase-2-routing",
      driftFromPhase2Mode: false,
    };
  }

  if (explicitRuntimeMode !== undefined) {
    return {
      runtimeMode: phase2RuntimeMode,
      applied: false,
      source: "explicit-runtime-mode",
      driftFromPhase2Mode: false,
    };
  }

  if (existingSessionRecord) {
    return {
      runtimeMode: phase2RuntimeMode,
      applied: false,
      source: "existing-session-mode",
      driftFromPhase2Mode: false,
    };
  }

  let recommendedMode;
  try {
    recommendedMode = normalizeRuntimeMode(runtimeRecommendation.recommendedMode);
  } catch {
    return {
      runtimeMode: phase2RuntimeMode,
      applied: false,
      source: "invalid-classifier-recommendation",
      driftFromPhase2Mode: false,
    };
  }

  return {
    runtimeMode: recommendedMode,
    applied: true,
    source: "classifier-recommendation",
    driftFromPhase2Mode: recommendedMode !== phase2RuntimeMode,
  };
}

function applyDisconnectPolicy({
  eventStreams,
  observer,
  queuedDisconnectEvents,
  sessionId,
  policy,
  serverInstanceId,
}) {
  observer.record("disconnect.policy.applied", {
    sessionId,
    serverInstanceId,
    policy,
    action:
      policy === "queue" ? "queue-results-until-reconnect" : "cancel-in-flight-work",
  });

  if (policy !== "queue") {
    queuedDisconnectEvents.delete(sessionId);
    return;
  }

  const payload = {
    sessionId,
    serverInstanceId,
    policy,
    action: "queue-results-until-reconnect",
    observedAt: new Date().toISOString(),
  };
  queueDisconnectEvent({
    eventStreams,
    observer,
    queuedDisconnectEvents,
    sessionId,
    event: "disconnect.policy.queued",
    payload,
  });
}

function queueDisconnectEvent({
  eventStreams,
  observer,
  queuedDisconnectEvents,
  sessionId,
  event,
  payload,
}) {
  if (hasActiveEventStream(eventStreams, sessionId)) {
    publishEvent(eventStreams, sessionId, event, payload);
    return;
  }

  const queued = queuedDisconnectEvents.get(sessionId) ?? [];
  queued.push({
    event,
    payload,
  });
  while (queued.length > MAX_QUEUED_DISCONNECT_EVENTS_PER_SESSION) {
    queued.shift();
  }
  queuedDisconnectEvents.set(sessionId, queued);
  observer.record("disconnect.queue.buffered", {
    sessionId,
    queuedEvent: event,
    queuedEventCount: queued.length,
  });
}

function takeQueuedDisconnectEvents({
  eventStreams,
  observer,
  queuedDisconnectEvents,
  response,
  sessionId,
}) {
  const queued = queuedDisconnectEvents.get(sessionId);
  if (!queued?.length) {
    return [];
  }

  queuedDisconnectEvents.delete(sessionId);
  observer.record("disconnect.queue.flushed", {
    sessionId,
    flushedEventCount: queued.length,
    hasActiveStream: hasActiveEventStream(eventStreams, sessionId),
  });
  return queued.map((queuedEvent) => ({
    event: queuedEvent.event,
    payload: { ...queuedEvent.payload },
  }));
}

async function pruneQueuedDisconnectEvents({ queuedDisconnectEvents, sessionRegistry }) {
  if (queuedDisconnectEvents.size === 0 || typeof sessionRegistry?.get !== "function") {
    return;
  }

  for (const sessionId of queuedDisconnectEvents.keys()) {
    if (!(await sessionRegistry.get(sessionId))) {
      queuedDisconnectEvents.delete(sessionId);
    }
  }
}

function createHttpError({ statusCode, code, message }) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
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

function normalizeGatewayListenOptions({
  defaults,
  portOrOptions,
  maybeHost,
} = {}) {
  if (typeof portOrOptions === "object" && portOrOptions !== null) {
    return {
      port: portOrOptions.port ?? defaults.port,
      host: portOrOptions.host ?? defaults.host,
      allowPublicBind:
        portOrOptions.allowPublicBind ?? defaults.allowPublicBind,
      enforceStartupSecurityAudit:
        portOrOptions.enforceStartupSecurityAudit ??
        defaults.enforceStartupSecurityAudit,
      fetchImpl: portOrOptions.fetchImpl,
      auditLogger: portOrOptions.auditLogger,
    };
  }

  return {
    port: portOrOptions ?? defaults.port,
    host: maybeHost ?? defaults.host,
    allowPublicBind: defaults.allowPublicBind,
    enforceStartupSecurityAudit: defaults.enforceStartupSecurityAudit,
  };
}

export function isPublicBindHost(host) {
  return host === "0.0.0.0" || host === "::";
}

export async function runStartupSecurityAudit({
  address,
  allowPublicBind,
  auditLogger = console,
  enforceStartupSecurityAudit,
  fetchImpl = globalThis.fetch,
  host,
  port,
} = {}) {
  const effectiveHost =
    typeof host === "string" && host.length > 0 ? host : address?.address;
  const effectivePort = port ?? address?.port;

  if (!isPublicBindHost(effectiveHost)) {
    return;
  }

  auditLogger.error?.(
    `[SECURITY WARNING] Gateway is binding to ${effectiveHost}:${effectivePort}.`,
  );

  if (allowPublicBind !== true) {
    throw new Error(
      "FATAL: Gateway is publicly accessible and vulnerable to hijacking. Shutting down.",
    );
  }

  if (enforceStartupSecurityAudit === false) {
    return;
  }

  const selfHijackSucceeded = await runSelfHijackProbe({
    fetchImpl,
    baseUrl: `http://127.0.0.1:${effectivePort}`,
  });

  if (selfHijackSucceeded) {
    throw new Error(
      "FATAL: Gateway is publicly accessible and vulnerable to hijacking. Shutting down.",
    );
  }
}

async function runSelfHijackProbe({ fetchImpl, baseUrl }) {
  const response = await fetchImpl(`${baseUrl}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "initialize",
      params: { clientId: "startup-self-hijack-probe" },
    }),
  });

  if (response.ok) {
    return true;
  }

  if (response.status === 401 || response.status === 403) {
    return false;
  }

  throw new Error("Startup self-hijack probe did not receive an unauthorized failure");
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
