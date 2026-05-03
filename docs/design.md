# Architecture Design

## Intent

This project adds deployment infrastructure around MCP-compatible servers while
preserving MCP's protocol model.

The core design principle is:

> Application logic should not care whether the MCP server is running over
> stdio, HTTP/SSE, or another supported transport.

## Layers

```text
MCP Application Logic
        |
Original MCP Protocol Layer
        |
Session & Routing Layer
        |
Transport Adapter Layer
        |
Runtime Infrastructure
```

### MCP Application Logic

Business logic defines tools, resources, prompts, and handlers. It should depend
on transport-neutral primitives rather than writing directly to stdout, HTTP
responses, or SSE streams.

### Original MCP Protocol Layer

This layer preserves MCP request, response, notification, initialization, and
capability behavior. Session infrastructure must not replace protocol
semantics.

### Session & Routing Layer

This layer tracks operational identities:

| Identity | Purpose |
| --- | --- |
| `client_id` | Identifies a client or host. |
| `session_id` | Preserves continuity across requests or reconnects. |
| `server_instance_id` | Identifies a running server instance. |

### Transport Adapter Layer

Adapters translate transport-neutral operations into transport-specific IO.

Examples:

- stdio reads and writes JSON-RPC messages through process streams.
- HTTP/SSE receives HTTP requests and writes server events.
- Streamable HTTP can use the same application-facing interface with different
  connection mechanics.

### Runtime Infrastructure

The gateway, load balancer, and session registry coordinate multi-instance
deployments.

## Transport-Neutral Primitives

The prototype should expose a small interface shaped around MCP semantics:

```text
sendRequest(method, params)
sendNotification(method, params)
onRequest(handler)
onNotification(handler)
```

The exact API can vary by runtime, but the direction should remain stable:
application handlers should not branch on the transport.

## Compatibility Rule

Any implementation should remain compatible with existing MCP clients and
servers unless a file explicitly declares itself experimental.
