# Production Hardening Specification

This document serves as the technical blueprint for hardening the MCP gateway for production deployments. It is intended to be executed by autonomous multi-agent systems.

## 1. Hot Instance Context Migration & Auto-Scaling
**Objective:** Enable dynamic scaling and state preservation for overloaded servers.
- **Context Checkpointing:** Implement periodic serialization of session state from MCP Servers to a Redis cluster.
- **Dynamic Reassignment:** If a server's load reaches a critical threshold (e.g., 90%), the gateway must pause routing to it, assign the session to a healthy server, and instruct the new server to pull and deserialize context from Redis.
- **Auto-Scaler Hook:** Implement `AutoScalerHook` within `LoadRouter` to emit provisioning events (or call scaling APIs) when average cluster load exceeds 80%.

## 2. In-Memory Bottlenecks
**Objective:** Remove memory leaks and enable horizontal scaling of the Gateway itself.
- **Notification Log:** Replace the unbounded `notificationLog` array in `McpApplicationServer` with a capped sliding window (e.g., max 500 entries) and an event emitter for external log sinks (Datadog/CloudWatch).
- **Session Registry:** Abstract the `SessionRegistry` into an interface and implement `RedisSessionRegistry` using `ioredis` or standard `redis` library to allow multiple gateway instances to share the same session mapping.

## 3. Protocol Parsing Overhead
**Objective:** Reduce maintenance burden by adopting the official standard.
- **SDK Migration:** Replace custom JSON-RPC parsing (e.g., `validateIncomingMessage`, `createSuccessResponse`) in `McpApplicationServer` by installing and integrating the official `@modelcontextprotocol/sdk` NPM package.

Status:

- Completed for the reusable core request boundary in `McpApplicationServer`.
- Built-in MCP methods now execute through the official SDK server/runtime.
- Registered custom request methods now also execute through the SDK handler path.
- Remaining repo-owned seams are transport wrappers and outer envelope normalization, not the core MCP request dispatcher.

## 4. Authentication and Security
**Objective:** Protect the gateway from unauthorized access and rogue instance registration.
- **Startup Security Audit:** Enforce a startup check. If the gateway binds to `0.0.0.0` instead of `127.0.0.1`, log a critical `[SECURITY WARNING]`.
- **Self-Hijack Test:** Implement a startup sequence where a dummy internal client attempts to connect without authentication. If it succeeds while listening on a public IP, immediately throw a fatal error: `FATAL: Gateway is publicly accessible and vulnerable to hijacking. Shutting down.`

## 5. Reconnection Race Conditions
**Objective:** Handle dropped HTTP/SSE connections gracefully during long tool executions.
- **Configurable Strategies:** Implement `onDisconnect` handling in `operator-config.js`.
  - `"cancel"` (Default): Send a cancellation/abort signal to the MCP server.
  - `"queue"`: Allow execution to finish, queue the result in the session state, and flush to the client upon reconnection.
