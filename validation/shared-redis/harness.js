import { delay, fetchJson } from "../multicontainer/http-utils.js";

const DEFAULT_RELATIVE_PATH = "notes/shared-redis-proof.txt";
const DEFAULT_CONTENT = "shared redis gateway proof works";
const ADAPTIVE_CLIENT_ID = "shared-redis-adaptive-client";

export async function runSharedRedisGatewayProof({
  gatewayABaseUrl = process.env.MCP_SHARED_REDIS_GATEWAY_A_URL,
  gatewayBBaseUrl = process.env.MCP_SHARED_REDIS_GATEWAY_B_URL,
  remoteServerBaseUrls = parseRemoteServerUrls(
    process.env.MCP_SHARED_REDIS_SERVER_URLS,
  ),
  relativePath = DEFAULT_RELATIVE_PATH,
  content = DEFAULT_CONTENT,
  adaptivePlacement = false,
} = {}) {
  if (!gatewayABaseUrl || !gatewayBBaseUrl) {
    throw new TypeError(
      "Both gatewayABaseUrl and gatewayBBaseUrl are required for the shared Redis proof",
    );
  }

  await Promise.all([
    waitForGateway(gatewayABaseUrl),
    waitForGateway(gatewayBBaseUrl),
    ...Object.values(remoteServerBaseUrls ?? {}).map((baseUrl) => waitForGateway(baseUrl)),
  ]);

  const initialized = await sendGatewayMessage(gatewayABaseUrl, {
    method: "initialize",
    params: adaptivePlacement
      ? {
          clientId: ADAPTIVE_CLIENT_ID,
          runtimeHints: {
            replaySafe: true,
            readOnly: true,
            externalState: true,
          },
        }
      : { clientId: "shared-redis-client" },
  });

  const writeResult = await sendGatewayMessage(gatewayABaseUrl, {
    method: "tools/call",
    sessionId: initialized.sessionId,
    params: {
      name: "fs_write_text",
      arguments: {
        path: relativePath,
        content,
      },
    },
  });

  if (adaptivePlacement) {
    const alternateServerId = Object.keys(remoteServerBaseUrls ?? {}).find(
      (serverInstanceId) => serverInstanceId !== initialized.serverInstanceId,
    );
    if (!alternateServerId) {
      throw new Error("Adaptive shared Redis proof requires at least two remote servers");
    }

    await setInstanceHealth(gatewayBBaseUrl, initialized.serverInstanceId, {
      load: 0.7,
      healthy: true,
      acceptingNewSessions: true,
    });
    await setInstanceHealth(gatewayBBaseUrl, alternateServerId, {
      load: 0.1,
      healthy: true,
      acceptingNewSessions: true,
    });
    await delay(50);
  }

  const secondGatewayRead = await sendGatewayMessage(gatewayBBaseUrl, {
    method: "tools/call",
    sessionId: initialized.sessionId,
    params: {
      ...(adaptivePlacement
        ? {
            clientId: ADAPTIVE_CLIENT_ID,
            runtimeHints: {
              replaySafe: true,
              readOnly: true,
              externalState: true,
            },
          }
        : {}),
      name: "fs_read_text",
      arguments: {
        path: relativePath,
      },
    },
  });

  const secondGatewayList = await sendGatewayMessage(gatewayBBaseUrl, {
    method: "tools/call",
    sessionId: initialized.sessionId,
    params: {
      name: "fs_list",
      arguments: {
        path: "notes",
      },
    },
  });

  const gatewayASessions = await fetchJson(`${trimSlash(gatewayABaseUrl)}/sessions`);
  const gatewayBSessions = await fetchJson(`${trimSlash(gatewayBBaseUrl)}/sessions`);
  const gatewayAObservability = await fetchJson(`${trimSlash(gatewayABaseUrl)}/observability`);
  const gatewayBObservability = await fetchJson(`${trimSlash(gatewayBBaseUrl)}/observability`);
  const sharedSessionFromGatewayB = gatewayBSessions.sessions.find(
    (session) => session.sessionId === initialized.sessionId,
  );

  const crossGatewayReuse = adaptivePlacement
    ? secondGatewayRead.runtimeMode === "stateless" &&
      secondGatewayRead.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "existing-session" &&
      sharedSessionFromGatewayB?.metadata?.runtimeModeSource === "adaptive-classifier"
    : initialized.serverInstanceId === secondGatewayRead.serverInstanceId &&
      secondGatewayRead.reusedExistingSession === true &&
      initialized.runtimeMode === "sticky";

  const checks = {
    crossGatewayReuse,
    secondGatewayReadVisible:
      secondGatewayRead.result.structuredContent.content === content,
    secondGatewayListVisible:
      secondGatewayList.result.structuredContent.entries.some(
        (entry) => entry.name === "shared-redis-proof.txt",
      ),
    adaptivePlacement:
      !adaptivePlacement ||
      initialized.runtimeMode === "stateless" &&
        initialized.runtimeRecommendation?.adaptivePlacement?.applied === true &&
        initialized.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "adaptive-classifier",
    adaptiveCrossGatewayMetadata:
      !adaptivePlacement ||
      secondGatewayRead.runtimeMode === "stateless" &&
        secondGatewayRead.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "existing-session" &&
        sharedSessionFromGatewayB?.metadata?.runtimeMode === "stateless" &&
        sharedSessionFromGatewayB?.metadata?.runtimeModeSource === "adaptive-classifier",
    adaptiveDynamicRouting:
      !adaptivePlacement ||
      initialized.serverInstanceId !== secondGatewayRead.serverInstanceId,
    adaptiveTelemetry:
      !adaptivePlacement ||
      gatewayAObservability.summary.totalAdaptivePlacements === 1 &&
        gatewayAObservability.summary.totalAdaptivePlacementStateless === 1 &&
        gatewayAObservability.summary.totalAdaptivePlacementFallbacks === 0 &&
        gatewayAObservability.summary.totalAdaptivePlacementMismatches === 0 &&
        gatewayBObservability.summary.totalAdaptivePlacements === 0 &&
        gatewayBObservability.summary.totalAdaptivePlacementFallbacks === 0 &&
        gatewayBObservability.summary.totalAdaptivePlacementMismatches === 0,
  };

  const ok = Object.values(checks).every((val) => val === true);

  return {
    ok,
    topology: {
      gatewayABaseUrl: trimSlash(gatewayABaseUrl),
      gatewayBBaseUrl: trimSlash(gatewayBBaseUrl),
      remoteServers: Object.entries(remoteServerBaseUrls ?? {}).map(([serverInstanceId, baseUrl]) => ({
        serverInstanceId,
        baseUrl,
      })),
    },
    checks,
    gatewayA: {
      sessions: gatewayASessions,
      observability: gatewayAObservability,
    },
    gatewayB: {
      sessions: gatewayBSessions,
      observability: gatewayBObservability,
    },
    mcp: {
      initialize: initialized,
      writeResult: writeResult.result.structuredContent,
      secondGatewayReadResult: secondGatewayRead.result.structuredContent,
      secondGatewayReadServerInstanceId: secondGatewayRead.serverInstanceId,
      secondGatewayReadRuntimeMode: secondGatewayRead.runtimeMode,
      secondGatewayReadRuntimeModeSource:
        secondGatewayRead.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource ?? null,
      secondGatewayListResult: secondGatewayList.result.structuredContent,
    },
  };
}

async function sendGatewayMessage(gatewayBaseUrl, body) {
  return fetchJson(`${trimSlash(gatewayBaseUrl)}/message`, {
    method: "POST",
    body,
  });
}

async function setInstanceHealth(gatewayBaseUrl, serverInstanceId, patch) {
  return fetchJson(`${trimSlash(gatewayBaseUrl)}/instances`, {
    method: "POST",
    body: {
      serverInstanceId,
      ...patch,
    },
  });
}

function parseRemoteServerUrls(rawValue) {
  if (!rawValue) {
    return {};
  }

  return Object.fromEntries(
    rawValue
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [serverInstanceId, baseUrl] = pair.split("=");
        return [serverInstanceId, trimSlash(baseUrl)];
      }),
  );
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

async function waitForGateway(gatewayBaseUrl, { attempts = 120, delayMs = 500 } = {}) {
  const url = `${trimSlash(gatewayBaseUrl)}/health`;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fetchJson(url);
      return;
    } catch (error) {
      lastError = error;
      await delay(delayMs);
    }
  }

  throw lastError ?? new Error(`Gateway did not become ready: ${gatewayBaseUrl}`);
}
