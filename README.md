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

This is an early research and prototype scaffold.

The implemented slice today is a dependency-free gateway policy prototype:

- in-memory session registry
- load-aware router
- self-explaining local dashboard for routing behavior
- automated tests for stickiness, overload protection, unhealthy-instance
  reassignment, and dashboard startup

The reusable library core and real transport adapters are still the next
recommended build steps.

## Recommended Path

Build the reusable library core first, then build the self-hosted gateway on
top of that core.

That keeps the architecture clean:

- Option 1 library: reusable transport-neutral building blocks
- Option 2 gateway: self-hosted runtime that packages those building blocks for
  multi-instance deployments

The current repo direction still prefers the self-hosted/local gateway outcome,
but it should be built on top of a shared core rather than invented as a
one-off runtime.

## Install

Use Node.js 20 or newer.

```sh
npm install
```

## Run Tests

```sh
npm test
```

## Launch The Local UI

```sh
npm run demo
```

Then open `http://127.0.0.1:4321`.

## What The UI Demonstrates

The local dashboard explains, in plain English:

- the MCP scaling problem this repo is solving
- what session affinity means
- what load-aware routing means
- what Option 1 library means
- what Option 2 gateway means
- what is implemented now
- what is still planned

It also lets you interactively:

- view multiple fake MCP server instances
- change their health and load
- create new sessions
- route existing sessions back to the same server
- see overloaded instances skipped for new sessions
- mark a server unhealthy and watch reassignment happen
- inspect routing decisions step by step

## Checks

```sh
npm run check
```

## Plan Document

The evaluation and execution plan for scaling this prototype lives in
[`docs/agentic-scale-up-plan.md`](docs/agentic-scale-up-plan.md).
