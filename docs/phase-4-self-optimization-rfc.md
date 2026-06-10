# RFC: Phase 4 Self-Optimization for MCP-Fabric

Status: Draft / planning only. **No runtime self-optimization is implemented or
authorized by this document.**

This RFC designs the first increment of Phase 4 self-optimization: letting the
fabric adjust its own placement decisions from observed telemetry instead of
only applying a static classifier recommendation. It builds on the Phase 3
adaptive-placement gate
([`phase-3-adaptive-placement.md`](./phase-3-adaptive-placement.md)) and the
Phase 4 telemetry validation gates
([`phase-4-telemetry-validation.md`](./phase-4-telemetry-validation.md)), and it
honors the planning baseline in
[`adaptive-runtime-fabric-decisions.md`](./adaptive-runtime-fabric-decisions.md).

## Context and Non-Goals

Phase 3 made classifier recommendations *applicable* to routing behind a
default-off operator flag. The classifier recommendation is static per request:
the gateway either applies the recommended mode for a new session or falls back
to Phase 2 sticky routing. The fabric does not learn from outcomes.

Phase 4 self-optimization is the step where the fabric uses accumulated
telemetry (confidence, drift, mismatch, downstream error, and fallback signals)
to *tune its own placement confidence and eligibility* over time, still within
the implemented `stateless` and `sticky` modes.

This RFC deliberately keeps the first increment minimal. It does **not**
introduce new runtime modes, hot context migration, or fabric-owned state
hydration (see [Deferred Scope](#5-deferred-scope)). Decision 4 of the
fabric-decisions baseline still holds: only `stateless` and `sticky` are
implemented modes; `soft_sticky`, `pinned`, and `hybrid` remain reserved names.

## 1. Preconditions Before Self-Optimization Can Be Enabled

Self-optimization may be implemented and gated on only after **all** of the
following are demonstrably true. These extend, and do not replace, the Phase 4
entry criteria already recorded in
[`phase-4-telemetry-validation.md`](./phase-4-telemetry-validation.md#phase-4-entry-criteria).

| # | Precondition | Concrete evidence |
| --- | --- | --- |
| P1 | **Telemetry summary passes repeatedly** | `npm run validate:adaptive-placement:telemetry-summary` exits zero across **N consecutive** captured canary windows (proposed default `N = 5`), each persisted under `validation-artifacts/phase-4-telemetry/<run-id>/telemetry-summary.json`. Repeatability, not a single green run, is the gate. |
| P2 | **Zero placement mismatches** | `summary.totalAdaptivePlacementMismatches === 0` across every gateway, every workload, and every window in the qualifying run set. Any non-zero count voids the precondition and resets the consecutive-pass counter. |
| P3 | **No downstream error regression** | Downstream application error rate stays at or below the Phase 2 baseline plus the approved delta across all qualifying windows (`summary.downstreamErrors` / external canary downstream error JSON). |
| P4 | **High-confidence threshold met** | High-confidence recommendation ratio stays at or above the configured floor (`MCP_PHASE4_TELEMETRY_MIN_HIGH_CONFIDENCE_RATIO`, default `1` locally) across all qualifying windows, with confidence scores recorded per decision. |
| P5 | **Rollback path proven** | A rehearsed rollback exists and has been exercised: toggling the operator flag off restores Phase 2 routing for new sessions with zero mismatches, and the rehearsal is captured as evidence (not merely documented). |

Additional standing gates inherited from Phase 4 telemetry validation that must
also hold: fallback sources are only the explainable set
(`canary-not-allowed`, `explicit`, `existing-session`, `phase-2-default`); zero
`runtimeModeSource=invalid-classifier-recommendation` events; cross-gateway
adaptive metadata reuse is validated; and telemetry overhead stays within the
configured retained-heap ceiling.

If any precondition regresses after self-optimization is enabled, that
regression is itself a rollback trigger (see [Observability](#3-observability)
and [the rollback rules](./phase-4-telemetry-validation.md#rollback-rules)).

## 2. Minimal Safe Algorithm

The first self-optimization increment is intentionally small. It only adjusts
**whether and how confidently** the existing classifier recommendation is
applied for *new sessions without an explicit mode*. It never invents a mode,
never migrates state, and never changes an existing session's stored mode.

### Invariants (must always hold)

1. **Explicit client overrides always win.** A request carrying an explicit
   `runtimeMode` is routed by that mode regardless of any self-optimization
   state. `runtimeModeSource=explicit`. This is unconditional.
2. **No hidden default behavior changes.** With the self-optimization flag off,
   behavior is byte-for-byte Phase 3 adaptive placement (which itself reduces to
   Phase 2 when adaptive placement is off). Turning self-optimization *on*
   without meeting preconditions must not silently alter routing.
3. **Operator flag required.** Self-optimization is gated behind a new,
   default-off operator flag (proposed `MCP_GATEWAY_SELF_OPTIMIZATION_ENABLED`,
   default `false`). It additionally requires the Phase 3
   `MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=true`; self-optimization is a strict
   superset gate and cannot activate while adaptive placement is off.
4. **Canary allowlist first.** Self-optimization applies only to clients on a
   dedicated allowlist (proposed
   `MCP_GATEWAY_SELF_OPTIMIZATION_CLIENT_ALLOWLIST`), reusing the Phase 3
   allowlist matching semantics (exact match after trimming, no normalization).
   Non-allowlisted clients fall back to Phase 3 behavior, with
   `runtimeModeSource` unchanged from its Phase 3 value.
5. **Existing sessions are immutable.** Self-optimization never flips a stored
   session mode mid-lifecycle, consistent with the Phase 3 placement contract.

### Decision flow (per `initialize` request)

```
if explicit runtimeMode present            -> explicit          (override wins)
elif existing session record present        -> existing-session  (stored mode wins)
elif self-optimization disabled             -> Phase 3 adaptive-placement flow
elif client not on self-opt allowlist       -> Phase 3 adaptive-placement flow
elif effective confidence < apply threshold -> sticky fallback   (self-opt-low-confidence)
else                                        -> classifier recommendedMode (self-optimized)
```

The only new behavior versus Phase 3 is the **effective confidence gate**: the
fabric maintains a per-(workload-class, mode) *confidence adjustment* derived
from recent telemetry and uses it to decide whether a recommendation is applied
or downgraded to the safe Phase 2 sticky default.

### Confidence adjustment rule (conservative, bounded, auditable)

- The adjustment is a bounded multiplier/offset on the classifier's reported
  `confidence`, clamped to `[0, 1]`. It can only make the fabric **more**
  conservative than the raw recommendation in this increment — i.e. it can
  *withhold* a recommendation it would otherwise apply, but it must not
  fabricate a stateless placement the classifier did not recommend.
- Inputs are the already-captured telemetry signals only (recent mismatch rate,
  drift rate, downstream error delta, fallback reasons). No opaque introspection
  of payloads (consistent with fabric-decisions §9/§13).
- Any observed mismatch for a workload class drives its effective confidence
  toward the fallback side immediately (fast-decay on bad signal, slow-recovery
  on good signal). A single mismatch cannot be averaged away within a window.
- The adjustment is deterministic given the telemetry inputs and is logged
  (see Observability), so every applied or withheld decision is explainable
  after the fact.

### Safe fallback

Whenever self-optimization withholds a recommendation, the result is the
**Phase 2 sticky default** — never an unproven mode and never a stateless
placement that risks replay. Sticky is the safe direction because it preserves
session affinity. New `runtimeModeSource` value `self-opt-low-confidence` (or
similar) records this case distinctly from Phase 3 fallback reasons so it is
never confused with `invalid-classifier-recommendation`.

## 3. Observability

Every self-optimization decision must be fully reconstructable from telemetry.
This extends the Phase 3 `runtimeModeSource` and counter surface rather than
replacing it.

### Per-decision fields (response + lifecycle record)

- **Placement rationale** — why this mode was chosen: explicit override,
  existing session, classifier recommendation applied, or self-optimized
  withhold. Carried in a `selfOptimization` object alongside the existing
  `adaptivePlacement` object.
- **Confidence score** — both the raw classifier `confidence` and the
  *effective* (adjusted) confidence used for the decision, plus the active
  apply threshold, so the gate decision is verifiable.
- **Fallback reason** — the explicit reason when a recommendation was withheld
  (`self-opt-low-confidence`, `canary-not-allowed`, `explicit`,
  `existing-session`, `phase-2-default`). The reason set is closed; any
  unexpected value is itself an alarm.
- **Drift / error signals** — the telemetry inputs that produced the current
  effective confidence for this workload class (recent mismatch rate, drift
  ratio, downstream error delta), so an operator can see *what the fabric
  learned* and why.

### Aggregate counters (`/observability` `summary`)

Extend the Phase 3 counters with self-optimization-specific tallies:

- `totalSelfOptimizedPlacements` — recommendations applied under
  self-optimization for allowlisted clients.
- `totalSelfOptimizedWithholds` — recommendations downgraded to sticky by the
  confidence gate.
- `totalSelfOptimizationRollbacks` — **rollback counters**: increments each time
  an automatic safety trip or operator action disables self-optimization
  (records cause and timestamp). This counter is the auditable record that the
  rollback path engaged.
- Existing Phase 3 counters remain authoritative and must stay clean:
  `totalAdaptivePlacementMismatches` must remain `0`;
  `runtimeModeSource=invalid-classifier-recommendation` must remain absent.

`operatorConfig` in the `/observability` response must expose
`selfOptimizationEnabled` and the active allowlist so operators can confirm flag
state, mirroring the Phase 3 `adaptivePlacementEnabled` field.

### Events

Emit a `self.optimization.decision` event (mirroring
`adaptive.placement.applied` / `adaptive.placement.fallback`) carrying
`source`, `runtimeModeSource`, raw and effective `confidence`, `method`,
`sessionId`, `clientId`, and the rationale, so canary audit logs reconstruct
every decision. Emit `self.optimization.rollback` when the safety trip fires.

### Automatic safety trip

If `totalAdaptivePlacementMismatches` rises above `0`, an
`invalid-classifier-recommendation` fallback appears, or the downstream error
delta exceeds the approved threshold while self-optimization is active, the
fabric must trip back to Phase 3 behavior (or fully to Phase 2 via the Phase 3
gate), increment `totalSelfOptimizationRollbacks`, and emit the rollback event.
The trip is fail-safe: it reverts to the more conservative path.

## 4. Required Tests Before Implementation

These tests must exist and pass before any self-optimization routing code is
written (TDD), and they live beside the existing adaptive-placement validation
suite under `tests/validation/`.

1. **Override-wins under self-optimization** — explicit `runtimeMode` is honored
   for an allowlisted self-opt client regardless of effective confidence;
   `runtimeModeSource=explicit`.
2. **Flag-off parity** — with `MCP_GATEWAY_SELF_OPTIMIZATION_ENABLED=false`,
   routing, counters, and events are identical to current Phase 3 behavior
   (no hidden default change). A golden/snapshot comparison against the Phase 3
   harness output.
3. **Allowlist gating** — a non-allowlisted client receives Phase 3 behavior;
   an allowlisted client receives the self-optimized decision; sources are
   distinct and correct.
4. **Confidence gate withholds, never fabricates** — below-threshold effective
   confidence downgrades to sticky (`self-opt-low-confidence`); the gate can
   never produce a stateless placement the classifier did not recommend.
5. **Existing-session immutability** — a stored session mode is never flipped by
   self-optimization on a follow-up request, even when the recommendation or
   effective confidence changes.
6. **Mismatch fast-trip** — a single injected mismatch trips the safety
   rollback, increments `totalSelfOptimizationRollbacks`, emits
   `self.optimization.rollback`, and reverts new-session routing to the
   conservative path.
7. **Rollback rehearsal** — toggling the operator flag off restores Phase 2
   routing for new sessions with zero mismatches (proves precondition P5).
8. **Observability completeness** — every decision exposes rationale, raw and
   effective confidence, threshold, and fallback reason; the reason set is
   closed; no `invalid-classifier-recommendation` events occur in the happy
   path.
9. **Cross-gateway metadata** — self-optimized stored modes and source metadata
   survive across gateway processes via the shared registry, and a second
   gateway does not double-count a follow-up as a new placement, fallback, or
   mismatch (extends the Phase 3 shared-Redis proof).
10. **Telemetry-driven determinism** — given a fixed telemetry input set, the
    effective confidence and decision are deterministic and reproducible.
11. **Bounded overhead** — self-optimization state and event volume stay within
    the configured retained-heap and observer-window ceilings under load
    (extends `validate:adaptive-placement:load`).

## 5. Deferred Scope

The following remain explicitly out of scope for this RFC and the first
self-optimization increment, consistent with
[`adaptive-runtime-fabric-decisions.md`](./adaptive-runtime-fabric-decisions.md)
§5–§7 and the Phase 4 telemetry validation out-of-scope list:

- **No hot context migration.** Sessions are never live-migrated between
  runtime instances. Recovery stays explicit and minimal per the mode recovery
  matrix ([`mode-recovery-matrix.md`](./mode-recovery-matrix.md)).
- **No fabric-owned state hydration.** The fabric continues to own only routing
  state (session-to-instance mappings, placement metadata). Application/runtime
  state stays owned by the MCP server or its external backing store. No
  checkpointing, restore, or rehydrate contracts are introduced here.
- **No new `soft_sticky` / `pinned` / `hybrid` modes.** Only the implemented
  `stateless` and `sticky` modes are used. Reserved mode names stay reserved
  until their operational behavior is separately specified and validated.
- **No upward confidence fabrication.** This increment's self-optimization can
  only make placement *more* conservative (withhold), never invent a placement
  the classifier did not recommend.
- **No direct infrastructure provisioning or autoscaling actions.** The fabric
  still only emits health/drain/load signals; external systems own lifecycle.

These deferrals are load-bearing: the minimal algorithm is safe precisely
because it cannot move state or expand the mode vocabulary.

## 6. Recommended Next Implementation Issue

The most recent merged work is Issue #21 (Phase 4 telemetry quality summary), so
the next implementation issue is **#22**.

> **Issue #22 — Phase 4 self-optimization: confidence-gate scaffold (tests +
> default-off flag, no routing change)**
>
> **Goal:** Land the TDD scaffold for self-optimization without changing any
> routing behavior, proving the preconditions are wired and observable.
>
> **Scope:**
> - Add the default-off operator flag `MCP_GATEWAY_SELF_OPTIMIZATION_ENABLED`
>   and `MCP_GATEWAY_SELF_OPTIMIZATION_CLIENT_ALLOWLIST` with in-process setters,
>   surfaced in `/observability` `operatorConfig`.
> - Add the failing tests from [§4](#4-required-tests-before-implementation),
>   starting with **flag-off parity (#2)**, **override-wins (#1)**, and
>   **allowlist gating (#3)**.
> - Add the new counters (`totalSelfOptimizedPlacements`,
>   `totalSelfOptimizedWithholds`, `totalSelfOptimizationRollbacks`) and the
>   `selfOptimization` decision object as **read-only telemetry**, populated only
>   on the no-op path so flag-off parity holds exactly.
> - **Do not** wire the effective-confidence gate into routing yet; the
>   confidence-adjustment rule lands in a follow-up issue once parity and the
>   safety-trip tests are green.
>
> **Acceptance:** flag-off parity test passes byte-for-byte against the Phase 3
> harness; new flags default off; counters and `operatorConfig` fields appear;
> `npm test` and the existing adaptive-placement validation suite stay green.

Rationale: this is the smallest tracer-bullet slice — it makes the flag,
allowlist, observability surface, and parity guarantee real (and testable)
before any decision logic can affect a single route. The confidence gate, the
mismatch fast-trip, and the rollback counter wiring follow as #23+ once #22 has
proven the no-op path is invisible.

## Open Questions

1. How many consecutive passing telemetry windows (`N` in P1) are required, and
   over what wall-clock duration, before self-optimization may be enabled in a
   production-like environment?
2. What are the exact bounds and decay/recovery constants for the
   confidence-adjustment rule, and where are they configured (env vs. operator
   config)?
3. Should the automatic safety trip revert to Phase 3 adaptive placement or all
   the way to Phase 2 sticky? (Default proposed: revert to the most conservative
   path, i.e. Phase 2 sticky for new sessions.)
