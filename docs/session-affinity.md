# Session Affinity

HTTP/SSE and Streamable HTTP deployments need routing behavior that understands
session continuity.

## Problem

Generic load balancing can route follow-up requests or reconnects to a different
server instance than the one holding the session state. That can break long-lived
streams, stateful tools, and resumable workflows.

## Proposal

Introduce a session registry:

```text
session_id -> server_instance_id
```

A gateway consults the registry before forwarding a request.

```text
Client
  |
Gateway
  |
Session Registry
  |
MCP Server Instance
```

## Routing Rules

| Request Type | Routing Behavior |
| --- | --- |
| New session | Assign to a healthy, least-loaded server instance. |
| Existing session | Route to the registered server instance when available. |
| Missing mapping | Create a new mapping or require reinitialization. |
| Unhealthy instance | Reconnect, reinitialize, or restore from external state. |

## Registry Requirements

The registry should support:

- creating session mappings
- looking up mappings
- expiring idle sessions
- marking server instances unhealthy
- surviving gateway restarts when backed by durable storage

For the first prototype, an in-memory registry is enough. The gateway restart
scenario should be captured as a later milestone.
