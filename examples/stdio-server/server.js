import { createScalingDemoServer } from "../shared/scaling-demo-server.js";
import { StdioTransportAdapter } from "../../packages/transports/stdio/stdio-transport.js";

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = createStdioDemo();
  demo.transport.start();
}
