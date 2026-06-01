# Multi-Agent Execution Plan

This document defines how to use Codex, Claude, and Antigravity together when
executing the MCP-Fabric roadmap.

It assumes the planning baseline in
[`adaptive-runtime-fabric-decisions.md`](./adaptive-runtime-fabric-decisions.md):
build the reusable core first, the gateway second, and adaptive runtime-fabric
capabilities later behind explicit gates.

## Agent Roles

Use agents by strength, not by habit.

| Agent | Primary use | Avoid using for |
| --- | --- | --- |
| Codex | Terminal-heavy implementation, tests, debugging, repo edits, integration loops | Broad architecture debates when no code or command work is needed |
| Claude | Architecture review, large refactor critique, SDK/API shape, code review, documentation clarity | Repeated test/debug loops that mostly need shell execution |
| Antigravity (`agy`) | Operational-risk review, reliability critique, failure-mode validation, independent review of hardening plans | Narrow edits where local Codex can make and verify the change faster |

When work is large, split by ownership:

- one agent owns architecture/API review;
- one agent owns operational/failure-mode review;
- one agent owns implementation and local verification;
- the lead agent integrates results, resolves conflicts, commits, and pushes.

## CLI Usage

Preferred non-interactive commands:

```sh
claude -p "<prompt>"
```

```sh
agy -p "<prompt>"
```

`agy` may need to run outside restricted sandboxes because it writes logs under
`~/.gemini/antigravity-cli` and opens a localhost language-server socket.

Keep prompts narrow and include:

- exact files to read;
- exact output format requested;
- whether edits are allowed;
- owned files or modules when edits are allowed;
- whether tests should be run;
- expected handoff summary.

## Provider Limit Policy

Do not spend premium provider quota casually.

Before launching Claude or Antigravity, check whether the task needs their
specific strength. Prefer local Codex and repo evidence for mechanical work.

If a provider reports quota exhaustion, rate limiting, authentication failure,
or repeated API failures:

1. record the failed command and error in the handoff notes;
2. stop retrying that provider for the same task;
3. move the work to the next best option;
4. continue with existing artifacts and local validation where possible.

Fallback order:

1. Codex for implementation and terminal loops;
2. Claude for architecture/API/code-review work;
3. Antigravity for reliability/operations review;
4. existing review reports and local tests when live providers are unavailable.

If all external providers are unavailable, continue with local Codex, tests, and
the committed planning docs. Stop only when local progress is no longer possible
without external provider output.

## Work Intake Template

Use this prompt shape when delegating:

```text
In /home/trader/MCP_Improvement, review or modify only these files:
- <paths>

Goal:
<specific outcome>

Constraints:
- Preserve MCP protocol compatibility.
- Follow docs/adaptive-runtime-fabric-decisions.md.
- Do not implement automatic placement or hot migration unless explicitly asked.
- Do not revert unrelated changes.

Return:
- files changed, if any
- decisions or risks found
- tests run and results
- follow-up work
```

## Execution Stages

### Stage 1: Planning and audit

Lead: Codex.

Use Claude for architecture/API critique when the work affects public contracts.
Use Antigravity for reliability or production-hardening critique.

Deliverables:

- updated planning docs;
- unresolved decisions surfaced before implementation;
- no code changes unless explicitly approved.

Commit checkpoint:

- commit after a coherent planning baseline or ADR-equivalent document lands.

### Stage 2: Explicit runtime-mode metadata

Lead: Codex.

Implement only `stateless` and `sticky` metadata or policy behavior first.
Reserve `soft_sticky`, `pinned`, and `hybrid` as documented future modes unless a
separate decision approves their implementation.

Recommended agent split:

- Claude reviews API naming and override semantics;
- Antigravity reviews failure behavior and observability;
- Codex implements and tests.

Commit checkpoint:

- commit after metadata, routing behavior, tests, and docs land together.

### Stage 3: Recommendation-only classifier

Lead: Codex.

Classifier output must be diagnostic before it becomes routing behavior.

Status: implemented for Phase 2 as `stateless`/`sticky` recommendations with
structured reasons, scores, confidence, and observability events.

Required properties:

- no automatic placement;
- explicit developer/operator override wins;
- recommendation reasons are visible in structured observability;
- recommendation output is covered by tests.

Recommended agent split:

- Claude reviews classifier API and SDK surface;
- Antigravity reviews misclassification and failover risks;
- Codex implements deterministic recommendation behavior.

Commit checkpoint:

- commit after classifier diagnostics, tests, and docs land together.

### Stage 4: Production hardening

Lead: Codex.

Use Antigravity early for reliability review.

Near-term hardening:

- Redis-backed multi-gateway validation;
- bounded logs and queues;
- reconnect and failover behavior;
- startup security audits;
- observability counters and structured events.

Deferred hardening:

- hot context checkpointing;
- live state migration;
- direct infrastructure provisioning.

Commit checkpoint:

- commit each hardening slice with tests and documentation.

### Stage 5: Adaptive placement gate

Lead: Codex, with Claude and Antigravity review.

Status: started as a guarded Phase 3 tracer bullet. Adaptive placement is
implemented behind a default-off operator gate, with canary allowlists,
runtime-mode-source metadata, quality counters, validation, and rollback
guidance. It is not a general production default.

Required gates:

- measured recommendation quality before widening rollout;
- documented mode recovery matrix
  ([`mode-recovery-matrix.md`](./mode-recovery-matrix.md));
- operator flag for adaptive placement;
- rollback path;
- observability showing why placement happened;
- production-like telemetry before Phase 4 self-optimization.

Commit checkpoint:

- commit only after implementation, tests, docs, and rollout guidance are
  aligned.

### Stage 6: Production-like telemetry for Phase 4

Lead: Codex, with Claude for architecture review and Antigravity for
operational-risk review.

Do not start self-optimization until adaptive placement quality has been
measured against real workloads and cross-gateway topologies.

Required gates:

- sustained canary runs for filesystem, git, and memory validation targets;
- mismatch rate remains zero during the canary window;
- fallback reasons remain explainable;
- cross-gateway session reuse is validated with adaptive placement enabled;
- classifier confidence and drift are captured in operator-facing evidence.

## Handoff Format

Every agent handoff should include:

- task assigned;
- files read;
- files changed;
- commands run;
- test results;
- risks or assumptions;
- exact next action recommended.

The lead agent should not merge or commit delegated work until the diff is
reviewed locally.

## Commit and Push Policy

Commit at suitable stages, not after every minor edit.

A suitable stage is a coherent unit where:

- docs and code agree;
- tests relevant to the changed surface have run;
- unrelated worktree changes are left untouched;
- the commit message explains the outcome.

Push after each coherent commit when working on `main` for this project, unless
the user asks to hold changes locally.
