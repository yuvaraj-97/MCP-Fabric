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
The recovery contract for those modes is documented in
[`mode-recovery-matrix.md`](./mode-recovery-matrix.md). Reserved modes such as
`soft_sticky`, `pinned`, and `hybrid` must not be treated as implemented
operator behavior.

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

## Quality Reporting Counters

Operator counters include:

- `summary.totalAdaptivePlacements`;
- `summary.totalAdaptivePlacementDrifts`;
- `summary.totalAdaptivePlacementStateless` — increments when adaptive placement
  applies the classifier recommendation for a new session with stateless mode;
- `summary.totalAdaptivePlacementSticky` — increments when adaptive placement
  applies the classifier recommendation for a new session with sticky mode;
- `summary.totalAdaptivePlacementFallbacks` — increments when the adaptive gate
  is enabled but placement is not applied due to explicit override, existing
  session, canary-not-allowed, or invalid-classifier-recommendation;
- `summary.totalAdaptivePlacementMismatches` — increments when a request with
  `adaptivePlacement.applied=true` fails during downstream application
  handling, indicating a potential mismatch between the classifier
  recommendation and actual application requirements.

`totalAdaptivePlacementDrifts` increments when the adaptive mode differs from
the Phase 2 routing mode that would have been used with the flag disabled.
The `/observability` response also includes
`operatorConfig.adaptivePlacementEnabled` so operators can confirm the active
flag state.

## Canary Monitoring

Operators monitoring a canary rollout should observe:

- Rising `totalAdaptivePlacementStateless` and `totalAdaptivePlacementSticky`
  as new sessions are routed using recommendations;
- `totalAdaptivePlacementFallbacks` tracking clients and sessions that did not
  receive adaptive placement;
- No increase in `totalAdaptivePlacementMismatches` if the classifier
  recommendations are sound; a rising mismatch counter signals potential
  quality issues requiring investigation or rollback.

Events `adaptive.placement.fallback` are emitted with `source`, `runtimeModeSource`,
`method`, `sessionId`, and `clientId` fields, enabling detailed audit logs for
fallback reasons during canary validation.

## Rollback

Rollback is the operator flag:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

For in-process controllers, `setAdaptivePlacementEnabled(false)` restores Phase
2 routing behavior without recreating the controller. Existing sessions keep
their stored mode until they expire or are reinitialized.

## Canary Validation

The Phase 3 canary validation harness exercises the real gateway/controller
flow. It proves an allowlisted client receives classifier-driven placement, a
non-allowlisted client falls back to Phase 2 sticky routing, an explicit
override wins, and quality counters report zero mismatches.

```sh
npm run validate:adaptive-placement
```

The validation harness:

1. Creates a gateway controller with `adaptivePlacementEnabled: true` and an
   allowlist containing `adaptive-canary-client`.
2. Sends a read-only, replay-safe initialize request from the canary client and
   verifies `runtimeMode=stateless`, `applied=true`, and
   `runtimeModeSource=adaptive-classifier`.
3. Sends the same request shape from a non-allowlisted client and verifies
   Phase 2 sticky fallback with `runtimeModeSource=canary-not-allowed`.
4. Sends an explicit `runtimeMode=sticky` request from the canary client and
   verifies the explicit override wins.
5. Verifies `totalAdaptivePlacementMismatches` remains `0` and fallback events
   are explainable.

## Load Telemetry Validation

The adaptive placement load validation exercises mixed canary, control, and
explicit-override traffic under configurable concurrency:

```sh
npm run validate:adaptive-placement:load
```

By default it creates 5,000 initialize requests with concurrency 100. Override
the defaults with:

```sh
MCP_ADAPTIVE_LOAD_SESSION_COUNT=10000 \
MCP_ADAPTIVE_LOAD_CONCURRENCY=200 \
npm run validate:adaptive-placement:load
```

With `adaptivePlacementEnabled=true`, the proof verifies:

- `totalAdaptivePlacements + totalAdaptivePlacementFallbacks` equals
  `totalInitializations`;
- canary clients with replay-safe/read-only/external-state hints are placed
  statelessly;
- non-allowlisted clients and explicit overrides are counted as fallbacks;
- `totalAdaptivePlacementMismatches` remains `0`;
- recent observability events remain bounded by the observer window;
- peak and retained heap growth remain under configured ceilings.

The default memory ceilings scale with `MCP_ADAPTIVE_LOAD_SESSION_COUNT`. For
unusual environments, override them with:

```sh
MCP_ADAPTIVE_LOAD_MAX_PEAK_HEAP_BYTES=268435456 \
MCP_ADAPTIVE_LOAD_MAX_RETAINED_HEAP_BYTES=67108864 \
npm run validate:adaptive-placement:load
```

## Cross-Gateway Shared Registry Behavior

When adaptive placement stores `runtimeMode=stateless` in a durable registry,
another gateway process must preserve that stored mode and source metadata on
follow-up requests. The follow-up may route to a different healthy instance
because the stored mode is stateless, but session metadata must continue to show
the original `runtimeModeSource=adaptive-classifier`. The second gateway must
not count that follow-up as a new adaptive placement fallback or mismatch.

## Real-Workload Telemetry Validation

The real-workload validation runs the filesystem, git, and memory validation
applications through the adaptive placement gate with an allowlisted client:

```sh
npm run validate:adaptive-placement:real-workloads
```

Each workload sends replay-safe, read-only, external-state hints on
`initialize`, runs one safe tool call, and captures:

- `recommendedMode` and `confidence`;
- whether adaptive placement applied;
- `runtimeModeSource`;
- drift from the Phase 2 sticky default;
- placement, fallback, and mismatch counters.

The proof intentionally backs filesystem, git, and memory with state shared by
both in-process validation server instances. Operators must not copy the
`externalState=true` hint to local filesystem, local git working tree, or
in-memory cache workloads unless that state is actually externalized through a
shared volume, remote API, Redis-like store, or equivalent backing service.

This proof is the first Stage 6 evidence that classifier quality remains
consistent across the existing filesystem, git, and memory real-workload
targets, not only synthetic controller traffic.

## Local Sustained Canary Validation

The local sustained validation keeps one set of in-process filesystem, git, and
memory validation controllers alive, repeats the real-workload proof, and
aggregates quality signals over a configurable canary window:

```sh
npm run validate:adaptive-placement:sustained
```

By default, it runs five iterations. Override the window with:

```sh
MCP_ADAPTIVE_SUSTAINED_ITERATIONS=20 \
MCP_ADAPTIVE_SUSTAINED_DELAY_MS=1000 \
npm run validate:adaptive-placement:sustained
```

For longer or noisier canary windows, operators can tune pass thresholds:

```sh
MCP_ADAPTIVE_SUSTAINED_MAX_FALLBACKS=0 \
MCP_ADAPTIVE_SUSTAINED_MAX_MISMATCHES=0 \
MCP_ADAPTIVE_SUSTAINED_MIN_HIGH_CONFIDENCE_RATIO=1 \
MCP_ADAPTIVE_SUSTAINED_MIN_STATELESS_RATIO=1 \
MCP_ADAPTIVE_SUSTAINED_MIN_DRIFT_RATIO=1 \
MCP_ADAPTIVE_SUSTAINED_MIN_REROUTE_RATIO=1 \
npm run validate:adaptive-placement:sustained
```

The default local report requires every filesystem, git, and memory workload
execution to produce a high-confidence stateless recommendation, apply adaptive
placement, drift from the Phase 2 sticky default, dynamically reroute the
follow-up request, and keep fallback and mismatch counts at zero. This is local
evidence, not a substitute for running an external staging canary against a live
gateway fleet.

### Pre-Canary Baseline

Before enabling Phase 3 in production, establish a baseline with Phase 2:

1. Record `totalRequests` and the absence of any `adaptive.placement.*` events.
2. Confirm all sessions use Phase 2 routing (sticky default).
3. Ensure no observability signals indicate placement drift.

### Canary Thresholds

During a canary rollout, monitor:

- `summary.totalAdaptivePlacementMismatches` remains `0`.
- No `adaptive.placement.fallback` events with
  `runtimeModeSource=invalid-classifier-recommendation`.
- Fallback events are explained by expected sources such as
  `canary-not-allowed`, `explicit`, or `existing-session`.
- Route and downstream application error rates do not increase compared with
  the Phase 2 baseline.
- `summary.totalAdaptivePlacementStateless` and
  `summary.totalAdaptivePlacementSticky` move only for clients in the current
  allowlist.

Any non-zero mismatch count is a rollback trigger until the classifier input,
application behavior, or placement contract is understood.

### Rollback

To rollback Phase 3 adaptive placement:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

Or in-process:

```javascript
controller.setAdaptivePlacementEnabled(false);
```

Existing sessions keep their stored mode until they expire or are
reinitialized. New sessions revert to Phase 2 sticky default.

### Canary Procedure

1. Keep adaptive placement disabled and run the Phase 2 production gates to
   confirm the baseline is healthy.
2. Enable adaptive placement with a small allowlist of internal canary clients:

   ```sh
   MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=true
   MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST="canary-client-1,canary-client-2"
   ```

3. Run `npm run validate:adaptive-placement` before sending production traffic
   through the canary.
4. Run `npm run validate:adaptive-placement:load` before widening the canary to
   a larger internal client set.
5. Monitor `/observability` for the counters listed above.
6. Widen the allowlist only while mismatches remain zero and fallbacks are
   explained by expected sources.

### Full Test Suite

Run the adaptive placement validation harness:

```sh
npm run validate:adaptive-placement
```

Run the canary test suite:

```sh
node --test tests/validation/adaptive-placement-canary.test.js
```

Run the load telemetry proof:

```sh
npm run validate:adaptive-placement:load
```

Run the real-workload telemetry proof:

```sh
npm run validate:adaptive-placement:real-workloads
```

Run the sustained real-workload canary proof:

```sh
npm run validate:adaptive-placement:sustained
```

Run the remote-process filesystem proof with adaptive placement enabled:

```sh
npm run validate:filesystem:multicontainer:adaptive
```

Run the shared-Redis cross-gateway proof with adaptive placement enabled
against an already-running topology:

```sh
npm run validate:shared-redis:adaptive
```

Run the existing unit and integration tests to ensure Phase 3 does not
regress Phase 2 behavior:

```sh
node --test tests/gateway/operator-config.test.js tests/failover/http-sse-gateway-controller.test.js
```

```sh
npm test
```

Before widening a canary, rerun the Phase 2 production gate validations,
especially Redis-backed multi-gateway, Redis outage, and burst-memory proofs.
