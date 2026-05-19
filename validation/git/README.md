# Multi-Container Git Proof

This directory is the canonical remote-runtime proof for the git validation
target.

It validates one client talking through:

- one gateway process
- two remote git MCP server processes
- real HTTP calls between those runtimes

The proof stays focused on the same thesis as the filesystem target:

- session stickiness
- unhealthy-instance reassignment
- shared workload visibility after reassignment
- gateway observability and session snapshots

## Primary Commands

Run the default local multi-process proof:

```sh
npm run validate:git:multicontainer
```

Run the same proof as a Docker-based multi-container topology:

```sh
docker compose -f validation/git/compose.yaml up --abort-on-container-exit client
```

The Docker compose flow mounts the repo into four containers:

- `gateway`
- `mcp-server-a`
- `mcp-server-b`
- `client`

## Created Artifact

```text
validation-artifacts/git-multicontainer/notes/git-multicontainer-change.txt
```

## Reuse An Existing Deployment

The same client proof can target a separately deployed gateway and remote MCP
server fleet:

```sh
MCP_GIT_MULTICONTAINER_GATEWAY_URL=http://gateway-host:4400 \
MCP_GIT_MULTICONTAINER_SERVER_URLS=git-a=http://server-a:4301,git-b=http://server-b:4302 \
npm run validate:git:multicontainer
```

Optional:

- `MCP_GIT_MULTICONTAINER_KEEP_ARTIFACTS=1`

## What The Proof Checks

- initialize succeeds through the gateway
- tool discovery works through the gateway
- file write succeeds on the first routed server
- git status shows the new file before staging
- sticky follow-up requests stay on the same server while it remains healthy
- unhealthy server state causes reassignment to another remote server
- the staged git artifact remains visible after reassignment
- gateway `/sessions` and `/observability` report the lifecycle correctly

## Useful Endpoints

When the Docker topology is running:

- gateway health: `http://127.0.0.1:4400/health`
- gateway sessions: `http://127.0.0.1:4400/sessions`
- gateway observability: `http://127.0.0.1:4400/observability`
- remote MCP A health: `http://127.0.0.1:4301/health`
- remote MCP B health: `http://127.0.0.1:4302/health`
