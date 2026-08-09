import { MemorySessionRegistry, LoadRouter } from "../packages/gateway/index.js";
import { StdioTransportAdapter } from "../packages/transports/stdio/stdio-transport.js";
import { createScalingDemoServer } from "./shared/scaling-demo-server.js";

/**
 * End-to-end TypeScript / Node.js example demonstrating Load Router setup,
 * Session Registry initialization, and Stdio / Gateway routing.
 */
async function runTypeScriptExample() {
  console.log("🚀 Initializing MCP-Fabric TypeScript Gateway Components...");

  // 1. Initialize In-Memory Session Registry
  const registry = new MemorySessionRegistry();

  // 2. Initialize Load-Aware Router
  const router = new LoadRouter({
    registry,
    policy: "adaptive-latency",
  });

  // 3. Register Server Instances in Pool
  const serverNode1 = { id: "node-1", url: "http://127.0.0.1:4001", load: 0.2 };
  const serverNode2 = { id: "node-2", url: "http://127.0.0.1:4002", load: 0.8 };

  await registry.registerSession("session-user-100", serverNode1.id);

  console.log("\n1. Resolving Target Node with Session Affinity:");
  const assignedNode = await registry.getSessionNode("session-user-100");
  console.log(`   Session session-user-100 routed to node: ${assignedNode}`);

  console.log("\n2. Initializing MCP Application Server:");
  const demoServer = createScalingDemoServer();
  const transport = new StdioTransportAdapter({ server: demoServer });
  
  console.log("   MCP Application Server & Stdio Transport created successfully.");
}

runTypeScriptExample().catch(console.error);
