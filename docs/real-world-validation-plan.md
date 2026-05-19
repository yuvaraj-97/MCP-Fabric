# Real-World Validation Plan

## Purpose

The local prototype is now strong enough that the next useful step is not more
in-process demo work. The next step is to prove the thesis against a real
MCP-compatible workload across separate runtimes.

This document defines that next phase.

## Core Thesis To Validate

This repo should be able to sit between an MCP client and one or more MCP
server instances as a communication and session-management layer without
changing MCP protocol semantics.

That means proving all of the following at once:

- MCP behavior still works through the gateway path
- sticky routing keeps an existing session on the same healthy instance
- new sessions avoid overloaded instances
- unhealthy instances stop receiving sticky traffic
- restart, reconnect, TTL expiry, and grace-window policy stay explicit

## Recommended Deployment Shape

Use separate runtimes, even if they are all on one physical host at first.

### Minimum topology

- `client` container or VM
- `gateway` container or VM
- `mcp-server-a` container or VM
- `mcp-server-b` container or VM
- durable session state outside in-memory process scope

### Better topology

- client on one machine
- gateway on another machine
- MCP server instances on separate machines or containers

This is important because it forces the design to behave like real
infrastructure rather than a single-process demo.

## First Integration Target

Use one small open-source MCP server as the first external validation target.

### Validation order

Use this sequence:

1. `filesystem`
2. `git`
3. `memory`

Why:

- `filesystem` is the cleanest first proof with minimal moving parts
- `git` is a more realistic local stateful workload after that
- `memory` is the best later stress-test for lifecycle and continuity semantics

### Good target characteristics

- simple setup
- limited dependencies
- stateful enough that session stickiness matters
- already used by others, so the traffic shape is not toy-only
- can run locally or in a container without a large cloud footprint

### Avoid for the first pass

- very large multi-service MCP stacks
- targets that require several proprietary credentials
- targets whose failures are hard to distinguish from gateway issues

## Validation Phases

### Phase 1: Single external MCP server behind the gateway

Goal:
prove the gateway can sit in front of one real MCP server without breaking the
protocol or application behavior.

Checks:

- initialize works
- follow-up requests work
- tools/resources still behave correctly
- session IDs remain visible and consistent
- reconnect after gateway restart still works when policy allows it

### Phase 2: Multiple identical MCP server instances

Goal:
prove session affinity and load-aware routing with a real server, not just the
demo application.

Checks:

- new sessions distribute by configured load policy
- existing sessions stay sticky
- overloaded instance is skipped for new sessions
- unhealthy instance causes reassignment

### Phase 3: Failure and lifecycle validation

Goal:
prove runtime hardening behavior under real operational conditions.

Checks:

- gateway restart with durable registry
- server restart with rehydration path
- reconnect within grace
- reconnect after grace rejection
- request after TTL expiry rejection

### Phase 4: Headless load validation

Goal:
prove the thesis under CLI-driven stress conditions on a headless server.

Checks:

- burst session creation
- repeated follow-up requests on the same session
- mixed healthy/unhealthy instance transitions
- SSE reconnect behavior if available for the chosen target
- operator logs remain interpretable

## Headless-Friendly Test Flow

This plan assumes you may not have a browser available.

### Primary workflow

- run the gateway and MCP servers in containers or separate processes
- drive the flow with CLI scripts or test harnesses
- inspect logs, JSON responses, and session-registry state directly

### Current filesystem-first remote proof

The repo now includes a headless filesystem proof that drives a real HTTP
gateway against separate remote MCP server processes.

Run it locally with:

```sh
npm run validate:filesystem:multicontainer
```

That command starts:

- one client process
- one gateway process
- two remote filesystem MCP server processes

It verifies:

- sticky routing for an existing session
- unhealthy-instance reassignment
- visible filesystem artifacts through MCP calls
- visible filesystem artifacts in shared workspace snapshots across the remote servers

Created artifact:

```text
validation-artifacts/filesystem-multicontainer/notes/multicontainer-proof.txt
```

The proof report includes:

- gateway base URL
- remote server base URLs
- MCP initialize and tool-call results
- gateway `/sessions` and `/observability` snapshots
- direct `/workspace` snapshots from the remote servers

The same client script can also target a separately deployed gateway and server
fleet by setting:

- `MCP_MULTICONTAINER_GATEWAY_URL`
- `MCP_MULTICONTAINER_SERVER_URLS`

For a Docker-based topology, use:

```sh
docker compose -f validation/multicontainer/compose.yaml up --abort-on-container-exit client
```

Treat `validation/multicontainer/` as the canonical proof implementation. That
directory contains the harness, runtime entrypoints, compose file, and
operator-facing instructions for the filesystem-first remote proof.

### Current git remote proof

The repo now also includes a headless git proof that drives the same remote
gateway pattern against separate remote git MCP server processes.

Run it locally with:

```sh
npm run validate:git:multicontainer
```

That command starts:

- one client process
- one gateway process
- two remote git MCP server processes

It verifies:

- sticky routing for an existing session
- unhealthy-instance reassignment
- visible staged git state after reassignment
- visible repository artifacts in shared workspace snapshots across the remote servers

Created artifact:

```text
validation-artifacts/git-multicontainer/notes/git-multicontainer-change.txt
```

The proof report includes:

- gateway base URL
- remote server base URLs
- MCP initialize and tool-call results
- gateway `/sessions` and `/observability` snapshots
- direct `/workspace` snapshots from the remote servers

For a Docker-based topology, use:

```sh
docker compose -f validation/git/compose.yaml up --abort-on-container-exit client
```

Treat `validation/git/` as the canonical proof implementation for the remote
git validation target.

### Current memory remote proof

The repo now also includes a headless memory proof that drives the same remote
gateway pattern against separate remote memory MCP server processes backed by
one shared store file.

Run it locally with:

```sh
npm run validate:memory:multicontainer
```

That command starts:

- one client process
- one gateway process
- two remote memory MCP server processes

It verifies:

- sticky routing for an existing session
- unhealthy-instance reassignment
- visible remembered facts after reassignment
- visible shared-state continuity outside either remote server process

Created artifact:

```text
validation-artifacts/memory-multicontainer/memory-store.json
```

The proof report includes:

- gateway base URL
- remote server base URLs
- MCP initialize and tool-call results
- gateway `/sessions` and `/observability` snapshots
- direct `/memory` snapshots from the remote servers
- the persisted backing-store snapshot read from disk

For a Docker-based topology, use:

```sh
docker compose -f validation/memory/compose.multicontainer.yaml up --abort-on-container-exit client
```

Treat `validation/memory/` as the canonical proof implementation for the remote
memory validation target.

### Laptop-friendly first pass

Before moving to containers or separate hosts, the same validation flow should
also run on a laptop with one command.

Current first command:

```sh
npm run validate:filesystem
```

That command validates the first target locally through both transports without
requiring a browser.

Current remote-proof command:

```sh
npm run validate:filesystem:multicontainer
```

That command proves the filesystem workload through:

- a separate gateway process
- separate remote MCP server processes
- real HTTP traffic between them

Current laptop walkthrough:

```sh
npm run demo
```

Then open:

```text
http://127.0.0.1:4321/validation.html
```

That page lets a user click each scripted conversation step manually and inspect
the prompt, purpose, output, and assistant-side interpretation.

Current OpenAI-backed conversation command:

```sh
npm run validate:filesystem:openai
```

That command uses the same filesystem validation workload, but the assistant
reply is generated through the OpenAI Responses API after a required tool call.

### What to capture

- request payload
- session ID
- routed server instance ID
- recovery action
- registry state before and after lifecycle transitions
- timestamps for disconnect, reconnect, expiry, and reassignment

For the current filesystem remote proof, also capture:

- created artifact path
- gateway `/sessions` snapshot
- gateway `/observability` summary
- direct `/workspace` snapshots from both remote servers

For the current memory remote proof, also capture:

- shared store file path
- gateway `/sessions` snapshot
- gateway `/observability` summary
- direct `/memory` snapshots from both remote servers
- the persisted backing-store snapshot after reassignment

## Suggested Test Matrix

| Scenario | Expected Result |
| --- | --- |
| New session on healthy fleet | Assigned to least-loaded healthy instance |
| Existing session follow-up | Routed back to same instance |
| Assigned instance overloaded | Existing session stays sticky |
| New session while one instance overloaded | Overloaded instance skipped |
| Assigned instance unhealthy | Session reassigned or rehydrated |
| Gateway restart with durable registry | Session can reconnect if still valid |
| Disconnect then reconnect within grace | Session resumes with explicit recovery action |
| Disconnect then reconnect after grace | Rejected and reinitialize required |
| Request after TTL expiry | Rejected and stale session not revived |

## Deliverables For This Phase

- one chosen open-source MCP target documented in the repo
- one repeatable container or multi-process setup
- one CLI-driven validation script or test harness
- captured evidence for each scenario in the test matrix
- clear notes on where the thesis holds and where it does not

Current status:

- chosen first target: `filesystem`
- repeatable multi-process proof: implemented
- canonical proof directory: `validation/multicontainer/`
- Docker topology file: `validation/multicontainer/compose.yaml`
- CLI client proof: `npm run validate:filesystem:multicontainer`
- chosen second target: `git`
- canonical git proof directory: `validation/git/`
- CLI git proof: `npm run validate:git:multicontainer`
- chosen third target: `memory`
- canonical memory proof directory: `validation/memory/`
- CLI memory proof: `npm run validate:memory:multicontainer`

## Success Criteria

This phase is successful if:

- the chosen MCP workload still functions through the gateway
- no MCP protocol semantics need to be changed
- sticky routing is observable and reliable
- lifecycle behavior is explicit and debuggable
- the gateway still looks like infrastructure, not a protocol fork

## Next Steps After Validation

If the real-world validation succeeds, the next build steps should be:

1. package the gateway as a clearer standalone runtime
2. add stronger operator observability and structured logs
3. support external shared state backends beyond local files
4. document deployment alternatives such as ALB/NGINX versus the custom
   gateway path

## Longer-Term Future Work

Only after the above is proven should the repo move into more advanced ideas:

- hot-session or context migration for overloaded active instances
- richer policy controls for different workload classes
- deeper memory-management coordination between infra TTLs and client-side
  summarization/sliding context windows
