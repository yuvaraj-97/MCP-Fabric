# MCP Transport Infrastructure

Session-aware, transport-agnostic infrastructure for MCP-compatible deployments.

This project explores an infrastructure layer around the Model Context Protocol
(MCP). It does not replace MCP, remove MCP request/response/notification
semantics, or define an incompatible protocol. Instead, it focuses on the
deployment concerns that appear when MCP servers move beyond a single local
stdio process and into HTTP/SSE or Streamable HTTP environments.

## Thesis

MCP should keep its original protocol semantics. Production deployments need a
stronger infrastructure layer for session affinity, transport abstraction, and
load-aware routing.

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

## Goals

- Keep MCP application logic independent from the active transport.
- Preserve MCP request, response, notification, and capability semantics.
- Route HTTP/SSE sessions back to the correct server instance.
- Avoid assigning new sessions to overloaded server instances.
- Demonstrate one MCP-compatible server implementation running over stdio and
  HTTP/SSE without changing business logic.

## Non-Goals

- Replacing MCP.
- Removing protocol-level request/response/notification semantics.
- Forcing stdio and HTTP/SSE to behave identically internally.
- Building a production gateway before validating the minimum viable prototype.

## Prototype Milestones

1. Same application logic, multiple transports.
2. Sticky HTTP/SSE sessions through a gateway.
3. Load-aware assignment for new sessions.
4. Recovery behavior for disconnects, crashes, and gateway restarts.

## Repository Layout

```text
docs/
  design.md
  session-affinity.md
  load-balancing.md
  stdio-vs-http.md
  prototype-roadmap.md
  public-proposal.md

packages/
  core/
    protocol-adapter/
    session/
    routing/
  transports/
    stdio/
    http-sse/
  gateway/
    load-balancer/
    session-registry/

examples/
  stdio-server/
  http-sse-server/
  multi-server-load-balanced-demo/

tests/
  transport-agnostic/
  session-routing/
  failover/
```

The original research brief is kept in
[`mcp_research_full_world_share.md`](mcp_research_full_world_share.md).

## Current Status

This is an early research and prototype scaffold. The first implemented slice is
a dependency-free in-memory session registry plus load-aware router.

Run tests with:

```sh
node --test
```
