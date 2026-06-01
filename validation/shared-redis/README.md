# Shared Redis Gateway Proof

This proof validates cross-gateway session continuity using a real Redis-backed
session registry.

It is different from the existing single-gateway multi-container proofs:

- two gateway processes share one Redis session registry key
- one client initializes through gateway A
- the same session continues through gateway B
- both gateways point at the same remote MCP server fleet

## Docker Proof

Run the full topology:

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```

The stack includes:

- `redis`
- `gateway-a`
- `gateway-b`
- `mcp-server-a`
- `mcp-server-b`
- `client`

## Direct Client Proof

You can also run the proof script against an already-running topology:

```sh
MCP_SHARED_REDIS_GATEWAY_A_URL=http://127.0.0.1:4200 \
MCP_SHARED_REDIS_GATEWAY_B_URL=http://127.0.0.1:4201 \
MCP_SHARED_REDIS_SERVER_URLS=fs-a=http://127.0.0.1:4101,fs-b=http://127.0.0.1:4102 \
npm run validate:shared-redis
```

## What It Proves

- the session mapping is stored outside one gateway process
- gateway B can reuse the same session ID created through gateway A
- the reused session keeps the same target MCP server instance
- `/sessions` and `/observability` can be inspected on both gateways

The unit-level shared-registry tests also cover the Phase 3 adaptive placement
case. When gateway A creates an adaptive stateless session, gateway B must read
the stored `runtimeMode` and `runtimeModeSource` from the shared registry. The
follow-up may reassign because the stored mode is stateless, but it must not
turn into a new adaptive fallback or mismatch.

## Useful Endpoints

- gateway A sessions: `http://127.0.0.1:4200/sessions`
- gateway A observability: `http://127.0.0.1:4200/observability`
- gateway B sessions: `http://127.0.0.1:4201/sessions`
- gateway B observability: `http://127.0.0.1:4201/observability`
