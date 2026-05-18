# Agentic Scale-Up Plan

## Purpose

This document turns the current prototype into a clear evaluation and execution
plan.

The repo is exploring how to scale MCP-compatible systems without changing MCP
protocol semantics. The recommended path is:

1. Build a reusable library core first.
2. Build a standalone self-hosted gateway on top of that core.

That order matters because the gateway should package proven building blocks,
not become the place where those building blocks are invented.

## Beginner-Friendly Summary

In plain English, this project is about separating two concerns:

- what an MCP server does
- how clients reach that server at runtime

The MCP part should stay the same. The infrastructure around it can change.

That matters because a single local `stdio` server is simple, but a multi-server
HTTP/SSE deployment introduces extra operational problems:

- the same client session may need to return to the same server
- some servers may be too busy for new work
- unhealthy servers may need traffic moved away from them

This repo is trying to solve those infrastructure problems without rewriting or
replacing MCP itself.

## Option 1: Reusable Library / Package

Option 1 means the project becomes a reusable library that other MCP servers can
embed.

### What it includes

- transport-neutral MCP-facing interfaces
- shared session primitives
- routing hooks and policies
- transport adapters
- reusable test fixtures

### Why it matters

- It creates the cleanest architecture boundary.
- It is the smallest safe step toward scale.
- It lets the same business logic run in different deployment shapes.
- It keeps the future gateway thin instead of overgrown.

### Beginner explanation

Think of Option 1 as building the engine first. Different products can then use
that same engine.

## Option 2: Standalone Self-Hosted Gateway

Option 2 means the project becomes a gateway process that runs in front of a
pool of MCP server instances.

### What it includes

- session-aware request routing
- load-aware new-session assignment
- health-aware reassignment behavior
- operator configuration
- observability and debugging endpoints

### Why it matters

- It gives operators a direct deployment story.
- It makes multi-instance MCP infrastructure easier to explain and demo.
- It is the most practical direction for local and self-hosted scaling.

### Why not build it first

- It depends on stable core abstractions.
- It risks mixing transport, routing, and application logic too early.
- It creates operational surface area before the shared library contract is real.

### Beginner explanation

Think of Option 2 as traffic control in front of many identical shops. It is
useful, but only after the shop design is stable.

## Recommendation

Recommended path:

1. Build the library core first.
2. Use that core inside a self-hosted gateway.
3. Keep both outcomes available long term:
   - embedded library usage
   - standalone gateway deployment

This gives the project a strong technical base while still supporting the
preferred self-hosted gateway direction.

## What Exists Now In The Repo

The repo is no longer just a routing prototype. It now has a real reusable core
slice plus transport-specific runtime demos.

### Implemented

- [`packages/core/protocol-adapter/mcp-application-server.js`](../packages/core/protocol-adapter/mcp-application-server.js)
  provides a transport-neutral MCP-compatible request dispatcher.
- [`packages/core/session/session-context.js`](../packages/core/session/session-context.js)
  provides a shared session context shape for handlers.
- [`packages/transports/stdio/stdio-transport.js`](../packages/transports/stdio/stdio-transport.js)
  provides framed stdio transport handling.
- [`packages/transports/http-sse/gateway-server.js`](../packages/transports/http-sse/gateway-server.js)
  provides a sticky-session HTTP/SSE gateway with SSE event streaming and an
  inspector UI.
- [`packages/core/protocol-adapter/demo-application.js`](../packages/core/protocol-adapter/demo-application.js)
  and
  [`packages/core/protocol-adapter/demo-application-server.js`](../packages/core/protocol-adapter/demo-application-server.js)
  provide a shared demo application plus a transport-facing server boundary.
- [`packages/gateway/session-registry/memory-session-registry.js`](../packages/gateway/session-registry/memory-session-registry.js)
  provides an in-memory `session_id -> server_instance_id` registry.
- [`packages/gateway/load-balancer/load-router.js`](../packages/gateway/load-balancer/load-router.js)
  provides load-aware routing and sticky existing-session behavior.
- [`packages/gateway/config/operator-config.js`](../packages/gateway/config/operator-config.js)
  provides basic operator-facing defaults and environment-driven policy overrides.
- Example runtimes now exist for:
  - [`examples/stdio-server/server.js`](../examples/stdio-server/server.js)
  - [`examples/http-sse-server/server.js`](../examples/http-sse-server/server.js)
  - [`examples/multi-server-load-balanced-demo/server.js`](../examples/multi-server-load-balanced-demo/server.js)
- Automated coverage now includes:
  - reusable core behavior
  - stdio transport behavior
  - demo-application parity
  - routing/session tests
  - dashboard smoke tests
  - socket-bound HTTP/SSE integration tests
- The existing docs already describe the intended architecture and roadmap:
  - [`docs/design.md`](./design.md)
  - [`docs/session-affinity.md`](./session-affinity.md)
  - [`docs/load-balancing.md`](./load-balancing.md)
  - [`docs/prototype-roadmap.md`](./prototype-roadmap.md)
  - [`docs/test-strategy.md`](./test-strategy.md)

### Current explanation milestone

- The local dashboard explains the current scaling work in plain English.
- Routing traces make assignment decisions visible step by step.
- The HTTP/SSE inspector exposes real session and SSE behavior for local
  inspection.

## What Is Missing Before Scaling

The repo now proves the main architecture direction, but it is not yet a fully
productized reusable stack.

Missing pieces:

- one fully shared application boundary used consistently by every transport
- cleaner unification between the reusable MCP core and the newer demo/gateway
  path
- production-grade durable session registry backends beyond the local file-backed prototype
- fuller operator workflows around TTL, reconnect grace windows, restart policy defaults, and observability
- structured log/metrics sinks beyond the current in-process audit trail
- health/load reporting model for real instances
- more complete observability and operator workflows
- packaged standalone gateway runtime

## Advanced Future Enhancements

- **Context / State Migration (Solving the "Hot Instance" problem):** Freezing an active MCP session state on an overloaded server and migrating it to an idle server mid-session. This would prevent load imbalance and save significant AI inference costs by avoiding context rebuilds.
- **Memory Management (TTL & Sliding Window):** The infrastructure must enforce strict TTLs to clear abandoned sessions (preventing memory leaks), while the AI Client must implement a sliding window or auto-summarization to prevent active, long-running sessions from causing out-of-memory crashes.
- **Deployment Alternatives (AWS ALB vs Custom Gateway):** Providing clear deployment guidance. Use AWS ALB or open-source proxies (like NGINX) for out-of-the-box sticky routing. Use the custom Node.js gateway (Option 2) when advanced programmatic control (like P2P migration) is required.

## Step-by-Step Implementation Plan

### Phase 1: Explain and validate the routing prototype

Goal: make the current gateway logic visible, explainable, and testable.

Deliverables:

- local dashboard
- routing decision trace output
- stronger registry and routing tests
- updated docs and README

### Phase 2: Build the reusable library core

Goal: define the smallest transport-neutral API that preserves MCP semantics.

Deliverables:

- protocol adapter contracts
- shared request/response/notification dispatch model
- handler registration model
- session context shape exposed to handlers

### Phase 3: Prove one shared example server

Goal: define one tiny MCP server once and reuse it everywhere.

Deliverables:

- one example tool/resource flow
- transport-neutral business logic
- shared behavior tests

### Phase 4: Implement `stdio` first

Goal: prove the core in the simplest environment before adding gateway
complexity.

Deliverables:

- working `stdio` transport adapter
- example server running over `stdio`
- protocol semantics tests

### Phase 5: Add HTTP/SSE support

Goal: expose session identity and transport differences without rewriting the
application logic.

Deliverables:

- HTTP/SSE adapter
- session ID extraction and propagation
- cross-transport parity tests

### Phase 6: Build the self-hosted gateway on top

Goal: turn the current routing policy work into a usable self-hosted runtime
layer.

Deliverables:

- gateway entrypoint
- instance registration model
- route observability endpoints
- local multi-instance demo against real transport flows

### Phase 7: Add failure handling and persistence

Goal: define what “scaling” really means when servers fail or restart.

Deliverables:

- unhealthy-instance policy
- reconnect and reinitialize policy
- durable session registry plan or first implementation
- failure scenario tests

Status:

- complete for the prototype layer:
  - durable file-backed registry
  - explicit restart reconnect behavior
  - session TTL enforcement
  - reconnect grace-window enforcement
- next step for production hardening:
  - external state backends
  - configurable operator policy
  - clearer reconnect semantics across distributed runtimes

## Testing Strategy

Testing should grow with the architecture.

### Current milestone

- unit tests for reusable MCP-core behavior
- unit tests for session registry behavior
- unit tests for load-aware routing behavior
- tests for stdio transport framing
- tests for demo-application parity
- tests for overloaded instance handling
- tests for unhealthy instance reassignment
- tests for existing-session stickiness
- dashboard smoke test for local UI and API startup
- tests for durable registry persistence across process restarts
- tests for explicit reconnect and recovery actions

### Next stages

- unify handler-level transport tests behind one shared server boundary
- add socket-free handler/controller coverage for HTTP/SSE where possible
- failure and reconnect tests
- durable registry tests once persistence exists

### Beginner explanation

The tests should prove not just that code runs, but that the scaling rules are
actually enforced:

- new sessions avoid overloaded servers
- existing sessions stay sticky
- unhealthy servers stop receiving traffic

## Demo / UI Strategy

Because the audience is not deeply technical, each milestone should be explained
through a local visual dashboard.

### Milestone 1 dashboard goals

- explain the MCP scaling problem in plain English
- explain session affinity and load-aware routing
- compare Option 1 and Option 2
- show what is implemented now versus what is still planned
- demonstrate routing behavior interactively
- show decision logs step by step
- show what code was added and what tests prove
- link the dashboard story to the real HTTP/SSE inspector path

### Later demo goals

- swap fake instances for real transport-backed instances
- show real gateway wiring
- show reconnect/failure behavior
- show durable session handling when available

## Future Validation Plan

The next serious proof step should move beyond the local in-process demo and
test the thesis in a more realistic deployment shape.

### Goal

Prove that this repo can act as the communication and session-management layer
around a real MCP-compatible workload without changing MCP semantics.

### Proposed setup

- run the gateway in one container or VM
- run one or more MCP server instances in separate containers or VMs
- run the MCP client from another machine or container
- use HTTP/SSE or the closest deployable transport boundary as the shared path
- persist session state outside process memory

### Best validation target

Use one open-source MCP server as the first real integration target.

That gives the project a better proof than a toy demo because it tests:

- whether the reusable core and gateway assumptions fit real MCP traffic
- whether sticky session routing still works with real tools and state
- whether reconnect and restart policy are understandable in practice
- whether the gateway remains an infrastructure layer instead of becoming a
  protocol fork

### Suggested execution order

1. Pick a small open-source MCP server that already works over a supported
   local transport.
2. Wrap or front it with this repo's transport/gateway path instead of changing
   the server business logic.
3. Run client, gateway, and server on separate containers or hosts.
4. Verify new-session assignment, sticky follow-up routing, overload avoidance,
   unhealthy-instance reassignment, restart recovery, TTL expiry, and reconnect
   grace behavior.
5. Capture operator-facing logs and dashboard output to confirm the thesis is
   understandable, not just technically functional.

### Success criteria

- the MCP server behavior still works through the gateway path
- the same client session returns to the same healthy server
- new sessions avoid overloaded servers
- unhealthy servers stop receiving sticky traffic
- durable restart and reconnect behavior remain explicit
- expired sessions are rejected clearly instead of silently reviving stale state

### Why this matters

This is the step that turns the current prototype from an architecture proof
into a real deployment argument.

If this works with an open-source MCP server across separate machines or
containers, the repo’s thesis becomes much more credible.

The concrete execution details for that phase are captured in
[`docs/real-world-validation-plan.md`](./real-world-validation-plan.md).

## Risks And Assumptions

### Risks

- building gateway packaging before the reusable core is stable
- mixing protocol logic with transport and routing logic
- assuming in-memory state is good enough for real scale
- under-defining reconnect and failure behavior
- lacking observability when something routes incorrectly

### Assumptions

- MCP protocol semantics stay unchanged
- session-aware routing remains infrastructure, not protocol
- Node.js stays the initial implementation runtime
- self-hosted/local gateway remains the preferred deployment direction
- early milestones optimize for clarity and proof, not production hardening

## Milestone 1 Scope Summary

Milestone 1 is intentionally practical rather than ambitious.

It does not turn this repo into a hosted service.
It does not remove or replace MCP semantics.
It does not claim the gateway is production-ready.

It does:

- preserve the current session registry and router behavior
- make the routing layer visible in a local dashboard
- explain the architecture in beginner-friendly language
- prepare the repo for the next core-library-first implementation phase
