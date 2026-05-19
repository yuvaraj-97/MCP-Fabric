import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  createFilesystemValidationWorkspace,
  describeFilesystemValidationFile,
  snapshotFilesystemValidationWorkspace,
} from "../filesystem/workspace.js";
import { delay, fetchJson } from "./http-utils.js";
import { allocatePort, spawnNodeProcess } from "./process-utils.js";

const DEFAULT_RELATIVE_PATH = "notes/multicontainer-proof.txt";
const DEFAULT_CONTENT = "filesystem multi-container proof works";

export async function runFilesystemMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  rootDir = createFilesystemValidationWorkspace("filesystem-multicontainer"),
  cleanup = false,
} = {}) {
  const processes = [];

  try {
    const topology = gatewayBaseUrl
      ? await connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls })
      : await startLocalTopology({ rootDir, processes });

    const report = await driveFilesystemRemoteProof({
      gatewayBaseUrl: topology.gatewayBaseUrl,
      remoteServers: topology.remoteServers,
      rootDir,
    });

    return {
      ok: true,
      mode: topology.mode,
      rootDir,
      createdFile: describeFilesystemValidationFile(rootDir, DEFAULT_RELATIVE_PATH),
      topology,
      ...report,
    };
  } finally {
    await stopAll(processes);
    if (cleanup) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  }
}

export async function driveFilesystemRemoteProof({
  gatewayBaseUrl,
  remoteServers = [],
  rootDir,
  relativePath = DEFAULT_RELATIVE_PATH,
  content = DEFAULT_CONTENT,
} = {}) {
  const initialized = await sendGatewayMessage(gatewayBaseUrl, {
    method: "initialize",
    params: { clientId: "multicontainer-client" },
  });
  const sessionId = initialized.sessionId;

  const tools = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/list",
    sessionId,
  });
  const writeResult = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "fs_write_text",
      arguments: {
        path: relativePath,
        content,
      },
    },
  });
  const listResult = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "fs_list",
      arguments: {
        path: "notes",
      },
    },
  });
  const stickyStat = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "fs_stat",
      arguments: {
        path: relativePath,
      },
    },
  });

  await setInstanceHealth(gatewayBaseUrl, initialized.serverInstanceId, {
    load: 0.99,
    healthy: false,
    acceptingNewSessions: false,
  });
  await delay(50);

  const reassignedRead = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "fs_read_text",
      arguments: {
        path: relativePath,
      },
    },
  });

  const observability = await fetchJson(`${gatewayBaseUrl}/observability`);
  const sessions = await fetchJson(`${gatewayBaseUrl}/sessions`);
  const health = await fetchJson(`${gatewayBaseUrl}/health`);
  const workspaceSnapshot = snapshotFilesystemValidationWorkspace(rootDir);
  const remoteWorkspaceSnapshots = await collectRemoteWorkspaceSnapshots(remoteServers);

  return {
    checks: {
      stickyRouting: initialized.serverInstanceId === stickyStat.serverInstanceId,
      unhealthyReassignment:
        initialized.serverInstanceId !== reassignedRead.serverInstanceId,
      artifactVisibleThroughMcp:
        listResult.result.structuredContent.entries.some((entry) => entry.name === "multicontainer-proof.txt") &&
        reassignedRead.result.structuredContent.content === content,
      artifactVisibleOnSharedWorkspace:
        workspaceSnapshot.items.some((item) => item.path === relativePath && item.kind === "file"),
    },
    gateway: {
      baseUrl: gatewayBaseUrl,
      health,
      sessions,
      observability,
    },
    remoteServers,
    workspaceSnapshot,
    remoteWorkspaceSnapshots,
    mcp: {
      initialize: initialized,
      tools: tools.result.tools.map((tool) => tool.name).sort(),
      writeResult: writeResult.result.structuredContent,
      listResult: listResult.result.structuredContent,
      stickyStat: stickyStat.result.structuredContent,
      stickyServerInstanceId: stickyStat.serverInstanceId,
      reassignedReadResult: reassignedRead.result.structuredContent,
      reassignedServerInstanceId: reassignedRead.serverInstanceId,
    },
  };
}

async function startLocalTopology({ rootDir, processes }) {
  const cwd = resolve(process.cwd());
  const serverScript = resolve(cwd, "validation/multicontainer/remote-filesystem-server.js");
  const gatewayScript = resolve(cwd, "validation/multicontainer/remote-gateway.js");
  const serverAPort = await allocatePort();
  const serverBPort = await allocatePort();
  const gatewayPort = await allocatePort();

  const serverA = spawnNodeProcess(serverScript, {
    cwd,
    env: {
      PORT: String(serverAPort),
      ROOT_DIR: rootDir,
      SERVER_INSTANCE_ID: "fs-a",
    },
  });
  const serverB = spawnNodeProcess(serverScript, {
    cwd,
    env: {
      PORT: String(serverBPort),
      ROOT_DIR: rootDir,
      SERVER_INSTANCE_ID: "fs-b",
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
        { serverInstanceId: "fs-a", load: 0.12, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "fs-b", load: 0.28, healthy: true, acceptingNewSessions: true },
      ]),
      REMOTE_BASE_URLS_JSON: JSON.stringify({
        "fs-a": `http://127.0.0.1:${readyA.port}`,
        "fs-b": `http://127.0.0.1:${readyB.port}`,
      }),
    },
  });
  processes.push(gateway);

  const readyGateway = await gateway.waitForReady();
  return {
    mode: "local-multiprocess",
    gatewayBaseUrl: `http://127.0.0.1:${readyGateway.port}`,
    remoteServers: [
      { serverInstanceId: "fs-a", baseUrl: `http://127.0.0.1:${readyA.port}` },
      { serverInstanceId: "fs-b", baseUrl: `http://127.0.0.1:${readyB.port}` },
    ],
  };
}

async function connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls }) {
  return {
    mode: "external-gateway",
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/, ""),
    remoteServers: Object.entries(remoteServerBaseUrls ?? {}).map(([serverInstanceId, baseUrl]) => ({
      serverInstanceId,
      baseUrl: baseUrl.replace(/\/+$/, ""),
    })),
  };
}

async function collectRemoteWorkspaceSnapshots(remoteServers) {
  const snapshots = [];
  for (const server of remoteServers) {
    try {
      const workspace = await fetchJson(`${server.baseUrl}/workspace`);
      snapshots.push({
        serverInstanceId: server.serverInstanceId,
        baseUrl: server.baseUrl,
        workspace,
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
  for (const processHandle of processes.reverse()) {
    await processHandle.stop();
  }
}
