# Phase 3 Local Evidence

This ledger records the local evidence for the Phase 3 adaptive-placement tracer
bullet. It does not promote adaptive placement to a production default. The
operator gate remains default-off until an external staging or production-like
canary validates recommendation quality on a live gateway fleet.

Last audited: 2026-06-01.

## Status

Local Phase 3 evidence is complete for the implemented `stateless` and `sticky`
runtime modes.

Stage 5, the adaptive placement gate, is complete locally: the default-off
operator flag, allowlist, explicit override behavior, rollback path,
observability, recovery matrix, and remote-process proofs are in place.

Stage 6 has local telemetry evidence through the load, real-workload,
sustained, remote-process, and shared-Redis validations. It is not closed for
production rollout until the external canary gate below runs against a live
gateway fleet.

The remaining Phase 3 rollout gate is external: run a production-like canary
with real traffic, compare the Phase 2 baseline against adaptive-placement
traffic, and widen the allowlist only while mismatches remain zero and fallback
reasons are explained.

## Local Evidence Matrix

| Gate | Local evidence | Status |
| --- | --- | --- |
| Default-off operator gate | `MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false` remains the default; `npm test` covers disabled Phase 2 routing behavior | Complete |
| Explicit override wins | `npm run validate:adaptive-placement`; `npm test` controller coverage | Complete |
| Canary allowlist | `npm run validate:adaptive-placement`; `node --test tests/validation/adaptive-placement-canary.test.js` | Complete |
| Rollback path | `npm run validate:adaptive-placement`; `node --test tests/validation/adaptive-placement-canary.test.js` | Complete |
| Quality counters and events | `npm run validate:adaptive-placement:load`; `npm run validate:adaptive-placement:sustained` | Complete |
| Real workload classifier evidence | `npm run validate:adaptive-placement:real-workloads`; `npm run validate:adaptive-placement:sustained` | Complete |
| Remote filesystem adaptive placement | `npm run validate:filesystem:multicontainer:adaptive`; Docker filesystem adaptive proof | Complete |
| Remote git adaptive placement | `npm run validate:git:multicontainer:adaptive`; Docker git adaptive proof | Complete |
| Remote memory adaptive placement | `npm run validate:memory:multicontainer:adaptive`; Docker memory adaptive proof | Complete |
| Cross-gateway adaptive metadata | `npm run validate:shared-redis:adaptive`; Docker shared-Redis adaptive proof | Complete |
| Recovery behavior per mode | [`mode-recovery-matrix.md`](./mode-recovery-matrix.md) | Complete |
| Phase 2 regression guard | `npm test`; Phase 2 production-gate commands before widening | Complete locally |

## Evidence Checkpoints

- PR #9: remote filesystem adaptive placement proof.
- PR #10: mode recovery matrix.
- PR #11: shared-Redis adaptive metadata proof.
- PR #12: remote memory adaptive placement proof.
- PR #13: remote git adaptive placement proof.

## External Canary Gate

Before making adaptive placement broader than an internal allowlist:

1. Run the Phase 2 production gates and capture baseline request, error,
   routing, fallback, and memory behavior.
2. Enable adaptive placement only for a small internal canary allowlist.
3. Monitor `/observability` for:
   - `summary.totalAdaptivePlacementMismatches === 0`;
   - no invalid-classifier fallback events;
   - fallback events explained by `canary-not-allowed`, `explicit`, or
     `existing-session`;
   - no increase in downstream application errors versus the Phase 2 baseline.
4. Widen the allowlist only while the mismatch count remains zero and all
   fallback reasons are expected.

## Not Claimed

Phase 3 local evidence does not implement or claim:

- production-default adaptive placement;
- Phase 4 self-optimization;
- hot context migration;
- live state checkpointing;
- fabric-owned provisioning.
