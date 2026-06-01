import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  createGitValidationWorkspace,
  describeGitValidationFile,
  initializeGitValidationWorkspace,
  snapshotGitValidationWorkspace,
} from "./workspace.js";
import { delay, fetchJson } from "../multicontainer/http-utils.js";
import { allocatePort, spawnNodeProcess } from "../multicontainer/process-utils.js";

const DEFAULT_RELATIVE_PATH = "notes/git-multicontainer-change.txt";
const DEFAULT_CONTENT = "git multi-container proof works";
const ADAPTIVE_CLIENT_ID = "git-multicontainer-adaptive-client";

export async function runGitMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  rootDir = createGitValidationWorkspace("git-multicontainer"),
  cleanup = false,
  adaptivePlacement = false,
  initializeRoot = false,
} = {}) {
  const processes = [];

  try {
    if (initializeRoot) {
      initializeGitValidationWorkspace(rootDir);
    }

    const topology = gatewayBaseUrl
      ? await connectToExternalTopology({ gatewayBaseUrl, remoteServerBaseUrls })
      : await startLocalTopology({ rootDir, processes, adaptivePlacement });

    await waitForTopology(topology);

    const report = await driveGitRemoteProof({
      gatewayBaseUrl: topology.gatewayBaseUrl,
      remoteServers: topology.remoteServers,
      rootDir,
      adaptivePlacement,
    });
    const ok = Object.values(report.checks).every((check) => check === true);

    return {
      ok,
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
      : { clientId: "git-multicontainer-client" },
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

  let adaptiveRead = null;
  if (adaptivePlacement) {
    const alternateServer = remoteServers.find(
      (server) => server.serverInstanceId !== initialized.serverInstanceId,
    );
    if (!alternateServer) {
      throw new Error("Adaptive multi-container proof requires at least two remote servers");
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

    adaptiveRead = await sendGatewayMessage(gatewayBaseUrl, {
      method: "tools/call",
      sessionId,
      params: {
        clientId: ADAPTIVE_CLIENT_ID,
        runtimeHints: {
          replaySafe: true,
          readOnly: true,
          externalState: true,
        },
        name: "git_read_file",
        arguments: {
          path: relativePath,
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
      // Adaptive mode stores a stateless session, so follow-ups are expected to
      // route by health/load rather than strict session stickiness.
      stickyRouting: adaptivePlacement || initialized.serverInstanceId === stickyDiff.serverInstanceId,
      adaptivePlacement:
        !adaptivePlacement ||
        (initialized.runtimeMode === "stateless" &&
          initialized.runtimeRecommendation?.adaptivePlacement?.applied === true &&
          initialized.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "adaptive-classifier"),
      adaptiveDynamicRouting:
        !adaptivePlacement ||
        (adaptiveRead &&
          initialized.serverInstanceId !== adaptiveRead.serverInstanceId &&
          adaptiveRead.runtimeMode === "stateless" &&
          adaptiveRead.runtimeRecommendation?.adaptivePlacement?.runtimeModeSource === "existing-session"),
      adaptiveTelemetry:
        !adaptivePlacement ||
        (observability.summary.totalAdaptivePlacements === 1 &&
          observability.summary.totalAdaptivePlacementStateless === 1 &&
          observability.summary.totalAdaptivePlacementFallbacks === 0 &&
          observability.summary.totalAdaptivePlacementMismatches === 0),
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
      adaptiveReadResult: adaptiveRead?.result.structuredContent ?? null,
      adaptiveReadServerInstanceId: adaptiveRead?.serverInstanceId ?? null,
      reassignedReadResult: reassignedRead.result.structuredContent,
      reassignedStatusResult: reassignedStatus.result.structuredContent,
      reassignedServerInstanceId: reassignedRead.serverInstanceId,
    },
  };
}

async function startLocalTopology({ rootDir, processes, adaptivePlacement = false }) {
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

async function waitForTopology(topology) {
  await waitForHealthyUrl(`${topology.gatewayBaseUrl}/health`);

  for (const server of topology.remoteServers) {
    await waitForHealthyUrl(`${server.baseUrl}/health`);
  }
}

async function waitForHealthyUrl(url) {
  let lastError;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetchJson(url);
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
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
