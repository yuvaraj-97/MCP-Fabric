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
- official `@modelcontextprotocol/sdk`-backed core request handling for
  `initialize`, `ping`, `tools/list`, and `tools/call`
- session context helper for shared handler execution
- basic `stdio` adapter with framed JSON-RPC message handling
- newline-delimited local `stdio` harness for transport parity checks
- shared example server proving one tool set can run through the core
- in-memory and file-backed session registries
- load-aware router
- HTTP/SSE gateway with session stickiness, explicit reconnect/recovery actions,
  session TTL and reconnect grace-window enforcement, SSE event visibility, and
  basic operator observability
- self-explaining local dashboard for routing behavior
- automated tests for core dispatch, `stdio` transport behavior, stickiness,
  HTTP/SSE parity, overload protection, unhealthy-instance reassignment, SSE
  visibility, durable restart/reconnect behavior, failover, and dashboard
  startup

External production-grade state backends, operator-friendly policy controls, and
fuller gateway packaging are still the next recommended build steps.

What still remains outside the official SDK path:

- transport adapters are still repo-owned wrappers
- demo-specific custom methods still run through the repo's registration layer
- hot context checkpointing and migration are not implemented

The concrete next-phase deployment proof is documented in
[docs/real-world-validation-plan.md](./docs/real-world-validation-plan.md).

## Operator Configuration

The local dashboard and HTTP/SSE gateway now support basic operator-oriented
configuration through environment variables:

- `PORT`
- `HOST`
- `MCP_GATEWAY_DEFAULT_SERVER_COUNT`
- `MCP_GATEWAY_LOAD_THRESHOLD`
- `MCP_GATEWAY_AUTOSCALE_THRESHOLD`
- `MCP_GATEWAY_SESSION_TTL_MS`
- `MCP_GATEWAY_RECONNECT_GRACE_MS`
- `MCP_GATEWAY_ON_DISCONNECT`
- `MCP_GATEWAY_ALLOW_PUBLIC_BIND`
- `MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT`

Example:

```sh
HOST=127.0.0.1 \
MCP_GATEWAY_DEFAULT_SERVER_COUNT=4 \
MCP_GATEWAY_LOAD_THRESHOLD=0.75 \
MCP_GATEWAY_AUTOSCALE_THRESHOLD=0.8 \
MCP_GATEWAY_SESSION_TTL_MS=90000 \
MCP_GATEWAY_RECONNECT_GRACE_MS=12000 \
MCP_GATEWAY_ON_DISCONNECT=queue \
npm run demo
```

Security note:

- loopback binds such as `127.0.0.1` are the default
- public binds such as `0.0.0.0` now trigger a startup security warning
- public binds fail fast unless explicitly allowed
- the Docker multi-container proofs opt into public bind and disable the
  startup self-hijack check inside the container topology

The gateway also exposes a JSON observability surface at `/observability` with:

- recent structured audit events
- request/rejection/reconnect/reassignment counters
- stream attachment and detachment counters

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
- a durable runtime session registry that can survive an in-process restart
- explicit session TTL and reconnect grace-window behavior

Use the other demos when you want a narrower transport-specific deep dive.

## Run Demos

| Demo | Command | Port | Purpose |
| --- | --- | --- | --- |
| Local dashboard | `npm run demo` | `4321` | Main demo: beginner-friendly explanation plus real in-process gateway view |
| Validation walkthrough page | `npm run demo` | `4321/validation.html` | Click each scripted conversation step and inspect what it proves plus the raw output |
| stdio example | `npm run demo:stdio` | none | Shared example server over stdio |
| Single-instance HTTP/SSE inspector | `npm run demo:http` | `3000` | Inspect one gateway-backed HTTP/SSE server |
| Multi-instance gateway demo | `npm run demo:multi` | `3001` | Inspect sticky routing and failover across multiple instances |
| Local load generator | `npm run demo:load:local` | targets `3001` | Put pressure on the multi-instance gateway demo |
| Filesystem validation harness | `npm run validate:filesystem` | none | Headless validation of the same filesystem-style MCP app over `stdio` and gateway-backed HTTP/SSE |
| Filesystem multi-container proof | `npm run validate:filesystem:multicontainer` | dynamic local ports | Canonical headless proof against a real HTTP gateway process with separate remote MCP server processes |
| Shared Redis two-gateway proof | `npm run validate:shared-redis` | external topology or Docker compose | Real Redis-backed session continuity across two gateway processes sharing one session key |
| Git validation harness | `npm run validate:git` | none | Headless validation of the same git-style MCP app over `stdio` and gateway-backed HTTP/SSE |
| Git multi-container proof | `npm run validate:git:multicontainer` | dynamic local ports | Remote proof against a real HTTP gateway process with separate remote git MCP server processes |
| Memory validation harness | `npm run validate:memory` | none | Headless validation of the same memory-style MCP app over `stdio` and gateway-backed HTTP/SSE |
| Memory multi-container proof | `npm run validate:memory:multicontainer` | dynamic local ports | Remote proof that remembered facts survive reassignment because remote servers share a backing store |
| Filesystem conversation validation | `npm run validate:filesystem:conversation` | none | Headless scripted conversation proving the same app behavior over `stdio` and gateway-backed HTTP/SSE |
| Filesystem OpenAI conversation validation | `npm run validate:filesystem:openai` | none | Headless tool-calling OpenAI conversation using the same validation workload |

## Run Tests

```sh
npm test
```

## Run Filesystem Validation

```sh
npm run validate:filesystem
```

This headless validation harness proves:

- the same filesystem-style MCP application code runs over `stdio`
- the same application code runs through the HTTP/SSE gateway
- sticky routing works for follow-up requests
- unhealthy-instance reassignment still preserves the underlying workload
- gateway observability counters and audit events record what happened

This is the first target in the real-world validation order:

1. `filesystem`
2. `git`
3. `memory`

## Run Git Validation

```sh
npm run validate:git
```

This headless validation harness proves:

- the same git-style MCP application code runs over `stdio`
- the same application code runs through the HTTP/SSE gateway
- sticky routing works for follow-up requests
- unhealthy-instance reassignment still preserves the shared repository state
- staged git changes remain visible after reassignment

## Run Git Multi-Container Proof

```sh
npm run validate:git:multicontainer
```

This remote proof uses:

- one client process
- one gateway process
- two separate remote git MCP server processes
- real HTTP traffic between those runtimes

It creates:

```text
validation-artifacts/git-multicontainer/notes/git-multicontainer-change.txt
```

Docker version:

```sh
docker compose -f validation/git/compose.yaml up --abort-on-container-exit client
```

## Run Memory Validation

```sh
npm run validate:memory
```

This headless validation harness proves:

- the same memory-style MCP application code runs over `stdio`
- the same application code runs through the HTTP/SSE gateway
- sticky routing works for follow-up requests
- unhealthy-instance reassignment still preserves the remembered fact
- shared memory state remains visible across server instances

## Run Memory Multi-Container Proof

```sh
npm run validate:memory:multicontainer
```

This remote proof uses:

- one client process
- one gateway process
- two separate remote memory MCP server processes
- one shared backing store file outside either server process
- real HTTP traffic between those runtimes

It creates:

```text
validation-artifacts/memory-multicontainer/memory-store.json
```

Docker version:

```sh
docker compose -f validation/memory/compose.multicontainer.yaml up --abort-on-container-exit client
```

## Run Filesystem Multi-Container Proof

```sh
npm run validate:filesystem:multicontainer
```

This headless remote proof starts:

- one client process
- one HTTP gateway process
- two remote filesystem MCP server processes

Then it verifies:

- sticky routing on the same session
- unhealthy-instance reassignment
- file artifact visibility through MCP calls
- direct shared-workspace visibility across the remote server topology

The created artifact path is:

```text
validation-artifacts/filesystem-multicontainer/notes/multicontainer-proof.txt
```

If you already have a gateway and remote servers running on separate hosts or
containers, point the client proof at them instead of spawning local processes:

```sh
MCP_MULTICONTAINER_GATEWAY_URL=http://gateway-host:4200 \
MCP_MULTICONTAINER_SERVER_URLS=fs-a=http://server-a:4101,fs-b=http://server-b:4102 \
MCP_MULTICONTAINER_KEEP_ARTIFACTS=1 \
npm run validate:filesystem:multicontainer
```

For a Docker-based version of the same topology, run:

```sh
docker compose -f validation/multicontainer/compose.yaml up --abort-on-container-exit client
```

Treat `validation/multicontainer/` as the single proof directory for this
workflow. It contains the harness, remote runtime entrypoints, compose file,
and operator instructions:

- [validation/multicontainer/README.md](./validation/multicontainer/README.md)

## Run Shared Redis Two-Gateway Proof

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```

This proof is different from the shared-workspace and shared-store proofs:

- one client initializes through `gateway-a`
- the same session continues through `gateway-b`
- both gateways share one Redis session registry key
- both gateways point at the same remote MCP server fleet

You can also point the client at an already-running topology:

```sh
MCP_SHARED_REDIS_GATEWAY_A_URL=http://127.0.0.1:4200 \
MCP_SHARED_REDIS_GATEWAY_B_URL=http://127.0.0.1:4201 \
MCP_SHARED_REDIS_SERVER_URLS=fs-a=http://127.0.0.1:4101,fs-b=http://127.0.0.1:4102 \
npm run validate:shared-redis
```

The canonical operator instructions live in:

- [validation/shared-redis/README.md](./validation/shared-redis/README.md)

## Run Filesystem Conversation Validation

```sh
npm run validate:filesystem:conversation
```

This headless scripted conversation flow simulates a user asking an assistant to:

- connect over `stdio`
- discover available filesystem tools
- write a file
- reconnect through the HTTP/SSE gateway
- read and list the same file over the gateway path
- force unhealthy-instance reassignment and confirm the file still reads

## Run Filesystem OpenAI Conversation Validation

```sh
npm run validate:filesystem:openai
```

This uses `OPENAI_API_KEY` from the environment or `.env`, calls the OpenAI
Responses API, and requires the model to invoke a validation tool for each
conversation step before it replies in plain English.

The validation file is written into a repo-local workspace so you can inspect it
directly after a run:

```text
validation-artifacts/filesystem-conversation/notes/hello.txt
validation-artifacts/filesystem-headless/notes/hello.txt
```

## Laptop Walkthrough Page

Run:

```sh
npm run demo
```

Then open:

```text
http://127.0.0.1:4321/validation.html
```

That page lets you choose:

- a deterministic scripted walkthrough
- an OpenAI-backed conversation walkthrough if `OPENAI_API_KEY` is available

Then click `Send step` for each turn and inspect:

- the user-style prompt
- what the step is testing
- the expected outcome
- the raw MCP-level output
- an assistant-style summary of what just happened

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
- restart the runtime gateway and reconnect an existing durable session
- simulate a disconnect, reconnect within grace, and see the gateway explain the decision
- inspect richer live runtime SSE event payloads from inside the same dashboard
- inspect operator-facing gateway counters and recent audit events from the same dashboard

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
