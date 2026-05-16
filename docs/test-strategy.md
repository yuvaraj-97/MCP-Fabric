# Test Strategy

## Objective

Validate that the same MCP-compatible application logic behaves correctly over
both `stdio` and HTTP/SSE, that session affinity works through a gateway, and
that the deployed endpoint can be inspected under load with enough visibility to
confirm the recent infrastructure improvements are actually taking effect.

## Test Layers

### 1. Transport parity

Purpose:
prove that the same application behavior is reachable through both transports.

Initial checks:

- initialize a session
- send a request and receive a response
- emit notifications/events
- preserve transport-neutral application behavior

Execution:

- automated local tests
- one `stdio` harness
- one HTTP/SSE harness

### 2. Session affinity and routing

Purpose:
prove that follow-up requests for the same `session_id` return to the same
server instance while new sessions prefer the least-loaded healthy instance.

Initial checks:

- new session assignment
- sticky routing for existing sessions
- reassignment when an instance becomes unhealthy
- refusal when no instance can accept a new session

Execution:

- automated local tests
- gateway inspection endpoint for current session mappings

### 3. SSE and step-by-step inspection

Purpose:
give a human-visible way to confirm the HTTP/SSE flow, session identity, routed
instance, and event stream behavior.

Initial checks:

- create or resume a session from the browser
- show `session_id`
- show assigned `server_instance_id`
- display every SSE event in order
- show request/response payloads and timestamps

Execution:

- simple HTML inspector page served by the local gateway

### 4. Load and scaling validation

Purpose:
measure whether increasing concurrency changes routing decisions and, in the
live environment, whether Kubernetes adds or redistributes capacity as expected.

Initial checks:

- concurrent request bursts
- concurrent session creation
- long-lived SSE connections under pressure
- observed instance distribution
- latency/error-rate tracking

Execution:

- local load generator first
- live-domain load generator second

## Execution Order

1. Build the minimal runnable transport harnesses.
2. Add local automated tests for parity, routing, and SSE visibility.
3. Add the HTML inspector for manual validation.
4. Add a load generator for local stress tests.
5. Repoint the same tooling at `https://core-tensor.com` for live validation.

## Live-Domain Caution

The live test target is `core-tensor.com` behind Cloudflare. Live load tests
should only begin after the local harness and observability surface are stable.
The first live run should be progressive:

1. low-rate smoke test
2. medium concurrency session test
3. sustained higher load

Each stage should capture:

- response status distribution
- latency percentiles
- assigned instance identifiers if exposed
- SSE disconnect/reconnect behavior
- evidence of scale-out or rebalance

## Deliverables

- runnable `stdio` harness
- runnable HTTP/SSE harness
- automated tests
- HTML inspector page
- load-test script
- documentation for local and live execution
