# Phase 4 Telemetry Validation

Phase 4 self-optimization remains deferred. The active next phase is
production-like telemetry validation: prove that adaptive placement quality is
stable enough to justify any future self-optimizing placement or affinity
tuning.

This document is the Stage 6 handoff from
[`multi-agent-execution-plan.md`](./multi-agent-execution-plan.md). It converts
the Phase 3 local and staging evidence into concrete Phase 4 readiness gates.

## Scope

This phase measures adaptive placement quality. It does not widen adaptive
placement by default and does not introduce new runtime modes.

In scope:

- sustained canary runs for filesystem, git, and memory validation targets;
- cross-gateway session reuse with adaptive placement enabled;
- classifier confidence, recommendation drift, fallback reasons, and mismatch
  rate captured as operator-facing evidence;
- explicit go/no-go criteria for future self-optimization work.

Out of scope:

- self-optimizing placement or automatic affinity tuning;
- `soft_sticky`, `pinned`, or `hybrid` runtime mode implementation;
- hot context migration, live checkpointing, or fabric-owned state hydration;
- direct infrastructure provisioning.

## Evidence Inputs

Use these evidence sources as the minimum Phase 4 telemetry baseline:

| Evidence source | Command or artifact | Required signal |
| --- | --- | --- |
| Sustained local adaptive canary | `npm run validate:adaptive-placement:sustained` | filesystem, git, and memory recommendations stay high-confidence with zero mismatches |
| Load and memory pressure | `npm run validate:adaptive-placement:load` | adaptive telemetry remains bounded under session churn |
| Real workload classifier proof | `npm run validate:adaptive-placement:real-workloads` | filesystem, git, and memory stay replay-safe under declared external state |
| Remote filesystem adaptive proof | `npm run validate:filesystem:multicontainer:adaptive` | remote-process adaptive placement preserves filesystem behavior |
| Remote git adaptive proof | `npm run validate:git:multicontainer:adaptive` | remote-process adaptive placement preserves git behavior |
| Remote memory adaptive proof | `npm run validate:memory:multicontainer:adaptive` | remote-process adaptive placement preserves shared memory behavior |
| Cross-gateway Redis proof | `npm run validate:shared-redis:adaptive` | adaptive session metadata survives across gateway processes |
| External staging canary | `validation-artifacts/phase-3-external-canary/20260610-150232-staging` | Docker-backed gateway baseline, canary, rollback, and final verifier pass |

The `validation-artifacts/` directory is intentionally ignored by git. When
evidence must be reviewed outside the local machine, summarize it in a GitHub
issue or attach the artifact bundle through the release or CI system in use.

## Quality Gates

All gates below must pass before Phase 4 self-optimization can start:

| Gate | Required threshold | Evidence |
| --- | --- | --- |
| Mismatch rate | `summary.totalAdaptivePlacementMismatches === 0` across every gateway and phase | sustained, remote, Redis, and external canary reports |
| Fallback explainability | fallback sources are only expected values: `canary-not-allowed`, `explicit`, `existing-session`, or `phase-2-default` | `/observability` snapshots and evidence summaries |
| Invalid classifier fallback | zero `runtimeModeSource=invalid-classifier-recommendation` events | `/observability.recentEvents` |
| Downstream error delta | no increase above the accepted Phase 2 baseline | external canary downstream error JSON |
| Confidence quality | high-confidence recommendation ratio stays at or above the sustained harness threshold | sustained validation report |
| Drift visibility | every adaptive drift from Phase 2 sticky default is counted and explainable | `totalAdaptivePlacementDrifts` and applied placement events |
| Cross-gateway reuse | adaptive metadata is visible through the shared Redis-backed session registry | shared-Redis adaptive proof |
| Telemetry overhead | retained heap growth stays within the configured load validation ceiling | load validation report |

For local validation, keep the default strict thresholds used by the existing
harnesses. For longer production-like runs, operators may set explicit ceilings:

```sh
MCP_ADAPTIVE_SUSTAINED_MAX_FALLBACKS=0
MCP_ADAPTIVE_SUSTAINED_MAX_MISMATCHES=0
MCP_ADAPTIVE_SUSTAINED_MIN_HIGH_CONFIDENCE_RATIO=1
MCP_ADAPTIVE_LOAD_MAX_RETAINED_HEAP_BYTES=5242880
```

The retained heap ceiling above is a conservative local default: no more than
5 MiB retained growth for the configured load run. Raise it only with an
environment-specific approval and an accompanying reason.

## Recommended Validation Sequence

Run fast local evidence first:

```sh
npm run validate:adaptive-placement
npm run validate:adaptive-placement:real-workloads
npm run validate:adaptive-placement:sustained
```

Run load and memory evidence:

```sh
MCP_ADAPTIVE_LOAD_MAX_RETAINED_HEAP_BYTES=5242880 \
npm run validate:adaptive-placement:load
```

Run remote-process workload evidence:

```sh
npm run validate:filesystem:multicontainer:adaptive
npm run validate:git:multicontainer:adaptive
MCP_MEMORY_MULTICONTAINER_STORE_FILE=/tmp/mcp-fabric-memory-phase4/memory-store.json \
npm run validate:memory:multicontainer:adaptive
```

Run cross-gateway metadata evidence:

```sh
npm run validate:shared-redis:adaptive
```

Build an operator-facing quality summary from any captured external canary
evidence directory:

```sh
MCP_PHASE4_TELEMETRY_EVIDENCE_DIR=validation-artifacts/phase-3-external-canary/20260610-150232-staging \
npm run validate:adaptive-placement:telemetry-summary
```

The summary exits non-zero unless mismatch count is zero, invalid-classifier
fallback count is zero, all fallback sources are explainable, downstream error
evidence does not exceed its captured baseline plus delta, and retained heap
evidence does not exceed its captured ceiling. Additional JSON reports can be
supplied with `MCP_PHASE4_TELEMETRY_INPUTS` as a comma-separated file or
directory list.

To require a minimum high-confidence recommendation ratio, set:

```sh
MCP_PHASE4_TELEMETRY_MIN_HIGH_CONFIDENCE_RATIO=1
```

### Durable evidence capture

The telemetry summary is captured durably in addition to being printed. Each
run writes a self-describing record to
`validation-artifacts/phase-4-telemetry/<run-id>/telemetry-summary.json`
(`schemaVersion`, `runId`, `capturedAt`, and the full `summary`). Standard
output stays pure summary JSON for downstream parsers; the written path is
reported on standard error. Because `validation-artifacts/` is git-ignored,
captured runs never pollute the tracked worktree, and CI must publish the run
directory as a build artifact when evidence needs to leave the machine.

| Variable | Effect | Default |
| --- | --- | --- |
| `MCP_PHASE4_TELEMETRY_RUN_ID` | Names the run directory | generated `YYYYMMDD-HHMMSS` (UTC) |
| `MCP_PHASE4_TELEMETRY_OUTPUT_DIR` | Base directory for captured runs | `validation-artifacts/phase-4-telemetry` |
| `MCP_PHASE4_TELEMETRY_PERSIST` | Set to `0`/`false`/`no`/`off` to skip capture | capture enabled |

```sh
MCP_PHASE4_TELEMETRY_EVIDENCE_DIR=validation-artifacts/phase-3-external-canary/20260610-150232-staging \
MCP_PHASE4_TELEMETRY_RUN_ID=20260610-150232-staging \
npm run validate:adaptive-placement:telemetry-summary
```

### Compose host ports

The Phase 4 telemetry workflow consumes captured JSON evidence; it does not
drive the adaptive-placement Docker topology directly. In
`validation/adaptive-placement/compose.yaml`, only the gateways publish host
ports (4400/4401). The internal `mcp-server-a`/`mcp-server-b` MCP servers are
reached over the Docker network by service name (`http://mcp-server-a:4101`),
matching the `validation/shared-redis` and `validation/multicontainer` compose
files, so they intentionally do **not** publish host ports 4101/4102. Do not
re-add those mappings without a documented host-side consumer.

In Docker-capable environments, run the shared-Redis Docker topology before
making horizontal gateway claims:

```sh
docker compose -f validation/shared-redis/compose.yaml up --abort-on-container-exit client
```

For an external staging canary, follow
[`phase-3-external-canary-runbook.md`](./phase-3-external-canary-runbook.md)
and verify the final report with:

```sh
MCP_PHASE3_CANARY_REQUIRE_MANUAL_APPROVAL=true \
npm run validate:adaptive-placement:external-canary:verify
```

## Rollback Rules

Keep the Phase 3 operator gate as the rollback control:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

Rollback immediately if any of these occur:

- adaptive placement mismatch count is greater than zero;
- invalid-classifier fallback appears;
- downstream error rate rises above the Phase 2 baseline plus approved delta;
- non-allowlisted clients receive `runtimeModeSource=adaptive-classifier`;
- Redis registry failures or rehydration failures increase unexpectedly;
- load validation shows retained heap growth above the configured ceiling.

## Phase 4 Entry Criteria

Phase 4 self-optimization can be planned only after:

1. All commands in the recommended validation sequence pass.
2. At least one external staging canary has `Result: PASS` and final approval
   verification passes.
3. The validation summary records zero mismatches, zero invalid-classifier
   fallbacks, and no downstream error regression.
4. The proposed self-optimization behavior has a separate design review that
   explains its rollback path and how explicit overrides continue to win. That
   design review is maintained in
   [`phase-4-self-optimization-rfc.md`](./phase-4-self-optimization-rfc.md).

Until those criteria are met, adaptive placement remains a guarded Phase 3
capability and Phase 4 work remains telemetry-only.
