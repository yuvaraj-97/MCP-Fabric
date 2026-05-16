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
  agentic-scale-up-plan.md
  design.md
  session-affinity.md
  load-balancing.md
  stdio-vs-http.md
  prototype-roadmap.md
  public-proposal.md
  test-strategy.md

apps/
  local-dashboard/

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
    demo/

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

This is an early research and prototype scaffold. The repo now includes both a
reusable core slice and local transport/gateway demos.

The implemented slices today are:

- reusable transport-neutral MCP application core
- session context helper for shared handler execution
- basic `stdio` adapter with framed JSON-RPC message handling
- newline-delimited local `stdio` harness for transport parity checks
- shared example server proving one tool set can run through the core
- in-memory session registry
- load-aware router
- HTTP/SSE gateway with session stickiness and SSE event visibility
- self-explaining local dashboard for routing behavior
- automated tests for core dispatch, `stdio` transport behavior, stickiness,
  HTTP/SSE parity, overload protection, unhealthy-instance reassignment, SSE
  visibility, failover, and dashboard startup

Durable session handling, cleaner unification of the shared application
boundary, and fuller gateway packaging are still the next recommended build
steps.

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

Run the local test suite with:

```sh
npm test
```

The same suite is also available as:

```sh
npm run test:unit
```

Targeted HTTP/SSE parity and failover tests can still be run separately with:

```sh
npm run test:integration
```

## Primary Demo

Start here:

```sh
npm run demo
```

Then open:

```text
http://127.0.0.1:4321
```

This is the main beginner-friendly entrypoint. It now shows both:

- the explainer routing demo
- a real in-process HTTP/SSE gateway view

Use the other demos when you want a narrower transport-specific deep dive.

## Run Demos

| Demo | Command | Port | Purpose |
| --- | --- | --- | --- |
| Local dashboard | `npm run demo` | `4321` | Main demo: beginner-friendly explanation plus real in-process gateway view |
| stdio example | `npm run demo:stdio` | none | Shared example server over stdio |
| Single-instance HTTP/SSE inspector | `npm run demo:http` | `3000` | Inspect one gateway-backed HTTP/SSE server |
| Multi-instance gateway demo | `npm run demo:multi` | `3001` | Inspect sticky routing and failover across multiple instances |
| Local load generator | `npm run demo:load:local` | targets `3001` | Put pressure on the multi-instance gateway demo |

## Run Tests

```sh
npm test
```

## Run The stdio Example

```sh
npm run demo:stdio
```

This starts the shared example server over `stdio` using MCP-style
`Content-Length` framing.

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

It now also explains that the repo has both:

- a reusable core layer for MCP-compatible handler dispatch
- a local routing/gateway demo layer for session affinity behavior

It also lets you interactively:

- view multiple fake MCP server instances
- change their health and load
- create new sessions
- route existing sessions back to the same server
- see overloaded instances skipped for new sessions
- mark a server unhealthy and watch reassignment happen
- inspect routing decisions step by step
- create a real in-process HTTP/SSE gateway session
- send runtime echoes through that real gateway path
- inspect richer live runtime SSE event payloads from inside the same dashboard

## HTTP/SSE Inspector

Run:

```sh
npm run demo:http
```

Then open:

```text
http://127.0.0.1:3000/inspector
```

Use this when you want to inspect real session stickiness, SSE event ordering,
and gateway behavior rather than the higher-level local dashboard.

## Multi-Server Gateway Demo

Run:

```sh
npm run demo:multi
```

Then open:

```text
http://127.0.0.1:3001/inspector
```

Run the load generator locally:

```sh
npm run demo:load:local
```

## Checks

```sh
npm run check
```

## Plan Document

The evaluation and execution plan for scaling this prototype lives in
[`docs/agentic-scale-up-plan.md`](docs/agentic-scale-up-plan.md).
