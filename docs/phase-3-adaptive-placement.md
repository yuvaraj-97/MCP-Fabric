# Phase 3 Adaptive Placement

Phase 3 is a guarded tracer bullet for automatic placement. It lets classifier
recommendations influence routing only when an operator explicitly enables the
gate.

## Operator Gate

Adaptive placement defaults off:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

When the flag is false, gateway routing preserves Phase 2 behavior:

- explicit `runtimeMode` wins;
- existing session metadata wins;
- otherwise the gateway defaults to `sticky`;
- recommendations remain visible diagnostics only.

When the flag is true, classifier recommendations may become the routing mode
for new sessions that do not provide an explicit `runtimeMode`.

When the flag is true, `runtimeRecommendation.phase` reports
`adaptive-placement` to show the gateway is operating with the Phase 3 gate
enabled. Check `runtimeRecommendation.adaptivePlacement.applied` to determine
whether the recommendation was actually used for a specific request.

## Placement Semantics

Phase 3 supports only the implemented `stateless` and `sticky` modes.

| Request shape | Adaptive flag | Routing mode source |
| --- | --- | --- |
| Explicit `runtimeMode` present | any | explicit override |
| Existing session record present | any | existing session metadata |
| New session, no explicit mode | disabled | Phase 2 default, `sticky` |
| New session, no explicit mode | enabled | classifier `recommendedMode` |

The gateway must not flip an existing session from `sticky` to `stateless` or
from `stateless` to `sticky` mid-lifecycle. A changed recommendation on a
follow-up request is observable, but the stored session mode remains the
placement input.

## Observability

Every request still records `runtime.recommendation`. When adaptive placement
actually uses the classifier recommendation for a new session, the gateway also
records `adaptive.placement.applied`.

Operator counters include:

- `summary.totalAdaptivePlacements`;
- `summary.totalAdaptivePlacementDrifts`.

`totalAdaptivePlacementDrifts` increments when the adaptive mode differs from
the Phase 2 routing mode that would have been used with the flag disabled.
The `/observability` response also includes
`operatorConfig.adaptivePlacementEnabled` so operators can confirm the active
flag state.

## Rollback

Rollback is the operator flag:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

For in-process controllers, `setAdaptivePlacementEnabled(false)` restores Phase
2 routing behavior without recreating the controller. Existing sessions keep
their stored mode until they expire or are reinitialized.

## Validation

Required commands for this tracer bullet:

```sh
node --test tests/gateway/operator-config.test.js tests/failover/http-sse-gateway-controller.test.js
```

```sh
npm test
```

Before widening a canary, rerun the Phase 2 production gate validations,
especially Redis-backed multi-gateway, Redis outage, and burst-memory proofs.
