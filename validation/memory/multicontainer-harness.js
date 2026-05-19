import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createFileBackedMemoryValidationStore } from "../../examples/shared/memory-validation-server.js";
import { delay, fetchJson } from "../multicontainer/http-utils.js";
import { allocatePort, spawnNodeProcess } from "../multicontainer/process-utils.js";

const DEFAULT_NAMESPACE = "operations";
const DEFAULT_KEY = "rollout-brief";
const DEFAULT_VALUE =
  "Use the gateway as the shared communication layer between clients and remote MCP servers.";

export async function runMemoryMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  storeFile = createDefaultStoreFile(),
  cleanup = false,
} = {}) {
  const processes = [];

  try {
    const topology = gatewayBaseUrl
      ? await connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls, storeFile })
      : await startLocalTopology({ storeFile, processes });

    const report = await driveMemoryRemoteProof({
      gatewayBaseUrl: topology.gatewayBaseUrl,
      remoteServers: topology.remoteServers,
      storeFile,
    });

    return {
      ok: true,
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
} = {}) {
  const initialized = await sendGatewayMessage(gatewayBaseUrl, {
    method: "initialize",
    params: { clientId: "multicontainer-memory-client" },
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
      stickyRouting: initialized.serverInstanceId === stickyRecall.serverInstanceId,
      unhealthyReassignment:
        initialized.serverInstanceId !== reassignedRecall.serverInstanceId,
      memoryVisibleThroughMcp:
        stickyRecall.result.structuredContent.value === value &&
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
      listResult: listResult.result.structuredContent,
      reassignedRecallResult: reassignedRecall.result.structuredContent,
      reassignedServerInstanceId: reassignedRecall.serverInstanceId,
    },
  };
}

function createDefaultStoreFile() {
  const rootDir = resolve(process.cwd(), "validation-artifacts", "memory-multicontainer");
  mkdirSync(rootDir, { recursive: true });
  return resolve(rootDir, "memory-store.json");
}

async function startLocalTopology({ storeFile, processes }) {
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
