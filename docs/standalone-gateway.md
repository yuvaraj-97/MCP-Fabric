# Standalone Gateway Packaging

This document describes how to run the MCP-Fabric gateway as an independent,
production-oriented process — separate from the demos, dashboard, and validation
harnesses. It also records what shared-state backends are production-ready today
versus future work.

## What "standalone" means here

The gateway is a single Node process that:

- accepts MCP client traffic over HTTP/SSE,
- makes session placement and routing decisions, and
- routes each request to a backend MCP server (remote over HTTP) or to an
  in-process demo application (self-contained evaluation mode).

It is packaged from the `packages/` tree only and does not bundle backend MCP
servers. The entrypoint is
[`packages/gateway/bin/standalone-gateway.js`](../packages/gateway/bin/standalone-gateway.js),
exposed as:

```sh
npm run start:gateway
```

The entrypoint wires together already-tested modules (`operatorConfigFromEnv`,
`createHttpSseGatewayServer`, `createRemoteHttpApplication`). It introduces no
new routing, runtime-mode, or adaptive-placement behavior.

## Topologies

The same entrypoint supports two topologies, selected by environment:

| Topology | When | Backend |
| --- | --- | --- |
| Self-contained (evaluation) | `REMOTE_BASE_URLS_JSON` unset | In-process demo application servers. Good for local smoke tests and single-host evaluation without standing up MCP servers. |
| Fronting remote MCP servers (production-like) | `REMOTE_BASE_URLS_JSON` set | Routes to remote MCP servers over HTTP. Requires `SERVER_INSTANCES_JSON` to list routable instances. |

When `REMOTE_BASE_URLS_JSON` is set, `SERVER_INSTANCES_JSON` is required; the
entrypoint fails fast otherwise so a misconfigured gateway never silently falls
back to demo applications.

## Quick start

Self-contained (binds the loopback interface; safe by default):

```sh
PORT=3000 HOST=127.0.0.1 npm run start:gateway
# -> {"type":"ready","kind":"standalone-gateway","host":"127.0.0.1","port":3000,"topology":"self-contained-demo"}
curl -s http://127.0.0.1:3000/health | jq .
```

Fronting two remote MCP servers with a shared Redis registry:

```sh
PORT=4400 HOST=0.0.0.0 \
MCP_GATEWAY_ALLOW_PUBLIC_BIND=true \
MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT=false \
MCP_GATEWAY_SESSION_REGISTRY_BACKEND=redis \
REDIS_URL=redis://redis:6379 \
SERVER_INSTANCES_JSON='[{"serverInstanceId":"fs-a","load":0.12,"healthy":true,"acceptingNewSessions":true},{"serverInstanceId":"fs-b","load":0.26,"healthy":true,"acceptingNewSessions":true}]' \
REMOTE_BASE_URLS_JSON='{"fs-a":"http://mcp-server-a:4101","fs-b":"http://mcp-server-b:4102"}' \
npm run start:gateway
```

## Ports

The gateway publishes a single HTTP port (`PORT`, default `3000`). All endpoints
below are served from that one port. There are no other listeners. Backend MCP
servers run on their own ports and are reached by the URLs in
`REMOTE_BASE_URLS_JSON`; the gateway does not open ports on their behalf.

## Configuration (environment variables)

All operator configuration is read by `operatorConfigFromEnv`. Values are
validated at startup; invalid values fail fast.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Gateway HTTP listen port (must be a positive integer) | `3000` |
| `HOST` / `MCP_GATEWAY_HOST` | Bind address | `127.0.0.1` |
| `MCP_GATEWAY_DEFAULT_SERVER_COUNT` | Demo instance count when no instances are supplied | `3` |
| `MCP_GATEWAY_LOAD_THRESHOLD` | Per-instance load ceiling for routing (0–1) | `0.7` |
| `MCP_GATEWAY_AUTOSCALE_THRESHOLD` | Cluster pressure threshold for the autoscaler hook (0–1) | `0.8` |
| `MCP_GATEWAY_SESSION_TTL_MS` | Session record TTL | `300000` |
| `MCP_GATEWAY_RECONNECT_GRACE_MS` | Reconnect grace window | `30000` |
| `MCP_GATEWAY_ON_DISCONNECT` | Disconnect policy: `cancel` or `queue` | `cancel` |
| `MCP_GATEWAY_ALLOW_PUBLIC_BIND` | Allow binding `0.0.0.0`/`::` | `false` |
| `MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT` | Run the self-hijack probe on public bind | `true` |
| `MCP_GATEWAY_SESSION_REGISTRY_BACKEND` | `memory`, `file`, or `redis` | `memory` |
| `MCP_GATEWAY_SESSION_REGISTRY_FILE` | File path when backend is `file` | — |
| `MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY` | Redis hash key for session records | `mcp:gateway:sessions` |
| `MCP_GATEWAY_SESSION_REGISTRY_REDIS_URL` / `REDIS_URL` | Redis connection URL when backend is `redis` | — |
| `MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED` | Enable Phase 3 adaptive placement gate | `false` |
| `MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST` | Comma-separated canary client IDs | empty |
| `SERVER_INSTANCES_JSON` | JSON array of routable backend instances | — |
| `REMOTE_BASE_URLS_JSON` | JSON object mapping `serverInstanceId` -> backend base URL | — |

Each `MCP_GATEWAY_*` knob also accepts its `MCP_OPERATOR_*` alias (see
`operatorConfigFromEnv`).

## Health and observability endpoints

All on the gateway's single HTTP port:

| Method + path | Returns |
| --- | --- |
| `GET /health` | `{ ok, instances, sessions }` — liveness/readiness plus current routing table and session list. Used by the Docker `HEALTHCHECK`. |
| `GET /sessions` | `{ instances, sessions }` — routing table and live session records. |
| `GET /observability` | Operator config snapshot, observer summary counters (including adaptive-placement mismatch/fallback counters), and recent audit events. |
| `POST /instances` | Upsert a backend instance (health, load, accepting-new-sessions). |
| `GET /events?sessionId=...` | SSE event stream for a session. |
| `POST /message` | MCP message ingress (`initialize`, `echo`, `status`, custom methods). |
| `GET /inspector` | Browser inspector page for manual session/SSE testing. |

There is no Prometheus exporter today; `GET /observability` is the structured
counter/event surface. Scraping or forwarding those counters is left to the
operator's monitoring stack.

<a id="security"></a>
## Security posture

The gateway has **no built-in authentication**. The startup security audit
(`runStartupSecurityAudit`) treats a `0.0.0.0`/`::` bind as public and:

1. fails closed unless `MCP_GATEWAY_ALLOW_PUBLIC_BIND=true`, and
2. when enforcement is on, runs a self-hijack probe and refuses to start if an
   unauthenticated request succeeds.

Therefore a publicly reachable gateway must sit behind an authenticating,
TLS-terminating reverse proxy. The container image keeps the secure default so a
naive `docker run` cannot expose an unauthenticated gateway by accident. To run
behind a trusted proxy/private network, set both
`MCP_GATEWAY_ALLOW_PUBLIC_BIND=true` and (because there is no first-party auth
for the probe to detect) `MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT=false`.

## External shared state backends (pointer 4)

Session placement is stored in a session registry chosen by
`MCP_GATEWAY_SESSION_REGISTRY_BACKEND`. The registry is the only shared state the
gateway externalizes; runtime-local application state is **not** owned by the
fabric (see [`mode-recovery-matrix.md`](./mode-recovery-matrix.md)).

| Backend | Status | Use |
| --- | --- | --- |
| `memory` | Production-ready, single-process only | Fast, non-durable. A gateway restart loses placement. Not safe for horizontal (multi-gateway) deployments. |
| `file` | Production-ready, single-host | Durable across restarts on one host. Used by the local dashboard. Not a shared backend across hosts. |
| `redis` | **Production-ready, horizontally shared** | The only backend that lets multiple gateway processes share session affinity. Backed by `ioredis`. Fails closed on outage rather than splitting affinity into local memory. |

What is production-ready **today**:

- Redis-backed shared session registry across multiple gateway processes,
  proven by `npm run validate:shared-redis` and the
  `validation/shared-redis/compose.yaml` two-gateway topology, with fail-closed
  behavior on Redis outage covered by `tests/failover/redis-outage.test.js` and
  `tests/failover/http-sse-shared-registry.test.js`.

What is **future backend work** (not implemented; do not assume):

- Alternative shared stores (e.g. Postgres, DynamoDB, Cloud Memorystore beyond
  the generic Redis URL), Redis Cluster/Sentinel topology awareness, at-rest
  encryption of session metadata, and registry-level multi-region replication.
- Fabric-owned hydration of runtime-local application state. The registry stores
  placement/affinity metadata only; it does not checkpoint or restore
  application state. See [`runtime-fabric-roadmap.md`](./runtime-fabric-roadmap.md).

The minimal production-ready shared-state slice (Redis registry) already exists,
so no new backend is added here.

## Related

- [Deployment alternatives](./deployment-guide.md)
- [Mode recovery matrix](./mode-recovery-matrix.md)
- [Advanced runtime-fabric roadmap](./runtime-fabric-roadmap.md)
