import { createHttpSseGatewayServer } from "../../packages/transports/http-sse/gateway-server.js";
import { createRemoteHttpApplication } from "../../packages/transports/http-sse/remote-http-application.js";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const serverInstances = JSON.parse(process.env.SERVER_INSTANCES_JSON ?? "[]");
const remoteBaseUrls = JSON.parse(process.env.REMOTE_BASE_URLS_JSON ?? "{}");
const loadThreshold = process.env.LOAD_THRESHOLD
  ? Number.parseFloat(process.env.LOAD_THRESHOLD)
  : undefined;

if (serverInstances.length === 0) {
  throw new TypeError("SERVER_INSTANCES_JSON must define at least one instance");
}

const gateway = createHttpSseGatewayServer({
  serverInstances,
  loadThreshold,
  createApplication({ serverInstanceId }) {
    const baseUrl = remoteBaseUrls[serverInstanceId];
    if (!baseUrl) {
      throw new Error(`Missing remote baseUrl for ${serverInstanceId}`);
    }

    return createRemoteHttpApplication({
      serverInstanceId,
      baseUrl,
    });
  },
});

const address = await gateway.listen(port);
console.log(JSON.stringify({
  type: "ready",
  kind: "filesystem-remote-gateway",
  port: address.port,
  serverInstances: serverInstances.map((instance) => ({
    serverInstanceId: instance.serverInstanceId,
    baseUrl: remoteBaseUrls[instance.serverInstanceId],
  })),
}));

function closeAndExit(code = 0) {
  gateway.close().finally(() => {
    process.exit(code);
  });
}

process.on("SIGTERM", () => closeAndExit(0));
process.on("SIGINT", () => closeAndExit(0));
