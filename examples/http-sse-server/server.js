import {
  DEFAULT_GATEWAY_OPERATOR_CONFIG,
  operatorConfigFromEnv,
} from "../../packages/gateway/config/operator-config.js";
import { createHttpSseGatewayServer } from "../../packages/transports/http-sse/gateway-server.js";

const operatorConfig = operatorConfigFromEnv({
  defaults: DEFAULT_GATEWAY_OPERATOR_CONFIG,
});

const gateway = createHttpSseGatewayServer({
  operatorConfig,
  serverInstances: [{ serverInstanceId: "http-server-1", load: 0.1 }],
});

const address = await gateway.listen(operatorConfig.port);
console.log(`HTTP/SSE inspector listening on http://127.0.0.1:${address.port}/inspector`);
