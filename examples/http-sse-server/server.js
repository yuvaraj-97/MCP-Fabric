import { createHttpSseGatewayServer } from "../../packages/transports/http-sse/gateway-server.js";

const gateway = createHttpSseGatewayServer({
  serverInstances: [{ serverInstanceId: "http-server-1", load: 0.1 }],
});

const address = await gateway.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
console.log(`HTTP/SSE inspector listening on http://127.0.0.1:${address.port}/inspector`);
