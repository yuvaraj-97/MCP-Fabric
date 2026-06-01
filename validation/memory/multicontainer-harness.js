import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createFileBackedMemoryValidationStore } from "../../examples/shared/memory-validation-server.js";
import { delay, fetchJson } from "../multicontainer/http-utils.js";
import { allocatePort, spawnNodeProcess } from "../multicontainer/process-utils.js";

const DEFAULT_NAMESPACE = "operations";
const DEFAULT_KEY = "rollout-brief";
const DEFAULT_VALUE =
  "Use the gateway as the shared communication layer between clients and remote MCP servers.";
const ADAPTIVE_CLIENT_ID = "memory-multicontainer-adaptive-client";

export async function runMemoryMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  storeFile = createDefaultStoreFile(),
  cleanup = false,
  adaptivePlacement = false,
} = {}) {
  const processes = [];

  try {
    const topology = gatewayBaseUrl
      ? await connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls, storeFile })
      : await startLocalTopology({ storeFile, processes, adaptivePlacement });
    await waitForTopology(topology);

    const report = await driveMemoryRemoteProof({
      gatewayBaseUrl: topology.gatewayBaseUrl,
      remoteServers: topology.remoteServers,
      storeFile,
      adaptivePlacement,
    });

    return {
      ok: Object.values(report.checks).every((value) => value === true),
      mode: topology.mode,
      storeFile,
      topology,
      ...report,
    };
  } finally {
    await stopAll(processes);
    if (cleanup) {
      rmSync(dirnameForCleanup(storeFile), { recursive: true, force: true });
    }
  }
}

export async function driveMemoryRemoteProof({
  gatewayBaseUrl,
  remoteServers = [],
  storeFile,
  namespace = DEFAULT_NAMESPACE,
  key = DEFAULT_KEY,
  value = DEFAULT_VALUE,
  adaptivePlacement = false,
} = {}) {
  const initialized = await sendGatewayMessage(gatewayBaseUrl, {
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
      : { clientId: "multicontainer-memory-client" },
  });
  const sessionId = initialized.sessionId;

  const tools = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/list",
    sessionId,
  });
  const rememberResult = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "memory_remember",
      arguments: {
        namespace,
        key,
        value,
      },
    },
  });
  const stickyRecall = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "memory_recall",
      arguments: {
        namespace,
        key,
      },
    },
  });
  const listResult = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "memory_list",
      arguments: {
        namespace,
      },
    },
  });

  let adaptiveRecall = null;
  if (adaptivePlacement) {
    const alternateServer = remoteServers.find(
      (server) => server.serverInstanceId !== initialized.serverInstanceId,
    );
    if (!alternateServer) {
      throw new Error("Adaptive memory multi-container proof requires at least two remote servers");
    }

    await setInstanceHealth(gatewayBaseUrl, initialized.serverInstanceId, {
      load: 0.7,
      healthy: true,
      acceptingNewSessions: true,
    });
    await setInstanceHealth(gatewayBaseUrl, alternateServer.serverInstanceId, {
      load: 0.1,
      healthy: true,
      acceptingNewSessions: true,
    });
    await delay(50);

    adaptiveRecall = await sendGatewayMessage(gatewayBaseUrl, {
      method: "tools/call",
      sessionId,
      params: {
        clientId: ADAPTIVE_CLIENT_ID,
        runtimeHints: {
          replaySafe: true,
          readOnly: true,
          externalState: true,
        },
        name: "memory_recall",
        arguments: {
          namespace,
          key,
        },
      },
    });
  }

  await setInstanceHealth(gatewayBaseUrl, initialized.serverInstanceId, {
    load: 0.99,
    healthy: false,
    acceptingNewSessions: false,
  });
  await delay(50);

  const reassignedRecall = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "memory_recall",
      arguments: {
        namespace,
        key,
      },
    },
  });

  const observability = await fetchJson(`${gatewayBaseUrl}/observability`);
  const sessions = await fetchJson(`${gatewayBaseUrl}/sessions`);
  const health = await fetchJson(`${gatewayBaseUrl}/health`);
  const storeSnapshot = createFileBackedMemoryValidationStore({ filePath: storeFile }).snapshot();
  const remoteMemorySnapshots = await collectRemoteMemorySnapshots(remoteServers);

  return {
    checks: {
      stickyRouting: adaptivePlacement || initialized.serverInstanceId === stickyRecall.serverInstanceId,
      adaptivePlacement:
        !adaptivePlacement ||
        initialized.runtimeMode === "stateless" &&
          initialized.runtimeRecommendation?.adaptivePlacement?.applied === true &&
          initialized.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "adaptive-classifier",
      adaptiveDynamicRouting:
        !adaptivePlacement ||
        (adaptiveRecall &&
          initialized.serverInstanceId !== adaptiveRecall.serverInstanceId &&
          adaptiveRecall.runtimeMode === "stateless" &&
          adaptiveRecall.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "existing-session"),
      adaptiveTelemetry:
        !adaptivePlacement ||
        observability.summary.totalAdaptivePlacements === 1 &&
          observability.summary.totalAdaptivePlacementStateless === 1 &&
          observability.summary.totalAdaptivePlacementFallbacks === 0 &&
          observability.summary.totalAdaptivePlacementMismatches === 0,
      unhealthyReassignment:
        initialized.serverInstanceId !== reassignedRecall.serverInstanceId,
      memoryVisibleThroughMcp:
        stickyRecall.result.structuredContent.value === value &&
        (!adaptivePlacement || adaptiveRecall?.result.structuredContent.value === value) &&
        reassignedRecall.result.structuredContent.value === value,
      memoryVisibleOnSharedStore:
        storeSnapshot.some(
          (bucket) =>
            bucket.namespace === namespace &&
            bucket.entries.some((entry) => entry.key === key && entry.value === value),
        ),
      remoteServersSeeSharedStore:
        remoteMemorySnapshots.every((snapshot) =>
          snapshot.memory?.namespaces?.some(
            (bucket) =>
              bucket.namespace === namespace &&
              bucket.entries.some((entry) => entry.key === key && entry.value === value),
          ),
        ),
    },
    gateway: {
      baseUrl: gatewayBaseUrl,
      health,
      sessions,
      observability,
    },
    remoteServers,
    storeSnapshot,
    remoteMemorySnapshots,
    mcp: {
      initialize: initialized,
      tools: tools.result.tools.map((tool) => tool.name).sort(),
      rememberResult: rememberResult.result.structuredContent,
      stickyRecallResult: stickyRecall.result.structuredContent,
      stickyServerInstanceId: stickyRecall.serverInstanceId,
      adaptiveRecallResult: adaptiveRecall?.result.structuredContent ?? null,
      adaptiveRecallServerInstanceId: adaptiveRecall?.serverInstanceId ?? null,
      listResult: listResult.result.structuredContent,
      reassignedRecallResult: reassignedRecall.result.structuredContent,
      reassignedServerInstanceId: reassignedRecall.serverInstanceId,
    },
  };
}

function createDefaultStoreFile() {
  const rootDir = resolve(process.cwd(), "validation-artifacts", "memory-multicontainer");
  mkdirSync(rootDir, { recursive: true });
  const storeFile = resolve(rootDir, "memory-store.json");
  createFileBackedMemoryValidationStore({ filePath: storeFile });
  return storeFile;
}

async function startLocalTopology({ storeFile, processes, adaptivePlacement = false }) {
  const cwd = resolve(process.cwd());
  const serverScript = resolve(cwd, "validation/memory/remote-memory-server.js");
  const gatewayScript = resolve(cwd, "validation/multicontainer/remote-gateway.js");
  const serverAPort = await allocatePort();
  const serverBPort = await allocatePort();
  const gatewayPort = await allocatePort();

  const serverA = spawnNodeProcess(serverScript, {
    cwd,
    env: {
      PORT: String(serverAPort),
      STORE_FILE: storeFile,
      SERVER_INSTANCE_ID: "mem-a",
    },
  });
  const serverB = spawnNodeProcess(serverScript, {
    cwd,
    env: {
      PORT: String(serverBPort),
      STORE_FILE: storeFile,
      SERVER_INSTANCE_ID: "mem-b",
    },
  });
  processes.push(serverA, serverB);

  const readyA = await serverA.waitForReady();
  const readyB = await serverB.waitForReady();

  const gateway = spawnNodeProcess(gatewayScript, {
    cwd,
    env: {
      PORT: String(gatewayPort),
      LOAD_THRESHOLD: "0.8",
      SERVER_INSTANCES_JSON: JSON.stringify([
        { serverInstanceId: "mem-a", load: 0.14, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "mem-b", load: 0.26, healthy: true, acceptingNewSessions: true },
      ]),
      REMOTE_BASE_URLS_JSON: JSON.stringify({
        "mem-a": `http://127.0.0.1:${readyA.port}`,
        "mem-b": `http://127.0.0.1:${readyB.port}`,
      }),
      MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED: adaptivePlacement ? "true" : "false",
      MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST: adaptivePlacement ? ADAPTIVE_CLIENT_ID : "",
    },
  });
  processes.push(gateway);

  const readyGateway = await gateway.waitForReady();
  return {
    mode: "local-multiprocess",
    gatewayBaseUrl: `http://127.0.0.1:${readyGateway.port}`,
    remoteServers: [
      { serverInstanceId: "mem-a", baseUrl: `http://127.0.0.1:${readyA.port}` },
      { serverInstanceId: "mem-b", baseUrl: `http://127.0.0.1:${readyB.port}` },
    ],
  };
}

async function connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls, storeFile }) {
  return {
    mode: "external-gateway",
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/, ""),
    remoteServers: Object.entries(remoteServerBaseUrls ?? {}).map(([serverInstanceId, baseUrl]) => ({
      serverInstanceId,
      baseUrl: baseUrl.replace(/\/+$/, ""),
    })),
    storeFile,
  };
}

async function waitForTopology(topology) {
  await Promise.all([
    waitForEndpoint(`${topology.gatewayBaseUrl}/health`),
    ...topology.remoteServers.map((server) => waitForEndpoint(`${server.baseUrl}/health`)),
  ]);
}

async function waitForEndpoint(url, { attempts = 120, delayMs = 500 } = {}) {
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

  throw lastError ?? new Error(`Endpoint did not become ready: ${url}`);
}

async function collectRemoteMemorySnapshots(remoteServers) {
  const snapshots = [];
  for (const server of remoteServers) {
    try {
      const memory = await fetchJson(`${server.baseUrl}/memory`);
      snapshots.push({
        serverInstanceId: server.serverInstanceId,
        baseUrl: server.baseUrl,
        memory,
      });
    } catch (error) {
      snapshots.push({
        serverInstanceId: server.serverInstanceId,
        baseUrl: server.baseUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return snapshots;
}

async function setInstanceHealth(gatewayBaseUrl, serverInstanceId, overrides) {
  return fetchJson(`${gatewayBaseUrl}/instances`, {
    method: "POST",
    body: {
      serverInstanceId,
      ...overrides,
    },
  });
}

async function sendGatewayMessage(gatewayBaseUrl, body) {
  return fetchJson(`${gatewayBaseUrl}/message`, {
    method: "POST",
    body,
  });
}

async function stopAll(processes) {
  await Promise.all(
    [...processes].reverse().map(async (processHandle) => {
      try {
        await processHandle.stop();
      } catch {
        // Best-effort shutdown for proof helpers.
      }
    }),
  );
}

function dirnameForCleanup(storeFile) {
  return dirname(storeFile);
}
