# Adaptive Runtime Fabric Audit Plan

## Purpose

This document captures the copied session context for MCP-Fabric and turns it
into a readable architecture brief and audit plan for this repository.

The original source was copied in small chunks from another platform, so this
version removes chat timestamps, repairs formatting, and keeps the plan
structured. No implementation should start from this document alone; it first
calls for a repository audit and roadmap.

## Source Integrity Notes

- The copied source included a separate chat chunk for Step 6. It appears to be
  a continuation of the workflow after Step 5, not a replacement for missing
  steps.
- No explicit `set 1`, `set 2`, `set 3`, or `set 4` markers were present in the
  copied file. If those markers existed in the original platform, they were not
  included in `plan1.md`.
- The content below avoids inventing missing details. Where the source only
  provided strategy or examples, this document keeps them as strategy or
  examples.

## Project Context

MCP-Fabric is evolving beyond a simple MCP router or scaling layer.

The long-term vision is an adaptive runtime fabric for MCP and AI agents. The
fabric should provide:

- Transport abstraction
- Runtime orchestration
- Execution placement
- State topology management
- Lifecycle management
- Recovery and resilience
- Workload-aware routing

The fabric should support stateless, stateful, and hybrid execution without
forcing developers to understand distributed systems concepts. It should
automatically make reasonable runtime decisions whenever possible.

The intended direction is closer to "Kubernetes for MCP runtimes" than "MCP load
balancer."

## Core Design Principles

### Runtime-Agnostic

The fabric should not care whether state is local, external, or hybrid.

The fabric manages:

- Routing
- Placement
- Lifecycle
- Coordination
- Recovery

State strategy is an implementation detail.

### Adaptive by Default

The default developer experience should be simple:

```python
fabric.run(task)
```

The fabric should eventually determine whether execution should be stateless,
sticky, or hybrid.

Developers may override decisions:

```python
fabric.run(task, mode="sticky")
```

```python
fabric.run(task, mode="stateless")
```

### Explicit Override Always Wins

Automatic classification must never remove developer control.

Developer hints must override adaptive behavior:

```python
@fabric.stateful()
```

```python
@fabric.stateless()
```

### Progressive Intelligence

The system should evolve in phases:

1. Explicit modes only.
2. Adaptive recommendations, such as "Detected browser session. Sticky runtime
   recommended."
3. Automatic adaptive selection.
4. Self-optimizing runtime orchestration.

Avoid over-automation early.

## Runtime Modes

### Stateless

Characteristics:

- Replayable
- Horizontally scalable
- No affinity
- Ephemeral workers
- Externalized state

Capabilities:

- Load balancing
- Retries
- Worker replacement
- Autoscaling

### Soft Sticky

Characteristics:

- Prefer the same worker
- Allow fallback

Useful for:

- Warm caches
- Model sessions
- Lightweight continuity

### Sticky

Characteristics:

- Strong affinity
- Preserved local runtime state

Useful for:

- IDE agents
- Browser automation
- Interactive sessions

### Pinned

Characteristics:

- Cannot migrate
- Tied to worker ownership

Useful for:

- Active terminals
- Live subprocesses
- Resource handles

### Hybrid

Characteristics:

- External state, such as memory, vectors, and planning graphs
- Local state, such as browser instances, filesystem state, WebSockets, and
  subprocesses

Hybrid execution is expected to become the dominant mode for advanced agents.

## Runtime Affinity Continuum

Runtime placement decisions should not be treated as a binary choice between
stateless and stateful. They should be modeled as runtime affinity, where
workloads exist on a continuum.

| Mode | Meaning |
| --- | --- |
| Stateless | Fully replayable with no affinity |
| Soft Sticky | Prefer the same worker but allow migration |
| Sticky | Strong affinity to the previous worker |
| Pinned | Cannot migrate while active |
| Hybrid | Combination of externalized state and local runtime state |

The classification system should choose among these affinity levels.

## Adaptive Runtime Classification

A long-term goal of MCP-Fabric is to automatically classify workloads and select
an appropriate execution topology. Developers should not need distributed
systems expertise to get reasonable default behavior.

The future runtime classifier should be a dedicated subsystem:

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

## Workload Signals

The classifier should evaluate observable workload characteristics.

### Streaming

Indicators:

- WebSocket
- Server-sent events
- Bidirectional transports
- Token streaming

Signal: increase affinity score.

### Resource Ownership

Indicators:

- Browser instance
- Filesystem sandbox
- Subprocess
- Terminal session
- GPU context

Signal: increase affinity score significantly.

### Runtime Duration

Short-lived requests reduce affinity score.

Long-running executions increase affinity score.

### Replay Safety

Replay-safe execution reduces affinity score. Examples:

- Search query
- Weather lookup
- Read-only database query

Replay-unsafe execution increases affinity score. Examples:

- Browser clicks
- Terminal execution
- Payment actions
- External mutations

### External State Availability

If state already exists externally, affinity requirements may be reduced.

Potential external state systems include:

- Redis
- Postgres
- Temporal
- Kafka
- NATS

### Initialization Cost

Expensive startup costs should increase affinity. Examples:

- Browser launch
- Sandbox creation
- Large model warmup
- Container preparation

## Affinity Scoring Model

The implementation is intentionally flexible. One possible model:

```python
score = {
    "streaming": True,
    "resource_handles": True,
    "external_memory": False,
    "replay_safe": False,
    "runtime_duration": "long",
}
```

Possible result:

```python
mode = "sticky"
```

or:

```python
mode = "hybrid"
```

The exact algorithm is not important initially. The architecture must allow the
classifier to evolve without major redesign.

## State Topology Management

State topology management is a major differentiator. The fabric should
eventually manage:

- State placement
- State ownership
- State references
- Affinity
- Migration rules
- Recovery semantics

The goal is to manage state topology, not simply route requests.

## SDK Direction

A Python SDK is planned. Example aspirations:

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

```python
@fabric.pinned()
async def terminal_agent():
    ...
```

The SDK should feel simple while exposing advanced capabilities when needed.
Developer ergonomics are critical.

## Future State Backends

Design with pluggability in mind. Candidate backends include:

- Redis
- Postgres
- Temporal
- NATS
- Kafka
- In-memory

Do not tightly couple the architecture to a single backend.

## Future Recovery Semantics

The architecture should eventually support these workload recovery modes:

- Replayable
- Resumable
- Pinned
- Migratable

## Recommended Implementation Phases

### Phase 1: Explicit Modes

Support developer-selected modes only. Do not implement automatic placement yet.

### Phase 2: Classification Analysis

Generate recommendations without automatic decisions. Example:

```text
Browser resources detected. Sticky execution recommended.
```

### Phase 3: Adaptive Placement

Enable adaptive placement while retaining developer override.

### Phase 4: Self-Optimizing Placement

Add self-optimizing placement and affinity tuning after the lower-level runtime
model is proven.

## Expectations For The Next Session

Do not immediately refactor code. Follow this workflow instead.

### Step 1: Audit The Repository

Produce:

- Architecture overview
- Module map
- Runtime flow map
- Dependency map

### Step 2: Compare Against The Target Vision

Identify:

- Strengths
- Gaps
- Architectural risks
- Technical debt

### Step 3: Create A Prioritized Roadmap

Categorize work into:

- Immediate
- Near-term
- Long-term

Include effort estimates.

### Step 4: Propose Architecture Changes Before Implementing

Explain tradeoffs and wait for approval when changes are significant.

### Step 5: Implement Incrementally

For every change, update these together:

- Code
- Tests
- Documentation

### Step 6: Keep Architecture Documentation Current

Whenever architecture changes, update:

- README
- Architecture decision records
- Architecture diagrams
- Developer docs

## Important Constraints

- Prefer simple solutions over clever ones.
- Avoid premature abstraction.
- Avoid unnecessary distributed systems complexity.
- Design for observability.
- Design for future runtime classification.
- Maintain backward compatibility when reasonable.
- Keep the architecture understandable by open-source contributors.

## First Task

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

## Strategic Pillar

A major differentiator for MCP-Fabric should be workload-aware runtime
placement.

The fabric should eventually understand:

- What a workload is doing
- What state it owns
- Whether it can be replayed
- Whether it can migrate
- How much affinity it requires

Then it should select the most appropriate runtime topology automatically.
