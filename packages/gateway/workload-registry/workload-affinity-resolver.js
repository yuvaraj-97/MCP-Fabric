export function resolveWorkloadAffinity(body, { stateHandleKeys = [], findToolSchema = () => null } = {}) {
  if (!body || typeof body !== "object") return null;
  if (!body.params || typeof body.params !== "object") return null;

  // 1. Check JSON-schema / metadata extension for tool call arguments
  if (body.method === "tools/call") {
    const toolName = body.params.name;
    const args = body.params.arguments;
    if (toolName && args && typeof args === "object") {
      const schema = findToolSchema(toolName);
      if (schema && schema.properties && typeof schema.properties === "object") {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (
            propSchema &&
            (propSchema["x-mcp-fabric-workload-affinity"] === true ||
             propSchema["x-mcp-fabric-state-handle"] === true)
          ) {
            const val = args[key];
            if (typeof val === "string" && val.trim().length > 0) {
              return { id: val.trim(), kind: key };
            }
          }
        }
      }
    }
  }

  // 2. Check configured state-handle keys (from operator config/legacy defaults)
  const args = body.method === "tools/call" ? body.params.arguments : body.params;
  if (args && typeof args === "object") {
    for (const key of stateHandleKeys) {
      const val = args[key];
      if (typeof val === "string" && val.trim().length > 0) {
        return { id: val.trim(), kind: key };
      }
    }
  }

  return null;
}
