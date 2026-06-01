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

Run the same topology with Phase 3 adaptive placement enabled for the
shared-Redis proof client:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=true \
MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST=shared-redis-adaptive-client \
MCP_SHARED_REDIS_ADAPTIVE_PLACEMENT=1 \
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

For an already-running topology whose gateways were started with adaptive
placement enabled and the `shared-redis-adaptive-client` allowlisted:

```sh
MCP_SHARED_REDIS_GATEWAY_A_URL=http://127.0.0.1:4200 \
MCP_SHARED_REDIS_GATEWAY_B_URL=http://127.0.0.1:4201 \
MCP_SHARED_REDIS_SERVER_URLS=fs-a=http://127.0.0.1:4101,fs-b=http://127.0.0.1:4102 \
npm run validate:shared-redis:adaptive
```

## What It Proves

- the session mapping is stored outside one gateway process.
- gateway B can reuse the same session ID created through gateway A.
- when Phase 3 adaptive placement is enabled:
  - gateway A uses client-provided runtime hints to automatically classify the session as `stateless`.
  - the session is stored in Redis with `runtimeMode=stateless` and `runtimeModeSource=adaptive-classifier`.
  - gateway B preserves the stored `runtimeMode` and `runtimeModeSource` on follow-up requests.
  - because the session is `stateless`, gateway B may dynamically load-balance and route to a different server instance (reassigning/rehydrating without enforcing strict sticky affinity).
  - gateway B records the original source metadata under `existing-session` and does not increment new fallback/mismatch counters.
- `/sessions` and `/observability` can be inspected on both gateways.

## Useful Endpoints

- gateway A sessions: `http://127.0.0.1:4200/sessions`
- gateway A observability: `http://127.0.0.1:4200/observability`
- gateway B sessions: `http://127.0.0.1:4201/sessions`
- gateway B observability: `http://127.0.0.1:4201/observability`
