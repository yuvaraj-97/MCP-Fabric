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

- [ ] Full unit and integration test suite is green.
- [ ] Filesystem, git, and memory validations pass through gateway paths.
- [ ] Redis-backed multi-gateway proof passes in an environment with Redis and
      local listener support.
- [ ] Redis outage behavior is tested and documented.
- [ ] Burst session creation is tested for bounded memory behavior.
- [ ] Recommendation drift is visible in `/observability`.
- [ ] Malformed classifier hints are surfaced as diagnostics, not request
      failures.
- [ ] Classifier diagnostic failures preserve routing and are observable.
- [ ] Canary and rollback guidance exists for any future adaptive placement
      flag.
- [ ] No Phase 3 code consumes `recommendedMode` as a routing input.

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
- `npm run check`;
- `npm test` and `npm run check` with 122 passing tests and 2 skipped sandbox-only
  remote-process tests;
- `npm run validate:filesystem`;
- `npm run validate:git`;
- `npm run validate:memory`;
- `npm run validate:filesystem:multicontainer`;
- `npm run validate:git:multicontainer`;
- `npm run validate:memory:multicontainer`.
- `docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client`
  with `crossGatewayReuse`, `secondGatewayReadVisible`, and
  `secondGatewayListVisible` all true.

Still required before production horizontal-gateway claims:

- Redis outage behavior proof;
- burst-load memory behavior proof.
