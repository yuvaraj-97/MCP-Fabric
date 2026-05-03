# stdio vs HTTP/SSE

stdio and HTTP/SSE should share application-facing abstractions, but they do not
need identical infrastructure.

## stdio

In stdio deployments, the host usually starts one MCP server subprocess.

```text
Host process <-> MCP server subprocess
```

There is usually no gateway, session registry, external load balancer, or SSE
connection identity. The transport still carries MCP protocol messages, but the
deployment topology is simpler.

## HTTP/SSE

In HTTP/SSE deployments, clients may connect through a gateway to multiple MCP
server instances.

```text
Client <-> Gateway <-> MCP server instance pool
```

This topology benefits from:

- session affinity
- instance health checks
- load-aware new-session assignment
- disconnect and reconnect handling
- optional durable session registry storage

## Shared Application Model

The application should define MCP-compatible handlers once. Transport adapters
should handle the mechanics of stdio streams, HTTP requests, and SSE events.
