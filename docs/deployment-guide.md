# Deployment Guide

This guide covers practical ways to deploy the MCP-Fabric gateway and which
topology to use for production-like canary testing. For the gateway process
itself — entrypoint, env vars, ports, endpoints, security posture — see
[`standalone-gateway.md`](./standalone-gateway.md).

The gateway runtime behavior is identical across all of these; only the process
manager, networking, and session-registry backend change.

## Topology summary

| Deployment | Gateways | Session registry | Best for | Production-ready? |
| --- | --- | --- | --- | --- |
| Local Docker (self-contained) | 1 | `memory` | Smoke tests, demos | Yes, for evaluation only |
| Single-host | 1 | `file` | Small/internal single-node deployments | Yes, single node |
| Externally managed / horizontal | 2+ | `redis` (shared) | Production-like canary, HA | Yes (Redis is the required shared backend) |

## 1. Local Docker

Build and run the self-contained gateway (in-process demo applications, loopback
only):

```sh
docker build -t mcp-fabric-gateway .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e HOST=0.0.0.0 \
  -e MCP_GATEWAY_ALLOW_PUBLIC_BIND=true \
  -e MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT=false \
  mcp-fabric-gateway
curl -s http://127.0.0.1:3000/health | jq .
```

A container must bind `0.0.0.0` to be reachable through the published port, which
the startup audit treats as public — hence the two opt-in flags. Publishing only
to `127.0.0.1:3000` on the host keeps it off the network. This mode uses the
non-durable `memory` registry and is for evaluation, not production traffic.

## 2. Single-host

Run one gateway with a durable `file` registry so placement survives restarts,
fronting real backend MCP servers. Use a process manager (systemd, pm2) for
restart-on-failure:

```sh
PORT=3000 HOST=127.0.0.1 \
MCP_GATEWAY_SESSION_REGISTRY_BACKEND=file \
MCP_GATEWAY_SESSION_REGISTRY_FILE=/var/lib/mcp-fabric/sessions.json \
SERVER_INSTANCES_JSON='[{"serverInstanceId":"srv-a","load":0.1,"healthy":true,"acceptingNewSessions":true}]' \
REMOTE_BASE_URLS_JSON='{"srv-a":"http://127.0.0.1:4101"}' \
npm run start:gateway
```

Put a TLS-terminating, authenticating reverse proxy (nginx, Caddy, a cloud LB)
in front if the gateway must be reachable beyond loopback. The `file` registry is
durable on one host but is **not** shared across hosts; do not run a second
gateway against the same file.

## 3. Externally managed (horizontal / cloud)

Run two or more gateway replicas behind an external load balancer, all sharing a
single Redis-backed session registry. This is the only topology that preserves
sticky session affinity across multiple gateway processes (Redis fails closed on
outage rather than splitting affinity into per-process memory).

Per-replica environment:

```sh
HOST=0.0.0.0 PORT=4400 \
MCP_GATEWAY_ALLOW_PUBLIC_BIND=true \
MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT=false \
MCP_GATEWAY_SESSION_REGISTRY_BACKEND=redis \
REDIS_URL=redis://<redis-host>:6379 \
MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY=mcp:gateway:sessions \
SERVER_INSTANCES_JSON='[...]' \
REMOTE_BASE_URLS_JSON='{...}' \
npm run start:gateway
```

Operational requirements for this topology:

- All replicas share the same `REDIS_URL` and `MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY`.
- The external LB terminates TLS and authenticates clients; the gateway has no
  built-in auth.
- Health-check each replica's `GET /health`; drain via the LB before stopping a
  replica.
- Scrape/forward `GET /observability` counters into your monitoring stack.

## Recommended topology for production-like canary testing

**Use the horizontal, shared-Redis, multi-gateway topology** (option 3),
mirrored locally by `validation/shared-redis/compose.yaml`:

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```

This topology is recommended for canary testing because it is the only one that
exercises the properties a production canary must prove:

- two gateways sharing affinity through Redis (horizontal correctness),
- fail-closed behavior under registry outage, and
- the Phase 3 adaptive-placement gate and its mismatch/fallback telemetry under
  a realistic split-process setup.

For an adaptive-placement canary, enable the gate for a named client allowlist
only and capture telemetry evidence as described in
[`phase-4-telemetry-validation.md`](./phase-4-telemetry-validation.md):

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=true \
MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST=canary-client \
docker compose -f validation/adaptive-placement/compose.yaml up
```

Single-host (`file`) and local self-contained (`memory`) deployments are
**not** suitable for a canary that needs to make horizontal or HA claims,
because neither shares session state across gateway processes.

## Related

- [Standalone gateway packaging](./standalone-gateway.md)
- [Phase 4 telemetry validation](./phase-4-telemetry-validation.md)
- [Mode recovery matrix](./mode-recovery-matrix.md)
