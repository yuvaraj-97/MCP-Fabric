# Phase 3 External Canary Runbook

This runbook is the remaining rollout gate after local Phase 3 evidence is
complete. It validates adaptive placement against a live gateway fleet before
any broader rollout or production claim.

Adaptive placement must remain default-off except for the explicit canary
allowlist used by this runbook.

## Preconditions

- The local evidence ledger in
  [`phase-3-local-evidence.md`](./phase-3-local-evidence.md) is current.
- Phase 2 production gates are green for the target environment.
- The target workload has an explicit state contract:
  - stateless candidates declare replay-safe, read-only, externalized state for
    the request shape being routed;
  - sticky workloads keep explicit `runtimeMode=sticky` or omit adaptive hints.
- Operators can capture `/observability`, `/sessions`, gateway logs, and
  downstream application errors for every gateway process in the fleet.
- Rollback can be applied to every gateway process by setting:

  ```sh
  MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
  ```

## Canary Scope

Use a small internal allowlist:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=true
MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST="canary-client-1,canary-client-2"
```

Do not use an empty allowlist for the first external canary. An empty allowlist
means all new clients are eligible when the operator gate is enabled.

## Evidence Directory

Create one directory per canary run:

```text
validation-artifacts/phase-3-external-canary/YYYYMMDD-HHMMSS/
```

Store these files:

```text
baseline-observability.json
baseline-sessions.json
baseline-errors.json
canary-observability.json
canary-sessions.json
canary-errors.json
rollback-observability.json
phase-3-external-canary-report.md
```

If the fleet has multiple gateway processes, prefix each snapshot with the
gateway ID, for example `gateway-a-baseline-observability.json`.

The evidence helper can capture `/observability` and `/sessions` snapshots and
write the report template:

Before the canary window, generate a run plan with a stable run ID and
copy-pasteable phase commands:

```sh
MCP_PHASE3_CANARY_RUN_ID=20260601-staging-canary-a \
MCP_PHASE3_CANARY_GATEWAYS=gateway-a=http://127.0.0.1:4400,gateway-b=http://127.0.0.1:4401 \
MCP_PHASE3_CANARY_ENVIRONMENT=staging \
MCP_PHASE3_CANARY_TRAFFIC_WINDOW="2026-06-01T10:00Z/2026-06-01T10:15Z" \
MCP_PHASE3_CANARY_WORKLOADS=filesystem,git,memory \
MCP_PHASE3_CANARY_CLIENT_ALLOWLIST=canary-client-1,canary-client-2 \
MCP_PHASE3_CANARY_BASELINE_DOWNSTREAM_ERROR_RATE=0.001 \
MCP_PHASE3_CANARY_MAX_DOWNSTREAM_ERROR_RATE_DELTA=0 \
npm run validate:adaptive-placement:external-canary:plan
```

The planner writes `phase-3-external-canary-plan.json` and
`phase-3-external-canary-plan.md` into the run evidence directory. It does not
contact gateways or run traffic; it only prepares the operator command sequence.

```sh
MCP_PHASE3_CANARY_PHASE=baseline \
MCP_PHASE3_CANARY_RUN_ID=20260601-staging-canary-a \
MCP_PHASE3_CANARY_GATEWAYS=gateway-a=http://127.0.0.1:4400,gateway-b=http://127.0.0.1:4401 \
MCP_PHASE3_CANARY_ENVIRONMENT=staging \
MCP_PHASE3_CANARY_TRAFFIC_WINDOW="2026-06-01T10:00Z/2026-06-01T10:15Z" \
MCP_PHASE3_CANARY_WORKLOADS=filesystem,git,memory \
MCP_PHASE3_CANARY_CLIENT_ALLOWLIST=canary-client-1,canary-client-2 \
MCP_PHASE3_CANARY_DOWNSTREAM_ERRORS=gateway-a=./gateway-a-baseline-errors.json,gateway-b=./gateway-b-baseline-errors.json \
MCP_PHASE3_CANARY_BASELINE_DOWNSTREAM_ERROR_RATE=0.001 \
MCP_PHASE3_CANARY_MAX_DOWNSTREAM_ERROR_RATE_DELTA=0 \
npm run validate:adaptive-placement:external-canary:evidence
```

Use `MCP_PHASE3_CANARY_PHASE=canary` during the adaptive window and
`MCP_PHASE3_CANARY_PHASE=rollback` after rollback. Use the same
`MCP_PHASE3_CANARY_RUN_ID` for baseline, canary, and rollback captures so the
evidence lands in one run directory. Set `MCP_PHASE3_CANARY_CLIENT_ALLOWLIST` to
the same client IDs configured in
`MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST`; this lets the helper flag
captured adaptive sessions outside the canary scope. Override the output root
with `MCP_PHASE3_CANARY_OUTPUT_DIR`; it defaults to
`validation-artifacts/phase-3-external-canary`.

Set `MCP_PHASE3_CANARY_DOWNSTREAM_ERRORS` to comma-separated JSON evidence
files using `gateway-id=path` entries. Each JSON file should include either
`errorRate` or request/error counts such as `totalRequests` and `totalErrors`.
During the canary phase, set
`MCP_PHASE3_CANARY_BASELINE_DOWNSTREAM_ERROR_RATE` to the accepted Phase 2
baseline and keep `MCP_PHASE3_CANARY_MAX_DOWNSTREAM_ERROR_RATE_DELTA=0` unless
the environment has an explicitly approved tolerance.

After baseline, canary, and rollback captures are complete, verify the evidence
directory:

```sh
MCP_PHASE3_CANARY_EVIDENCE_DIR=validation-artifacts/phase-3-external-canary/20260601-staging-canary-a \
MCP_PHASE3_CANARY_VERIFY_GATEWAYS=gateway-a,gateway-b \
npm run validate:adaptive-placement:external-canary:verify
```

After the operator and reviewer have filled in the final report approval fields
and set `Result: PASS`, run the verifier with manual approval required:

```sh
MCP_PHASE3_CANARY_EVIDENCE_DIR=validation-artifacts/phase-3-external-canary/20260601-staging-canary-a \
MCP_PHASE3_CANARY_VERIFY_GATEWAYS=gateway-a,gateway-b \
MCP_PHASE3_CANARY_REQUIRE_MANUAL_APPROVAL=true \
npm run validate:adaptive-placement:external-canary:verify
```

## Step 1: Baseline

Run with adaptive placement disabled:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

Capture at least one representative traffic window before the canary.

For every gateway, save:

- `GET /observability`;
- `GET /sessions`;
- downstream application error counts for the same window.

Baseline pass criteria:

- `operatorConfig.adaptivePlacementEnabled === false`;
- `summary.totalAdaptivePlacements === 0`;
- `summary.totalAdaptivePlacementDrifts === 0`;
- `summary.totalAdaptivePlacementMismatches === 0`;
- no `adaptive.placement.*` events appear in `recentEvents`;
- downstream error rate is acceptable for the environment.

## Step 2: Enable Canary

Enable adaptive placement only for the internal canary allowlist.

Send representative canary traffic for filesystem, git, and memory validation
targets, or the equivalent real workloads with declared externalized state.

For every gateway, save:

- `GET /observability`;
- `GET /sessions`;
- downstream application error counts for the same window;
- any gateway logs containing `adaptive.placement.*` events.

## Step 3: Pass/Fail Criteria

The canary passes only if all criteria hold:

- `operatorConfig.adaptivePlacementEnabled === true`;
- `operatorConfig.adaptivePlacementClientAllowlistSize > 0`;
- `summary.totalAdaptivePlacements > 0`;
- `summary.totalAdaptivePlacementMismatches === 0`;
- no `adaptive.placement.fallback` event has
  `runtimeModeSource=invalid-classifier-recommendation`;
- fallback events are explained only by expected sources:
  - `canary-not-allowed`;
  - `explicit`;
  - `existing-session`;
  - `phase-2-default` when sampling a gateway outside the canary;
- `summary.totalAdaptivePlacementStateless` and
  `summary.totalAdaptivePlacementSticky` increase only for allowlisted canary
  clients;
- `/sessions` records for canary clients preserve the expected
  `metadata.runtimeMode` and `metadata.runtimeModeSource`;
- downstream application error rate does not increase versus the Phase 2
  baseline;
- no registry outage, rehydration failure, or rejected-request counter increases
  unexpectedly during the canary window.

## Rollback Triggers

Rollback immediately if any of these occur:

- `summary.totalAdaptivePlacementMismatches > 0`;
- an invalid-classifier fallback appears;
- canary traffic causes downstream application error rate to rise above the
  Phase 2 baseline;
- non-allowlisted clients receive `runtimeModeSource=adaptive-classifier`;
- sticky workloads lose expected affinity without an application-owned restore
  path;
- gateway registry, reconnect, or rehydration errors increase unexpectedly.

Rollback command:

```sh
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED=false
```

After rollback, capture `rollback-observability.json` and verify:

- `operatorConfig.adaptivePlacementEnabled === false`;
- new sessions return to Phase 2 routing behavior;
- existing sessions keep their stored mode until expiry or reinitialization.

## Report Template

Save this as `phase-3-external-canary-report.md` in the evidence directory.

```markdown
# Phase 3 External Canary Report

Date:
Environment:
Gateway count:
Canary client allowlist:
Traffic window:
Workloads covered:
Baseline downstream error rate:
Allowed downstream error-rate delta:

## Baseline

- Adaptive placement enabled: false
- Total requests:
- Total errors:
- Total adaptive placements: 0
- Total adaptive mismatches: 0
- Downstream error rate:

Evidence files:
- baseline-observability.json
- baseline-sessions.json
- baseline-errors.json

## Canary

- Adaptive placement enabled: true
- Allowlist size:
- Total requests:
- Total adaptive placements:
- Total adaptive stateless:
- Total adaptive sticky:
- Total adaptive fallbacks:
- Total adaptive mismatches:
- Downstream error rate:

Expected fallback sources observed:
- canary-not-allowed:
- explicit:
- existing-session:
- phase-2-default:

Unexpected fallback sources observed:
- invalid-classifier-recommendation:
- other:

Downstream error evidence:
- Gateway:
- Requests:
- Errors:
- Error rate:
- Threshold comparison:

Evidence files:
- canary-observability.json
- canary-sessions.json
- canary-errors.json

## Decision

Machine checks: PASS | REVIEW_REQUIRED
Result: MANUAL_DECISION_REQUIRED | PASS | FAIL | ROLLED BACK

Reason:

Rollback performed: yes | no
Rollback evidence file:

Operator approval:
Reviewer approval:
```

## Completion

The external Phase 3 rollout gate is ready to close only when this report
records `PASS`. A failed or rolled-back canary should create a follow-up issue
with the captured evidence and keep adaptive placement limited to local
validation or a smaller canary allowlist.
