# Advanced Runtime Fabric Roadmap

This roadmap separates **near-term production-readiness work** (bounded,
specifiable, mostly hardening what already exists) from **long-term research**
(open problems requiring new contracts and proofs). It is a planning document:
nothing here is implemented by its inclusion, and none of it changes current
runtime behavior.

It complements:

- [`mode-recovery-matrix.md`](./mode-recovery-matrix.md) — reserved runtime modes
  and their pre-implementation requirements.
- [`phase-4-self-optimization-rfc.md`](./phase-4-self-optimization-rfc.md) —
  planning-only self-optimization design.
- [`adaptive-runtime-fabric-decisions.md`](./adaptive-runtime-fabric-decisions.md)
  — the decision log this roadmap rolls up.

## Where the fabric is today

Production-ready: stateless/sticky routing, durable session affinity (file and
shared-Redis registries), fail-closed registry-outage behavior, the Phase 3
adaptive-placement gate (off by default, client-allowlisted), and telemetry
capture for placement quality. The fabric stores **placement metadata only**; it
does not own, checkpoint, or restore runtime-local application state.

## Near-term production-readiness work

Bounded work that hardens the current capability set without introducing new
state-ownership or migration semantics. None of it requires a reserved runtime
mode.

| Item | Scope | Done when |
| --- | --- | --- |
| Observability export | Expose `GET /observability` counters in a scrapeable format (e.g. Prometheus text) instead of operator-polled JSON. | An operator can alert on adaptive-placement mismatch/fallback rate without bespoke polling. |
| Registry resilience | Document and test Redis reconnect/backoff behavior and surface registry health on `GET /health`. | Health endpoint distinguishes "registry degraded" from "gateway down"; reconnect is covered by tests. |
| Autoscaling signals (observe-only) | Emit cluster-pressure and per-instance load signals (already computed by the router) as structured telemetry. | External autoscalers can consume the signals; the gateway still takes **no** scaling action itself. |
| Graceful drain | A documented, tested instance-drain path (`acceptingNewSessions=false` + session bleed-off) for rolling deploys. | Rolling a backend instance out causes zero sticky-session errors under the canary harness. |
| Self-optimization telemetry gate | Finish the Phase 4 telemetry validation that must pass before any self-optimization is planned (see the RFC's gate). | The telemetry-quality summary meets the documented thresholds on real-workload evidence. |

These items are incremental and can ship independently behind existing gates.

## Long-term research

Open problems that require new contracts, new state ownership, and dedicated
validation before they can be claimed. Each is currently **not** implemented and
must not be assumed by operators.

| Theme | Problem | Prerequisites |
| --- | --- | --- |
| Hot migration | Move a live session from one instance to another without client-visible reinitialize. | Live state checkpoint/transfer protocol; a `hybrid`/`pinned` contract from the recovery matrix; correctness proof under mid-request migration. |
| Fabric-owned state hydration | Fabric restores runtime-local application state on reassignment instead of leaving it application-owned. | An application state-contract API; durable state store beyond the placement registry; rollback and partial-restore semantics. |
| Autoscaling actuation | Gateway/controller actively scales backend instances from load signals. | The observe-only autoscaling signals above; an actuation interface to the orchestrator; safety limits and anti-flapping; canary proof that actuation does not destabilize placement. |
| Deeper self-optimization | The classifier adapts placement policy from observed outcomes (closed loop). | Passing Phase 4 telemetry gate; the self-optimization RFC's rollback path and explicit-override-wins guarantee; offline evaluation before any closed-loop change reaches routing. |

## Sequencing

1. Land the near-term hardening items behind existing gates (they do not depend
   on reserved modes).
2. Complete the Phase 4 telemetry validation gate.
3. Only then specify a reserved runtime mode (recovery-matrix requirements) and
   the state-ownership contract that hot migration and fabric-owned hydration
   depend on.
4. Treat autoscaling actuation and closed-loop self-optimization as the last,
   research-grade steps — each gated on its own canary evidence.

## Related

- [Standalone gateway packaging](./standalone-gateway.md)
- [Deployment guide](./deployment-guide.md)
- [Phase 4 telemetry validation](./phase-4-telemetry-validation.md)
