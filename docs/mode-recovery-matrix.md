# Mode Recovery Matrix

This document records the current recovery contract for MCP-Fabric runtime
modes. It is a Phase 3 rollout gate: adaptive placement must not be widened
until operators can distinguish the behavior that is implemented today from
reserved future runtime-fabric behavior.

The only implemented runtime modes are `stateless` and `sticky`.
`soft_sticky`, `pinned`, and `hybrid` remain reserved names until their
operational behavior is specified, implemented, and validated.

## Implemented Modes

| Mode | Current status | Placement contract | State contract |
| --- | --- | --- | --- |
| `stateless` | Implemented | Requests may route to any healthy instance. Existing session metadata can store `runtimeMode=stateless`, but it does not require affinity to the original instance. | Work must be replay-safe for the request shape being routed and must not depend on runtime-local state surviving across requests. Required state must be externalized or derivable from the request. |
| `sticky` | Implemented | New sessions are assigned to a healthy instance. Follow-up requests return to that instance while it remains healthy and available. | Runtime-local continuity may exist only while the assigned instance remains available. Clients must be prepared to reconnect or reinitialize when affinity cannot be preserved. |

## Recovery Behavior

| Failure or lifecycle event | `stateless` behavior | `sticky` behavior |
| --- | --- | --- |
| Backend instance becomes unhealthy or stops accepting sessions | The gateway may route the next request to another healthy instance. The workload must tolerate this because no runtime-local state is guaranteed. | The gateway reassigns only when the stored instance is unhealthy or unavailable. Any local runtime state on the original instance is lost unless the application owns an external restore path. |
| Gateway process restart with durable registry | A stored `stateless` session mode and source can be recovered from the registry. Follow-up requests may still use any healthy instance. | Stored affinity can be recovered if the registry is durable and the original instance is still healthy. If the assigned instance is gone, the client must reconnect or reinitialize against a new assignment. |
| Gateway process restart without durable registry | Session placement metadata is lost. The next request is treated as a new routing decision. | Session affinity metadata is lost. The next request cannot rely on previous runtime-local state and should reinitialize. |
| Redis or durable registry outage | The gateway fails closed for registry-backed session state rather than silently splitting affinity into local memory. | Same fail-closed behavior. Silent memory fallback is not allowed because it could split sticky ownership across gateway processes. |
| Client disconnect within reconnect grace window | If registry metadata remains available, the session mode can be preserved, but no worker affinity is required. | The gateway can reconnect to the stored assignment while the grace window is valid and the instance remains healthy. Queued disconnect handling follows the configured disconnect policy. |
| Reconnect after grace window or session TTL expiry | The session must be initialized again. The classifier or explicit mode chooses a new placement for the new session. | The session must be initialized again. Previous affinity and runtime-local state are not part of the fabric contract after expiry. |
| Automatic retry or reassignment | Safe only when the request is replay-safe and state requirements are externalized or request-derived. | Do not treat retry on a different instance as preserving local state. Side-effecting or local-stateful requests should use explicit `sticky` mode and application-level recovery. |
| State hydration | Fabric does not hydrate local runtime state. Stateless work supplies or externalizes the state it needs. | Fabric preserves routing affinity while possible, but restore or rehydration remains application-owned. |

## Adaptive Placement Implications

Phase 3 adaptive placement may use the classifier recommendation only for new
sessions without an explicit `runtimeMode`, and only when the operator gate and
client allowlist permit it. Explicit overrides still win, and existing sessions
keep their stored mode.

During a canary, a request classified into `stateless` that later fails because
it actually required runtime-local state is a placement-quality failure. It must
be treated as an adaptive placement mismatch and a rollback signal until the
classifier hints, application state contract, or workload declaration is fixed.

Operators should monitor:

- `summary.totalAdaptivePlacementMismatches`;
- fallback events and their `runtimeModeSource`;
- downstream application error rates compared with the Phase 2 baseline;
- whether `runtimeModeSource=adaptive-classifier` appears only for expected
  canary clients.

## Reserved Future Modes

| Mode | Status | Recovery behavior that remains unspecified |
| --- | --- | --- |
| `soft_sticky` | Reserved | Preference strength, fallback timing, and hydration requirements are not implemented. Operators must not assume silent fallback is safe until this mode has a documented contract and tests. |
| `pinned` | Reserved | Ownership, failure behavior, and no-retry semantics are not implemented. Operators must not use MCP-Fabric as if it can pin live terminals, subprocesses, browser sessions, or GPU contexts today. |
| `hybrid` | Reserved | External state references, local restore hooks, partial rehydration, and migration limits are not implemented. Application-managed restore contracts are required before this mode can be claimed. |

The fabric does not currently implement hot context checkpointing, live state
migration, automatic runtime-local state rehydration, or self-optimizing
placement.

### Pre-Implementation Requirements (design note / TODO)

`soft_sticky`, `pinned`, and `hybrid` remain **reserved** as of this revision.
`normalizeRuntimeMode` accepts only `stateless` and `sticky`; any other value is
rejected with a client error, and that guard must stay until a reserved mode has
a complete, tested contract. This section is a TODO, not an implementation plan:
it records what must be specified *before* any of these modes is implemented. Do
not implement these modes from this document.

Before **any** reserved mode is implemented, the following must be specified and
test-covered (these are common to all three):

- A written placement contract (when affinity is created, preserved, and broken)
  and the corresponding rows added to the Recovery Behavior table above.
- Explicit failure semantics on instance loss, registry outage, reconnect grace
  expiry, and TTL expiry — including whether the gateway may retry on another
  instance and what the client must do.
- How explicit overrides and existing stored modes interact with the new mode,
  and a migration/rollback path that keeps `stateless`/`sticky` behavior intact.
- Adaptive-placement eligibility: whether the classifier may ever select the
  mode, or whether it is explicit-only.

Per-mode open questions that must be answered first:

| Mode | Must be specified before implementation |
| --- | --- |
| `soft_sticky` | Preference strength vs `sticky`; the exact condition and timing that triggers fallback to another instance; whether any state hydration is promised on fallback (and who owns it); how a client learns its affinity was downgraded. |
| `pinned` | Ownership model and lifetime of the pinned resource (terminal, subprocess, browser, GPU context); behavior when the pinned instance dies (hard fail vs. error contract); the no-retry guarantee and how it is enforced; capacity/back-pressure when no instance can accept a new pin. |
| `hybrid` | The external-state reference format; the application-owned restore/hydration hook contract; partial-rehydration semantics and failure modes; migration limits and when the fabric refuses to migrate. |

Until each row above is answered, specified in this matrix, and backed by tests,
the reserved modes stay rejected at the boundary.

## Validation References

The implemented recovery behavior is covered by the Phase 2 and Phase 3
validation commands:

```sh
npm run validate:filesystem:multicontainer
npm run validate:git:multicontainer
npm run validate:memory:multicontainer
npm run validate:filesystem:multicontainer:adaptive
npm run validate:git:multicontainer:adaptive
npm run validate:memory:multicontainer:adaptive
```

```sh
node --test tests/failover/http-sse-gateway-controller.test.js tests/failover/http-sse-gateway.test.js
node --test tests/failover/redis-outage.test.js
npm test
```

Run the Docker shared-Redis proof in an environment with Docker and local
listener support before making horizontal gateway claims:

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```
