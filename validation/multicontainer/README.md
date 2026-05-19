# Multi-Container Filesystem Proof

This directory is the canonical remote-runtime proof for the repo.

It validates one client talking through:

- one gateway process
- two remote filesystem MCP server processes
- real HTTP calls between those runtimes

The proof stays focused on the thesis:

- session stickiness
- unhealthy-instance reassignment
- shared workload visibility after reassignment
- gateway observability and session snapshots

For the Redis-backed shared-gateway variant, see:

- [validation/shared-redis/README.md](../shared-redis/README.md)

## Primary Commands

Run the default local multi-process proof:

```sh
npm run validate:filesystem:multicontainer
```

Run the same proof as a Docker-based multi-container topology:

```sh
docker compose -f validation/multicontainer/compose.yaml up --abort-on-container-exit client
```

Run the Redis-backed two-gateway variant:

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```

The Docker compose flow mounts the repo into four containers:

- `gateway`
- `mcp-server-a`
- `mcp-server-b`
- `client`

## Created Artifact

```text
validation-artifacts/filesystem-multicontainer/notes/multicontainer-proof.txt
```

## Reuse An Existing Deployment

The same client proof can target a separately deployed gateway and remote MCP
server fleet:

```sh
MCP_MULTICONTAINER_GATEWAY_URL=http://gateway-host:4200 \
MCP_MULTICONTAINER_SERVER_URLS=fs-a=http://server-a:4101,fs-b=http://server-b:4102 \
npm run validate:filesystem:multicontainer
```

Optional:

- `MCP_MULTICONTAINER_KEEP_ARTIFACTS=1`

## What The Proof Checks

- initialize succeeds through the gateway
- tool discovery works through the gateway
- file write succeeds on the first routed server
- sticky follow-up requests stay on that server while it remains healthy
- unhealthy server state causes reassignment to another remote server
- the created artifact remains visible after reassignment
- gateway `/sessions` and `/observability` report the lifecycle correctly

## Useful Endpoints

When the Docker topology is running:

- gateway health: `http://127.0.0.1:4200/health`
- gateway sessions: `http://127.0.0.1:4200/sessions`
- gateway observability: `http://127.0.0.1:4200/observability`
- remote MCP A health: `http://127.0.0.1:4101/health`
- remote MCP B health: `http://127.0.0.1:4102/health`
