import { pathToFileURL } from "node:url";

import { operatorConfigFromEnv } from "../config/operator-config.js";
import { createHttpSseGatewayServer } from "../../transports/http-sse/gateway-server.js";
import { createRemoteHttpApplication } from "../../transports/http-sse/remote-http-application.js";

/**
 * Build a standalone HTTP/SSE gateway from environment configuration.
 *
 * This is the first-class, production-oriented entrypoint for running the
 * gateway as an independent process. All operator knobs come from the
 * environment via `operatorConfigFromEnv` (PORT, HOST, REDIS_URL, session
 * registry backend, adaptive-placement gate, security audit, etc.).
 *
 * Two topologies are supported from the same entrypoint:
 *
 *   - Self-contained: when `REMOTE_BASE_URLS_JSON` is not provided, the gateway
 *     hosts the in-process demo application servers. This is useful for local
 *     smoke tests and single-host evaluation without standing up backend MCP
 *     servers.
 *   - Fronting remote MCP servers: when `REMOTE_BASE_URLS_JSON` is provided
 *     (a JSON object mapping `serverInstanceId` -> base URL), the gateway routes
 *     to those remote servers over HTTP. `SERVER_INSTANCES_JSON` must then list
 *     the routable instances. This is the production-like topology used by the
 *     shared-Redis canary compose files.
 *
 * No routing, runtime-mode, or adaptive-placement behavior is changed here; the
 * entrypoint only wires existing, tested modules together.
 */
export function createStandaloneGatewayFromEnv({ env = process.env } = {}) {
  const operatorConfig = operatorConfigFromEnv({ env });
  const serverInstances = parseServerInstances(env.SERVER_INSTANCES_JSON);
  const remoteBaseUrls = parseRemoteBaseUrls(env.REMOTE_BASE_URLS_JSON);

  const options = { operatorConfig };
  if (serverInstances) {
    options.serverInstances = serverInstances;
  }

  if (remoteBaseUrls) {
    if (!serverInstances) {
      throw new TypeError(
        "REMOTE_BASE_URLS_JSON requires SERVER_INSTANCES_JSON to list the routable instances",
      );
    }

    options.createApplication = ({ serverInstanceId }) => {
      const baseUrl = remoteBaseUrls[serverInstanceId];
      if (!baseUrl) {
        throw new Error(`Missing remote baseUrl for ${serverInstanceId}`);
      }

      return createRemoteHttpApplication({ serverInstanceId, baseUrl });
    };
  }

  return createHttpSseGatewayServer(options);
}

export async function startStandaloneGateway({ env = process.env, logger = console } = {}) {
  const remoteBaseUrls = parseRemoteBaseUrls(env.REMOTE_BASE_URLS_JSON);
  const gateway = createStandaloneGatewayFromEnv({ env });
  const address = await gateway.listen();

  logger.log?.(
    JSON.stringify({
      type: "ready",
      kind: "standalone-gateway",
      host: address.address,
      port: address.port,
      topology: remoteBaseUrls ? "fronting-remote-mcp-servers" : "self-contained-demo",
    }),
  );

  const shutdown = (signal) => {
    logger.log?.(JSON.stringify({ type: "shutdown", signal }));
    gateway.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return { gateway, address };
}

function parseServerInstances(raw) {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TypeError("SERVER_INSTANCES_JSON must be a non-empty JSON array");
  }

  return parsed;
}

function parseRemoteBaseUrls(raw) {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("REMOTE_BASE_URLS_JSON must be a JSON object of serverInstanceId -> baseUrl");
  }

  return parsed;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  startStandaloneGateway().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
