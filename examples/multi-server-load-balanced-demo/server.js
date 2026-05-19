import {
  DEFAULT_GATEWAY_OPERATOR_CONFIG,
  operatorConfigFromEnv,
} from "../../packages/gateway/config/operator-config.js";
import { createHttpSseGatewayServer } from "../../packages/transports/http-sse/gateway-server.js";

const operatorConfig = operatorConfigFromEnv({
  defaults: {
    ...DEFAULT_GATEWAY_OPERATOR_CONFIG,
    port: 3001,
  },
});

const gateway = createHttpSseGatewayServer({
  operatorConfig,
  serverInstances: [
    { serverInstanceId: "server-a", load: 0.15, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.25, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-c", load: 0.65, healthy: true, acceptingNewSessions: true },
  ],
});

const address = await gateway.listen({
  port: operatorConfig.port,
  host: operatorConfig.host,
});
console.log(`Load-balanced inspector listening on http://127.0.0.1:${address.port}/inspector`);
