import { createScalingDemoServer } from "../shared/scaling-demo-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";
import { fileURLToPath } from "node:url";

export function createStdioDemo() {
  const server = createScalingDemoServer();
  const transport = new StdioTransportAdapter({
    server,
  });

  return {
    server,
    transport,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const demo = createStdioDemo();
  demo.transport.start();
}
