# Phase 2 Validation And Production Gates

This document records the validation plan for Phase 2 runtime-classifier
diagnostics and the gates that must pass before any Phase 3 adaptive placement
work begins.

Phase 2 remains recommendation-only:

- classifier output must never change routing;
- explicit `runtimeMode` remains the placement input;
- malformed classifier hints must not fail requests;
- recommendation drift must be observable.

## Required Validation Commands

Run these before claiming Phase 2 validation is complete:

```sh
node --test tests/gateway/runtime-classifier.test.js
```

```sh
node --test tests/failover/http-sse-gateway-controller.test.js tests/failover/http-sse-gateway.test.js
```

```sh
node --test tests/failover/redis-outage.test.js
```

```sh
npm run check
npm test
```

Run the real-workload validation commands where the environment permits local
listeners or containers:

```sh
npm run validate:filesystem
npm run validate:git
npm run validate:memory
```

Remote-process and shared-backend proofs:

```sh
npm run validate:filesystem:multicontainer
npm run validate:git:multicontainer
npm run validate:memory:multicontainer
```

Burst session creation proof:

```sh
npm run validate:burst-memory
```

Shared Redis proof against an already-running topology:

```sh
MCP_SHARED_REDIS_GATEWAY_A_URL=http://127.0.0.1:4200 \
MCP_SHARED_REDIS_GATEWAY_B_URL=http://127.0.0.1:4201 \
MCP_SHARED_REDIS_SERVER_URLS=fs-a=http://127.0.0.1:4101,fs-b=http://127.0.0.1:4102 \
npm run validate:shared-redis
```

Full Docker topology for the shared Redis proof:

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```

In restricted sandboxes, the multi-container proofs may skip or fail because
local listeners or Docker are blocked. In that case, record the blocker and run
the same commands in an environment that permits local ports and containers.

## Recommendation Drift Monitoring

During Phase 2, operators should monitor:

- `runtime.recommendation` events;
- `summary.totalRuntimeRecommendations`;
- `summary.totalRuntimeOverrideWarnings`;
- `runtimeRecommendation.recommendedMode`;
- `runtimeRecommendation.effectiveRuntimeMode`;
- `runtimeRecommendation.explicitOverride`;
- `runtimeRecommendation.confidence`;
- `runtimeRecommendation.signals.invalidHints`.

Alert-worthy conditions:

- sustained high `totalRuntimeOverrideWarnings`;
- repeated `invalid-runtime-hints-ignored` reasons;
- classifier fallback reason `classifier-error-ignored`;
- recommendations for `stateless` on workloads that later require rehydration;
- missing recommendation events on gateway requests.

## Production Gate Checklist

Before Phase 3 adaptive placement can begin:

- [x] Full unit and integration test suite is green.
- [x] Filesystem, git, and memory validations pass through gateway paths.
- [x] Redis-backed multi-gateway proof passes in an environment with Redis and
      local listener support.
- [x] Redis outage behavior is tested and documented.
- [x] Burst session creation is tested for bounded memory behavior.
- [x] Recommendation drift is visible in `/observability`.
- [x] Malformed classifier hints are surfaced as diagnostics, not request
      failures.
- [x] Classifier diagnostic failures preserve routing and are observable.
- [x] Canary and rollback guidance exists for any future adaptive placement
      flag.
- [x] No Phase 3 code consumes `recommendedMode` as a routing input.

## Redis Outage Proof

Redis outage behavior is covered by
`node --test tests/failover/redis-outage.test.js`.

The proof injects a Redis-backed registry failure during an HTTP/SSE
`initialize` request and verifies:

- the HTTP boundary returns a handled JSON error with status `503`;
- the gateway process does not crash or emit an unhandled rejection;
- `/observability` records `request.failed`;
- `summary.totalErrors` increments.

This is intentionally a fail-closed Phase 2 behavior. The gateway does not
silently fall back to memory storage because that would split session affinity
state across gateway processes during a Redis outage.

## Burst Memory Proof

Burst session creation is covered by `npm run validate:burst-memory`.

The proof creates 5,000 gateway sessions with concurrency 100, expires the
sessions by TTL, prunes the registry, and records heap/RSS before, during, and
after the burst. The 2026-05-31 run produced:

- active sessions after burst: `5000`;
- pruned sessions after TTL: `5000`;
- active sessions after prune: `0`;
- peak heap growth: `20901680` bytes;
- retained heap growth after prune and GC: `342384` bytes;
- configured peak heap ceiling: `134217728` bytes;
- configured retained heap ceiling: `50331648` bytes.

The proof uses a minimal stateless application so the measurement isolates
gateway/session-registry churn rather than application-owned session caches.

## Phase 3 Canary And Rollback

Any future adaptive placement implementation must use a separate operator flag
that defaults off, for example `adaptivePlacementEnabled=false`.

Required rollout sequence:

- deploy with recommendation-only behavior still active;
- enable adaptive placement for one non-critical workload or a small client
  allowlist;
- compare `recommendedMode`, `effectiveRuntimeMode`, rehydration events,
  rejected requests, and `totalRuntimeOverrideWarnings`;
- roll back immediately by disabling the adaptive placement flag if rejected
  requests, rehydration failures, or registry errors increase;
- keep explicit `runtimeMode` as an override during the canary.

Rollback must not require a code deploy. Returning the flag to `false` must
restore Phase 2 behavior where `recommendedMode` is observable but not used for
routing.

## Operational Risks

| Risk | Phase 2 control |
| --- | --- |
| Silent classifier errors | Emit `classifier-error-ignored` diagnostics and keep routing unchanged. |
| Misclassification of stateful work as stateless | Recommendations are advisory only; explicit runtime mode still wins. |
| Missing SDK hints | Default recommendation remains conservative and observable. |
| High churn exhausting registry resources | Keep TTLs explicit and run burst-load validation before production claims. |
| Redis instability | Validate shared Redis and outage behavior before horizontal gateway claims. |
| Premature adaptive placement | Keep Phase 3 behind a separate operator flag and gate. |

## Current Status

Implemented:

- recommendation-only classifier for `stateless` and `sticky`;
- structured reasons, scores, confidence, and signals;
- explicit override diagnostics;
- malformed-hint diagnostics;
- worker health/load telemetry diagnostics;
- gateway response and `/observability` integration;
- routing-preservation tests.

Validated in this workspace on 2026-05-31:

- `node --test tests/gateway/runtime-classifier.test.js`;
- `node --test tests/failover/http-sse-gateway-controller.test.js tests/failover/http-sse-gateway.test.js`;
- `node --test tests/failover/redis-outage.test.js`;
- `npm run check`;
- `npm test` and `npm run check` with 124 passing tests and 2 skipped sandbox-only
  remote-process tests;
- `npm run validate:filesystem`;
- `npm run validate:git`;
- `npm run validate:memory`;
- `npm run validate:filesystem:multicontainer`;
- `npm run validate:git:multicontainer`;
- `npm run validate:memory:multicontainer`;
- `docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client`
  with `crossGatewayReuse`, `secondGatewayReadVisible`, and
  `secondGatewayListVisible` all true;
- `npm run validate:burst-memory` with 5,000 sessions, 5,000 TTL-pruned
  records, peak heap growth of `20901680` bytes, and retained heap growth of
  `342384` bytes under the configured ceilings.

No remaining Phase 2 production gates are open. Phase 3 adaptive placement is
still a separate future implementation and must remain behind its own operator
flag.
