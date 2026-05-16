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

Today the implemented code is still narrow and focused on routing policy.

### Implemented

- [`packages/gateway/session-registry/memory-session-registry.js`](../packages/gateway/session-registry/memory-session-registry.js)
  provides an in-memory `session_id -> server_instance_id` registry.
- [`packages/gateway/load-balancer/load-router.js`](../packages/gateway/load-balancer/load-router.js)
  provides load-aware routing and sticky existing-session behavior.
- [`tests/session-routing/load-router.test.js`](../tests/session-routing/load-router.test.js)
  covers least-loaded assignment, stickiness, overload protection, and
  unhealthy-instance reassignment.
- The existing docs already describe the intended architecture and roadmap:
  - [`docs/design.md`](./design.md)
  - [`docs/session-affinity.md`](./session-affinity.md)
  - [`docs/load-balancing.md`](./load-balancing.md)
  - [`docs/prototype-roadmap.md`](./prototype-roadmap.md)

### Newly added in Milestone 1

- A self-explaining local dashboard for demoing the current routing slice.
- Routing traces so the UI can show each decision step by step.
- Broader automated tests around registry behavior and dashboard smoke checks.

## What Is Missing Before Scaling

The current prototype proves one gateway policy slice, but it does not yet
provide the full reusable stack needed for scale.

Missing pieces:

- real transport-neutral core interfaces
- application-facing MCP server abstraction
- implemented `stdio` adapter
- implemented HTTP/SSE adapter
- end-to-end sample server using shared business logic
- explicit reconnect and failure policies
- durable session registry strategy
- health/load reporting model for real instances
- more complete observability and operator workflows
- packaged standalone gateway runtime

## Step-by-Step Implementation Plan

### Phase 1: Stabilize the current routing prototype

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

## Testing Strategy

Testing should grow with the architecture.

### Current milestone

- unit tests for session registry behavior
- unit tests for load-aware routing behavior
- tests for overloaded instance handling
- tests for unhealthy instance reassignment
- tests for existing-session stickiness
- dashboard smoke test for local UI and API startup

### Next stages

- transport-neutral core tests
- cross-transport parity tests
- gateway integration tests
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

### Later demo goals

- swap fake instances for real transport-backed instances
- show real gateway wiring
- show reconnect/failure behavior
- show durable session handling when available

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
