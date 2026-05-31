# MCP-Fabric: New Session Context & Working Instructions

You are joining an existing project called MCP-Fabric.

This document describes the long-term direction and audit workflow. The
approved planning baseline for the next phase is recorded in
[`docs/adaptive-runtime-fabric-decisions.md`](./adaptive-runtime-fabric-decisions.md).
The multi-agent execution model for Codex, Claude, and Antigravity is recorded
in [`docs/multi-agent-execution-plan.md`](./multi-agent-execution-plan.md).
Use that decision record to interpret this vision conservatively:

- keep the current gateway and transport infrastructure as the near-term
  foundation;
- implement `stateless` and `sticky` modes first;
- reserve `soft_sticky`, `pinned`, and `hybrid` until their behavior is
  specified and validated;
- do not implement automatic placement, hot migration, or fabric-owned
  application state before the documented rollout gates are met.

Your role is not to immediately start coding. Your first responsibility is to
understand the repository, audit the current architecture, identify gaps
relative to the target vision below, and then help plan and implement changes
incrementally with tests and documentation.

---

# Project Vision

MCP-Fabric is evolving beyond a simple MCP router or scaling layer.

The long-term vision is:

**Adaptive Runtime Fabric for MCP and AI Agents**

The fabric should provide:

- transport abstraction
- runtime orchestration
- execution placement
- state topology management
- lifecycle management
- recovery and resilience
- workload-aware routing

The fabric should support:

1. Stateless execution
2. Stateful execution
3. Hybrid execution

without forcing developers to understand distributed systems concepts.

The fabric should automatically make good runtime decisions whenever possible.

Think:

> Kubernetes for MCP runtimes

rather than:

> MCP load balancer

---

# Core Design Principles

## Principle 1: Runtime-Agnostic

The fabric should not care whether state is:

- local
- external
- hybrid

The fabric manages:

- routing
- placement
- lifecycle
- coordination
- recovery

State strategy is an implementation detail.

---

## Principle 2: Adaptive by Default

Default developer experience:

```python
fabric.run(task)
```

The fabric determines:

- stateless
- sticky
- hybrid

automatically.

Developers may override decisions.

Example:

```python
fabric.run(task, mode="sticky")
```

or

```python
fabric.run(task, mode="stateless")
```

---

## Principle 3: Explicit Override Always Wins

Automatic classification should never remove control.

Developer hints must override adaptive behavior.

Example:

```python
@fabric.stateful()
```

or

```python
@fabric.stateless()
```

must take precedence over inferred behavior.

---

## Principle 4: Progressive Intelligence

The system should evolve in phases.

Phase 1:

- Explicit modes only

Phase 2:

- Adaptive recommendations

Example:

> Detected browser session. Sticky runtime recommended.

Phase 3:

- Automatic adaptive selection

Phase 4:

- Self-optimizing runtime orchestration

Avoid over-automation early.

---

# Runtime Modes

The fabric should support at minimum:

## Stateless

Characteristics:

- replayable
- horizontally scalable
- no affinity
- ephemeral workers
- externalized state

Capabilities:

- load balancing
- retries
- worker replacement
- autoscaling

---

## Soft Sticky

Characteristics:

- prefer same worker
- fallback allowed

Useful for:

- warm caches
- model sessions
- lightweight continuity

---

## Sticky

Characteristics:

- strong affinity
- local runtime state preserved

Useful for:

- IDE agents
- browser automation
- interactive sessions

---

## Pinned

Characteristics:

- cannot migrate
- tied to worker ownership

Useful for:

- active terminals
- live subprocesses
- resource handles

---

## Hybrid

Characteristics:

External State:

- memory
- vectors
- planning graph

Local State:

- browser
- filesystem
- websocket
- subprocesses

Expected to become the dominant mode for advanced agents.

---

# Runtime Classification Vision

The fabric should eventually classify workloads automatically.

Potential signals:

## Streaming

Examples:

- WebSocket
- SSE
- token streaming

Signal:

stateful tendency

---

## Resource Ownership

Examples:

- browser instance
- filesystem sandbox
- subprocess
- terminal
- GPU session

Signal:

sticky/pinned tendency

---

## Execution Duration

Short:

- stateless candidate

Long:

- sticky candidate

---

## Replay Safety

Replay-safe:

- stateless

Replay-unsafe:

- sticky/stateful

---

## External State Availability

If state already exists in:

- Redis
- Postgres
- Temporal
- NATS
- Kafka

then stateless execution becomes easier.

---

## Initialization Cost

Expensive startup:

- browser launch
- sandbox creation
- model warmup

favours runtime affinity.

---

# State Topology Management

This is a major differentiator.

The fabric should eventually manage:

- state placement
- state ownership
- state references
- affinity
- migration rules
- recovery semantics

rather than simply routing requests.

---

# Desired SDK Direction

A Python SDK is planned.

Example aspirations:

```python
@fabric.task()
async def search():
    ...
```

```python
@fabric.adaptive()
async def agent():
    ...
```

```python
@fabric.stateful()
async def browser_agent():
    ...
```

The SDK should feel simple while exposing advanced capabilities when needed.

Developer ergonomics are critical.

---

# Potential Future State Backends

Design with pluggability in mind.

Candidates:

- Redis
- Postgres
- Temporal
- NATS
- Kafka
- in-memory

Do not tightly couple architecture to a single backend.

---

# Potential Future Recovery Semantics

The architecture should eventually support:

- replayable
- resumable
- pinned
- migratable

workloads.

---

# Expectations For This Session

Do NOT immediately refactor code.

Follow this workflow:

## Step 1

Audit the repository.

Produce:

- architecture overview
- module map
- runtime flow map
- dependency map

---

## Step 2

Compare current implementation against the target vision.

Identify:

- strengths
- gaps
- architectural risks
- technical debt

---

## Step 3

Create a prioritized roadmap.

Categorize:

- immediate
- near-term
- long-term

Include effort estimates.

---

## Step 4

Propose architecture changes before implementing.

Explain tradeoffs.

Wait for approval when changes are significant.

---

## Step 5

Implement incrementally.

For every change:

- code
- tests
- docs

must be updated together.

---

## Step 6

Keep architecture documentation current.

Whenever architecture changes:

Update:

- README
- ADRs
- architecture diagrams
- developer docs

---

# Important Constraints

- Prefer simple solutions over clever ones.
- Avoid premature abstraction.
- Avoid unnecessary distributed systems complexity.
- Design for observability.
- Design for future runtime classification.
- Maintain backward compatibility when reasonable.
- Keep the architecture understandable by open-source contributors.

---

# First Task

Perform a complete repository audit.

Deliver:

1. Current architecture summary
2. Major components
3. Runtime lifecycle analysis
4. Existing state management approach
5. Existing routing approach
6. Areas already aligned with the adaptive runtime vision
7. Areas that need redesign
8. Recommended roadmap

Do not start coding until the audit and roadmap are complete.

---

# Additional Architectural Context: Adaptive Runtime Classification Engine

The following guidance should be treated as an extension of the project vision.

---

# Core Principle

Runtime placement decisions should not be binary.

Avoid thinking in terms of:

- stateless
- stateful

Instead think in terms of:

**runtime affinity**

where workloads exist on a continuum.

---

# Runtime Affinity Continuum

The fabric should eventually support:

| Mode | Meaning |
| --- | --- |
| Stateless | Fully replayable, no affinity |
| Soft Sticky | Prefer same worker but migration allowed |
| Sticky | Strong affinity to previous worker |
| Pinned | Cannot migrate while active |
| Hybrid | Combination of externalized state and local runtime state |

The classification system should choose among these affinity levels.

---

# Adaptive Runtime Classification

A long-term goal of MCP-Fabric is to automatically classify workloads and select
an appropriate execution topology.

Developers should not be required to understand distributed systems concepts in
order to obtain reasonable behavior.

The system should make intelligent decisions automatically.

Example:

```python
fabric.run(task)
```

should eventually be sufficient for most workloads.

Explicit overrides must always remain available.

---

# Runtime Classifier

Treat runtime classification as a dedicated subsystem.

Potential architecture:

```text
Request
  -> Runtime Analyzer
  -> Classification Engine
  -> Affinity Decision
  -> Worker Placement
  -> Execution
```

The classifier should produce recommendations or decisions about runtime
affinity.

---

# Workload Signals

The classifier should evaluate observable workload characteristics.

Examples:

## Streaming

Indicators:

- WebSocket
- SSE
- bidirectional transports
- token streaming

Signal:

increase affinity score

---

## Resource Handles

Indicators:

- browser instance
- filesystem sandbox
- subprocess
- terminal session
- GPU context

Signal:

increase affinity score significantly

---

## Runtime Duration

Short-lived request:

reduce affinity score

Long-running execution:

increase affinity score

---

## Replay Safety

Replay-safe execution:

reduce affinity score

Replay-unsafe execution:

increase affinity score

Examples:

Replay-safe:

- search query
- weather lookup
- read-only database query

Replay-unsafe:

- browser clicks
- terminal execution
- payment actions
- external mutations

---

## External State Availability

If state already exists externally:

- Redis
- Postgres
- Temporal
- Kafka
- NATS

then affinity requirements may be reduced.

---

## Initialization Cost

Expensive startup costs should increase affinity.

Examples:

- browser launch
- sandbox creation
- large model warmup
- container preparation

---

# Affinity Scoring Model

The implementation is intentionally flexible.

One possible model:

```python
score = {
    "streaming": True,
    "resource_handles": True,
    "external_memory": False,
    "replay_safe": False,
    "runtime_duration": "long",
}
```

Result:

```python
mode = "sticky"
```

or

```python
mode = "hybrid"
```

depending on scoring.

The exact algorithm is not important initially.

The architecture must allow classifier evolution without major redesign.

---

# Initial Recommendation

Do NOT implement automatic placement immediately.

Use a phased approach.

Phase 1:

- Explicit developer-selected modes

Phase 2:

- Classification analysis only
- Recommendations generated
- No automatic decisions

Example:

> Browser resources detected. Sticky execution recommended.

Phase 3:

- Adaptive placement enabled
- Developer override retained

Phase 4:

- Self-optimizing placement and affinity tuning

---

# SDK Vision

Future SDKs should expose adaptive execution naturally.

Examples:

```python
@fabric.task()
```

```python
@fabric.adaptive()
```

```python
@fabric.stateful()
```

```python
@fabric.pinned()
```

The SDK should hide infrastructure complexity while allowing advanced users to
control placement policies.

---

# Architectural Goal

A major differentiator for MCP-Fabric should be:

**Workload-Aware Runtime Placement**

The fabric should eventually understand:

- what a workload is doing
- what state it owns
- whether it can be replayed
- whether it can migrate
- how much affinity it requires

and select the most appropriate runtime topology automatically.

This capability should be considered a strategic pillar of the platform.
