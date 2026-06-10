# Adaptive Runtime Fabric Decisions

This document records the approved planning baseline for evolving MCP-Fabric
toward an adaptive runtime fabric.

The intent is to preserve the validated gateway and transport foundation while
leaving a clear path toward workload-aware runtime placement. These decisions
are planning decisions, not a request to implement all runtime-fabric behavior
immediately.

## Decision Summary

1. **Scope**

   MCP-Fabric remains, in the near term, a transport-neutral and session-aware
   MCP infrastructure layer. The adaptive runtime fabric is the north-star
   direction, not an immediate rewrite or a replacement for the current gateway
   foundation.

2. **Naming and documentation**

   Use `MCP-Fabric` as the project name in planning documents. Repository docs
   should distinguish current implemented infrastructure from future adaptive
   runtime-fabric goals.

3. **Build order**

   Continue building the reusable core/library first, then the standalone
   gateway, then adaptive runtime-fabric capabilities on top of those stable
   boundaries.

4. **Runtime modes**

   Commit only `stateless` and `sticky` as implemented near-term runtime modes.
   Reserve `soft_sticky`, `pinned`, and `hybrid` as future mode names until their
   operational behavior is specified and validated.

5. **Mode semantics**

   Initial semantics are intentionally conservative:

   - `stateless`: may retry, reassign, and migrate when replay is safe.
   - `sticky`: routes follow-up requests to the same healthy runtime instance.

   Reserved future semantics:

   - `soft_sticky`: prefer the same runtime, but fallback is allowed.
   - `pinned`: must remain on the owning runtime; loss fails explicitly.
   - `hybrid`: may combine local runtime state with external state, but only
     through declared restore or rehydrate contracts.

6. **State ownership**

   The fabric owns routing state, including session-to-instance mappings and
   placement metadata. Application/runtime state remains owned by the MCP server
   or its external backing store unless a workload explicitly declares state
   references, replay safety, or restore hooks.

7. **Recovery and migration**

   Recovery is explicit and minimal in the next phase:

   - stateless workloads may retry or reassign;
   - sticky workloads reconnect or reinitialize unless external restore is
     declared;
   - hot context migration and live state checkpointing are deferred.

8. **Classifier rollout**

   Runtime classification rolls out in phases:

   - Phase 1: explicit modes only;
   - Phase 2: recommendation-only classifier diagnostics;
   - Phase 3: adaptive placement behind an operator-controlled flag;
   - Phase 4: self-optimization only after production-like telemetry validates
     the recommendation quality.

   Phase 2 is implemented as diagnostics only: recommendations are returned in
   gateway responses and recorded in observability, but they do not alter
   routing behavior while the adaptive placement gate is disabled.

   Phase 3 is implemented as a guarded tracer bullet documented in
   [`phase-3-adaptive-placement.md`](./phase-3-adaptive-placement.md): adaptive
   placement defaults off, explicit overrides win, existing sessions keep their
   stored mode, and only new sessions without an explicit mode may use the
   classifier recommendation as the routing mode.

   Local Phase 3 evidence is tracked in
   [`phase-3-local-evidence.md`](./phase-3-local-evidence.md). Local filesystem,
   git, memory, and shared-Redis proofs are complete for the implemented
   `stateless` and `sticky` modes; external canary telemetry remains required
   before widening rollout or making production claims.

   Phase 4 self-optimization remains deferred until production-like telemetry
   validates adaptive placement quality across real workloads. The active
   preparation work is documented in
   [`phase-4-telemetry-validation.md`](./phase-4-telemetry-validation.md), and
   the (planning-only) self-optimization design is in
   [`phase-4-self-optimization-rfc.md`](./phase-4-self-optimization-rfc.md).

9. **Classifier signal sources**

   Early classification signals should come from explicit metadata and
   observable runtime facts:

   - operator-selected mode;
   - future SDK hints;
   - transport shape;
   - streaming usage;
   - resource handles;
   - runtime duration;
   - replay or restore declarations;
   - worker health and load telemetry.

   Avoid opaque introspection and hidden automatic routing behavior early.

10. **Override semantics**

    Explicit developer or operator overrides win over classifier
    recommendations. Unsafe or suspicious overrides should produce structured
    diagnostics, not silent agreement.

11. **Backend strategy**

    Keep the session registry interface pluggable, with the following maturity
    levels:

    - memory: tests and local development;
    - file: single-node demos and restart proof;
    - Redis: first production session-registry backend.

    Postgres, Temporal, NATS, and Kafka remain future candidates until a concrete
    state or workflow requirement justifies them.

12. **Orchestration boundary and rollout gates**

    External systems own lifecycle and provisioning. MCP-Fabric emits health,
    drain, load, and autoscaler events or hooks, but does not directly provision
    infrastructure in the next phase.

    Before production claims or wider automatic placement, require:

    - Redis-backed multi-gateway validation;
    - reconnect and failover tests;
    - burst-load tests;
    - Redis outage behavior;
    - bounded memory under churn;
    - structured observability for placement decisions;
    - documented recovery behavior per mode, maintained in
      [`mode-recovery-matrix.md`](./mode-recovery-matrix.md);
    - canary and rollback guidance.

## Consequences

- The current gateway, session affinity, load routing, and transport abstraction
  work remains the foundation.
- The project avoids promising Kubernetes-like recovery before workload state
  contracts exist.
- Adaptive behavior remains observable and gated rather than hidden behind early
  automatic placement.
- Documentation and future issues should separate implemented behavior from
  reserved or future runtime-fabric capabilities.
