import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";

export function createScalingDemoServer() {
  const server = new McpApplicationServer({
    serverInfo: {
      name: "scaling-demo-server",
      version: "0.1.0",
    },
    instructions:
      "This demo proves the same MCP tool logic can be mounted through a shared library core and a concrete transport adapter.",
  });

  server.registerTool({
    name: "explain_scaling",
    title: "Explain MCP scaling",
    description:
      "Explain what this prototype solves and echo the current session context.",
    inputSchema: {
      type: "object",
      properties: {
        audience: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments, context }) {
      return {
        audience: toolArguments.audience ?? "beginner",
        summary:
          "The reusable core defines MCP-compatible behavior once, while the gateway and transports decide how traffic reaches that behavior.",
        session: {
          sessionId: context.sessionId,
          clientId: context.clientId,
          transport: context.transport,
        },
      };
    },
  });

  server.registerTool({
    name: "sum_load",
    title: "Sum instance load",
    description: "Add together a list of normalized load values for demo purposes.",
    inputSchema: {
      type: "object",
      properties: {
        loads: {
          type: "array",
          items: {
            type: "number",
          },
        },
      },
      required: ["loads"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments }) {
      const loads = Array.isArray(toolArguments.loads) ? toolArguments.loads : [];
      const total = loads.reduce((sum, value) => sum + Number(value || 0), 0);

      return {
        count: loads.length,
        totalLoad: Number(total.toFixed(2)),
      };
    },
  });

  return server;
}
