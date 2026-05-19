import { fetchJson } from "../multicontainer/http-utils.js";

const DEFAULT_RELATIVE_PATH = "notes/shared-redis-proof.txt";
const DEFAULT_CONTENT = "shared redis gateway proof works";

export async function runSharedRedisGatewayProof({
  gatewayABaseUrl = process.env.MCP_SHARED_REDIS_GATEWAY_A_URL,
  gatewayBBaseUrl = process.env.MCP_SHARED_REDIS_GATEWAY_B_URL,
  remoteServerBaseUrls = parseRemoteServerUrls(
    process.env.MCP_SHARED_REDIS_SERVER_URLS,
  ),
  relativePath = DEFAULT_RELATIVE_PATH,
  content = DEFAULT_CONTENT,
} = {}) {
  if (!gatewayABaseUrl || !gatewayBBaseUrl) {
    throw new TypeError(
      "Both gatewayABaseUrl and gatewayBBaseUrl are required for the shared Redis proof",
    );
  }

  const initialized = await sendGatewayMessage(gatewayABaseUrl, {
    method: "initialize",
    params: { clientId: "shared-redis-client" },
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

  const secondGatewayRead = await sendGatewayMessage(gatewayBBaseUrl, {
    method: "tools/call",
    sessionId: initialized.sessionId,
    params: {
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

  return {
    ok: true,
    topology: {
      gatewayABaseUrl: trimSlash(gatewayABaseUrl),
      gatewayBBaseUrl: trimSlash(gatewayBBaseUrl),
      remoteServers: Object.entries(remoteServerBaseUrls ?? {}).map(([serverInstanceId, baseUrl]) => ({
        serverInstanceId,
        baseUrl,
      })),
    },
    checks: {
      crossGatewayReuse:
        initialized.serverInstanceId === secondGatewayRead.serverInstanceId &&
        secondGatewayRead.reusedExistingSession === true,
      secondGatewayReadVisible:
        secondGatewayRead.result.structuredContent.content === content,
      secondGatewayListVisible:
        secondGatewayList.result.structuredContent.entries.some(
          (entry) => entry.name === "shared-redis-proof.txt",
        ),
    },
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
