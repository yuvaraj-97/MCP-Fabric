import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  createGitValidationWorkspace,
  describeGitValidationFile,
  snapshotGitValidationWorkspace,
} from "./workspace.js";
import { delay, fetchJson } from "../multicontainer/http-utils.js";
import { allocatePort, spawnNodeProcess } from "../multicontainer/process-utils.js";

const DEFAULT_RELATIVE_PATH = "notes/git-multicontainer-change.txt";
const DEFAULT_CONTENT = "git multi-container proof works";

export async function runGitMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  rootDir = createGitValidationWorkspace("git-multicontainer"),
  cleanup = false,
} = {}) {
  const processes = [];

  try {
    const topology = gatewayBaseUrl
      ? await connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls })
      : await startLocalTopology({ rootDir, processes });

    const report = await driveGitRemoteProof({
      gatewayBaseUrl: topology.gatewayBaseUrl,
      remoteServers: topology.remoteServers,
      rootDir,
    });

    return {
      ok: true,
      mode: topology.mode,
      rootDir,
      createdFile: describeGitValidationFile(rootDir, DEFAULT_RELATIVE_PATH),
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

export async function driveGitRemoteProof({
  gatewayBaseUrl,
  remoteServers = [],
  rootDir,
  relativePath = DEFAULT_RELATIVE_PATH,
  content = DEFAULT_CONTENT,
} = {}) {
  const initialized = await sendGatewayMessage(gatewayBaseUrl, {
    method: "initialize",
    params: { clientId: "git-multicontainer-client" },
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
      name: "git_write_file",
      arguments: {
        path: relativePath,
        content,
      },
    },
  });
  const statusBeforeStage = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "git_status",
      arguments: {},
    },
  });
  const stageResult = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "git_stage_paths",
      arguments: {
        paths: [relativePath],
      },
    },
  });
  const stickyDiff = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "git_diff_cached",
      arguments: {},
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
      name: "git_read_file",
      arguments: {
        path: relativePath,
      },
    },
  });
  const reassignedStatus = await sendGatewayMessage(gatewayBaseUrl, {
    method: "tools/call",
    sessionId,
    params: {
      name: "git_status",
      arguments: {},
    },
  });

  const observability = await fetchJson(`${gatewayBaseUrl}/observability`);
  const sessions = await fetchJson(`${gatewayBaseUrl}/sessions`);
  const health = await fetchJson(`${gatewayBaseUrl}/health`);
  const workspaceSnapshot = snapshotGitValidationWorkspace(rootDir);
  const remoteWorkspaceSnapshots = await collectRemoteWorkspaceSnapshots(remoteServers);

  return {
    checks: {
      stickyRouting: initialized.serverInstanceId === stickyDiff.serverInstanceId,
      unhealthyReassignment:
        initialized.serverInstanceId !== reassignedRead.serverInstanceId,
      artifactVisibleThroughMcp:
        stickyDiff.result.structuredContent.stagedFiles.includes(relativePath) &&
        reassignedRead.result.structuredContent.content === content,
      artifactVisibleOnSharedWorkspace:
        workspaceSnapshot.items.some((item) => item.path === relativePath && item.kind === "file"),
      stagedStateVisibleAfterReassignment:
        reassignedStatus.result.structuredContent.porcelain.some(
          (entry) => entry.path === relativePath && entry.indexStatus === "A",
        ),
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
      statusBeforeStage: statusBeforeStage.result.structuredContent,
      stageResult: stageResult.result.structuredContent,
      stickyDiffResult: stickyDiff.result.structuredContent,
      stickyServerInstanceId: stickyDiff.serverInstanceId,
      reassignedReadResult: reassignedRead.result.structuredContent,
      reassignedStatusResult: reassignedStatus.result.structuredContent,
      reassignedServerInstanceId: reassignedRead.serverInstanceId,
    },
  };
}

async function startLocalTopology({ rootDir, processes }) {
  const cwd = resolve(process.cwd());
  const serverScript = resolve(cwd, "validation/git/remote-server.js");
  const gatewayScript = resolve(cwd, "validation/multicontainer/remote-gateway.js");
  const serverAPort = await allocatePort();
  const serverBPort = await allocatePort();
  const gatewayPort = await allocatePort();

  const serverA = spawnNodeProcess(serverScript, {
    cwd,
    env: {
      PORT: String(serverAPort),
      ROOT_DIR: rootDir,
      SERVER_INSTANCE_ID: "git-a",
    },
  });
  const serverB = spawnNodeProcess(serverScript, {
    cwd,
    env: {
      PORT: String(serverBPort),
      ROOT_DIR: rootDir,
      SERVER_INSTANCE_ID: "git-b",
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
        { serverInstanceId: "git-a", load: 0.12, healthy: true, acceptingNewSessions: true },
        { serverInstanceId: "git-b", load: 0.28, healthy: true, acceptingNewSessions: true },
      ]),
      REMOTE_BASE_URLS_JSON: JSON.stringify({
        "git-a": `http://127.0.0.1:${readyA.port}`,
        "git-b": `http://127.0.0.1:${readyB.port}`,
      }),
    },
  });
  processes.push(gateway);

  const readyGateway = await gateway.waitForReady();
  return {
    mode: "local-multiprocess",
    gatewayBaseUrl: `http://127.0.0.1:${readyGateway.port}`,
    remoteServers: [
      { serverInstanceId: "git-a", baseUrl: `http://127.0.0.1:${readyA.port}` },
      { serverInstanceId: "git-b", baseUrl: `http://127.0.0.1:${readyB.port}` },
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

async function sendGatewayMessage(gatewayBaseUrl, message) {
  return fetchJson(`${gatewayBaseUrl}/message`, {
    method: "POST",
    body: message,
  });
}

async function setInstanceHealth(gatewayBaseUrl, serverInstanceId, updates) {
  return fetchJson(`${gatewayBaseUrl}/instances`, {
    method: "POST",
    body: {
      serverInstanceId,
      ...updates,
    },
  });
}

async function stopAll(processes) {
  await Promise.allSettled(processes.map((processHandle) => processHandle.stop()));
}
