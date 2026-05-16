import { createHttpSseGatewayServer } from "../../packages/transports/http-sse/gateway-server.js";

const gateway = createHttpSseGatewayServer({
  serverInstances: [
    { serverInstanceId: "server-a", load: 0.15, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-b", load: 0.25, healthy: true, acceptingNewSessions: true },
    { serverInstanceId: "server-c", load: 0.65, healthy: true, acceptingNewSessions: true },
  ],
});

const address = await gateway.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
console.log(`Load-balanced inspector listening on http://127.0.0.1:${address.port}/inspector`);
