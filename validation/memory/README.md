# Multi-Container Memory Proof

This directory is the canonical remote-runtime proof for the memory validation
target.

It validates one client talking through:

- one gateway process
- two remote memory MCP server processes
- one shared backing store file visible to both remote servers
- real HTTP calls between those runtimes

The proof focuses on the continuity thesis that matters for the memory target:

- session stickiness
- unhealthy-instance reassignment
- preserved memory visibility after reassignment
- shared-state visibility outside a single server process
- gateway observability and session snapshots

## Primary Commands

Run the default local multi-process proof:

```sh
npm run validate:memory:multicontainer
```

Run the same local multi-process topology with Phase 3 adaptive placement
enabled for the validation client:

```sh
npm run validate:memory:multicontainer:adaptive
```

Run the same proof as a Docker-based multi-container topology:

```sh
docker compose -f validation/memory/compose.multicontainer.yaml up --abort-on-container-exit client
```

Run the Docker topology with adaptive placement enabled:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=true \
MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST=memory-multicontainer-adaptive-client \
MCP_MEMORY_MULTICONTAINER_ADAPTIVE_PLACEMENT=1 \
docker compose -f validation/memory/compose.multicontainer.yaml up --abort-on-container-exit client
```

The Docker compose flow mounts the repo into four containers:

- `gateway`
- `mcp-server-a`
- `mcp-server-b`
- `client`

For a follow-on shared-gateway proof with a real Redis-backed session registry,
use [validation/shared-redis/README.md](../shared-redis/README.md). The memory
target remains the strongest workload for reconnect and continuity semantics
once cross-gateway session sharing is proven.

## Created Artifact

```text
validation-artifacts/memory-multicontainer/memory-store.json
```

## Reuse An Existing Deployment

The same client proof can target a separately deployed gateway and remote MCP
server fleet:

```sh
MCP_MEMORY_MULTICONTAINER_GATEWAY_URL=http://gateway-host:4210 \
MCP_MEMORY_MULTICONTAINER_SERVER_URLS=mem-a=http://server-a:4111,mem-b=http://server-b:4112 \
npm run validate:memory:multicontainer
```

Optional:

- `MCP_MEMORY_MULTICONTAINER_KEEP_ARTIFACTS=1`
- `MCP_MEMORY_MULTICONTAINER_ADAPTIVE_PLACEMENT=1`

## What The Proof Checks

- initialize succeeds through the gateway
- tool discovery works through the gateway
- memory write succeeds on the first routed server
- sticky follow-up requests stay on that server while it remains healthy
- unhealthy server state causes reassignment to another remote server
- the remembered fact remains visible after reassignment
- the shared store file shows the same memory outside either server process
- both remote servers expose the shared-memory snapshot
- gateway `/sessions` and `/observability` report the lifecycle correctly

When adaptive placement is enabled, the proof also checks:

- the allowlisted validation client initializes with `runtimeMode=stateless`
  from `runtimeModeSource=adaptive-classifier`
- a follow-up `memory_recall` routes to a different healthy remote server after
  load changes, while the remembered value remains visible through the shared
  file-backed store
- adaptive placement counters show one placement, zero fallbacks, and zero
  mismatches

## Useful Endpoints

When the Docker topology is running:

- gateway health: `http://127.0.0.1:4210/health`
- gateway sessions: `http://127.0.0.1:4210/sessions`
- gateway observability: `http://127.0.0.1:4210/observability`
- remote MCP A health: `http://127.0.0.1:4111/health`
- remote MCP B health: `http://127.0.0.1:4112/health`
- remote MCP A memory snapshot: `http://127.0.0.1:4111/memory`
- remote MCP B memory snapshot: `http://127.0.0.1:4112/memory`
