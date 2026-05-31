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

## Canary Client Controls

Adaptive placement can be gradually rolled out to a subset of clients using the
`adaptivePlacementClientAllowlist` configuration.

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST="client-a,client-b,client-c"
```

When the allowlist is empty (default), adaptive placement applies to all new
sessions if `adaptivePlacementEnabled` is true.

When the allowlist is non-empty, adaptive placement applies only to clients
whose `clientId` is in the allowlist. Clients not in the allowlist use Phase 2
routing (sticky default). The observability field `runtimeModeSource` shows
`canary-not-allowed` for requests from non-allowlisted clients.
Client IDs are matched exactly after trimming allowlist entries; client-provided
IDs are not lowercased or otherwise normalized.

For in-process controllers:

```javascript
controller.setAdaptivePlacementClientAllowlist(["client-a", "client-b"]);
```

The in-process setters update only the local gateway process. In a horizontally
scaled deployment, rollbacks and canary changes should be applied through the
operator-managed environment or deployment configuration for every gateway
instance.

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

## Runtime Mode Source

Every response includes `runtimeModeSource` in the `adaptivePlacement` object.
Every session lifecycle record stores the original source that created or last
explicitly changed the session mode. Operators can use these fields to
understand routing decisions:

- `explicit`: The client provided an explicit `runtimeMode` override.
- `existing-session`: The session already existed with a stored mode; the mode
  did not flip. Session metadata preserves the original stored source.
- `adaptive-classifier`: The classifier recommendation was used for a new
  session.
- `phase-2-default`: Phase 3 is disabled; Phase 2 default (sticky) applies.
- `canary-not-allowed`: The client is not in the adaptive placement allowlist.
- `invalid-classifier-recommendation`: The classifier returned an invalid
  recommendation; Phase 2 default applies.

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
