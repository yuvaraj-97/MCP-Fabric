# Prototype Roadmap

## Milestone 1: Transport-Neutral Server Interface

Define a small core interface for MCP-compatible application logic.

Acceptance criteria:

- A sample tool can be registered without transport-specific code.
- The same sample tool can be mounted by stdio and HTTP/SSE adapters.
- Unit tests cover request and notification dispatch through the shared layer.

## Milestone 2: stdio Adapter

Implement the simplest complete transport adapter first.

Acceptance criteria:

- The example server can run as a stdio subprocess.
- Requests and notifications preserve MCP-compatible semantics.
- Transport-specific code is isolated from application handlers.

## Milestone 3: HTTP/SSE Adapter

Add an HTTP/SSE or Streamable HTTP adapter.

Acceptance criteria:

- The same example server runs over HTTP/SSE.
- Session IDs are accepted and exposed to the routing layer.
- Long-lived response streams remain tied to the correct instance.

## Milestone 4: Session Gateway

Add a gateway with an in-memory session registry.

Acceptance criteria:

- New sessions are assigned to a healthy server instance.
- Existing sessions are routed back to their assigned instance.
- The mapping is observable in logs or test assertions.

## Milestone 5: Load-Aware Routing

Add load-aware new-session assignment.

Acceptance criteria:

- A configurable threshold controls new-session assignment.
- Existing sessions continue to route to their assigned server while healthy.
- Tests cover the overloaded-server scenario.

## Milestone 6: Failure Scenarios

Make failure handling explicit.

Acceptance criteria:

- Server crash behavior is tested.
- Client disconnect and grace-period behavior is tested.
- Gateway restart behavior is documented, even if durable registry support is a
  later implementation.
