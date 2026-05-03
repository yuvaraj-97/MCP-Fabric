# MCP Transport-Agnostic Architecture & Session-Aware Scaling
### Research & Design Document for an MCP-Compatible Infrastructure Improvement

---

## 1. Project Intent

This project is not trying to replace MCP.

The goal is to work with the **original MCP architecture** and improve the surrounding infrastructure so that MCP servers can scale more cleanly across supported transports such as:

- stdio
- HTTP/SSE / Streamable HTTP

The long-term goal is to build, test, and share this idea publicly so that the broader MCP ecosystem can benefit from a cleaner, more scalable deployment model.

---

## 2. Origin of the Idea

This exploration began after studying advanced MCP concepts and identifying friction around transport behavior, especially with HTTP/SSE deployments.

The original questions were:

1. **HTTP/SSE scaling problem**

   When multiple MCP servers are deployed for load balancing, why not store the SSE connection identity and a client/session ID so future requests can be routed to the same server?

2. **Load control problem**

   If a server reaches around 70% load, why not stop assigning it new sessions while allowing it to continue serving existing sessions?

3. **stdio simplification question**

   For stdio, why do we need request, notification, and response semantics? Could client/server IDs make the system more streamlined?

4. **Unified transport question**

   Can MCP code remain the same whether the transport is stdio or HTTP/SSE?

---

## 3. Initial Hypothesis

The early idea was:

> Use client/server identity to simplify MCP transport behavior.

Proposed concepts included:

- Store `client_id`
- Store `session_id`
- Route requests to the same MCP server
- Use sticky sessions for SSE
- Avoid sending new work to overloaded servers
- Make stdio and HTTP/SSE feel unified

---

## 4. Important Refinement

The key insight is that IDs should not replace MCP protocol semantics.

MCP still needs the original protocol model:

| MCP Concept | Purpose |
|---|---|
| request | A message that expects a response |
| response | A reply to a request |
| notification | A one-way message with no expected response |
| client_id | Identifies a client |
| session_id | Preserves continuity across requests/connections |
| server_instance_id | Identifies a specific running server instance |

The refined conclusion:

> Keep MCP’s original protocol architecture intact, but improve deployment infrastructure with session-aware routing and transport-agnostic adapters.

---

## 5. Final Architecture Direction

```text
MCP Application Logic
        ↓
Original MCP Protocol Layer
(request / response / notification / capabilities)
        ↓
Session & Routing Layer
(session_id / client_id / server_instance_id)
        ↓
Transport Adapter Layer
(stdio OR HTTP/SSE)
        ↓
Runtime Infrastructure
(load balancer / gateway / session registry)
```

This keeps MCP compatible while adding infrastructure needed for scalable real-world deployments.

---

## 6. Core Design Principle

Application logic should not care whether the MCP server is running over stdio or HTTP/SSE.

Instead of writing code like:

```text
writeToStdout()
postToHttpEndpoint()
openSseStream()
```

The application should depend on transport-neutral primitives:

```text
sendRequest(method, params)
sendNotification(method, params)
onRequest(handler)
onNotification(handler)
```

The transport adapter handles the mechanics.

---

## 7. HTTP/SSE Infrastructure Proposal

### 7.1 Session Affinity

For HTTP/SSE deployments, use a session registry:

```text
session_id → server_instance_id
```

Request flow:

```text
Client
  ↓
Gateway / Load Balancer
  ↓
Session Registry
  ↓
Correct MCP Server Instance
```

Existing sessions are routed back to the same server whenever possible.

---

### 7.2 Load-Aware Routing

Instead of sending traffic blindly, the gateway should distinguish between:

- New sessions
- Existing sessions

Suggested policy:

```text
New sessions       → least-loaded healthy server
Existing sessions  → same server as before
Server > 70% load  → stop assigning new sessions
Server unhealthy   → reconnect / reinitialize / migrate
```

The 70% number is not a hard rule. It is a policy threshold that can be tuned.

---

### 7.3 Why This Helps

This solves several operational problems:

- Prevents long-lived SSE sessions from being broken by random load balancing
- Allows stateful MCP servers to continue serving existing clients
- Reduces risk of overloading hot instances
- Gives operators a practical scaling model
- Makes HTTP/SSE MCP deployments easier to reason about

---

## 8. stdio Transport Position

stdio is different from HTTP/SSE.

In stdio:

```text
Host process ↔ MCP server subprocess
```

There is usually:

- no load balancer
- no multi-server routing
- no SSE connection
- no session registry requirement

So stdio does not need the same routing solution.

However, stdio can still use the same transport abstraction so the MCP application logic stays consistent.

---

## 9. What This Project Should Not Do

This project should **not**:

- Replace MCP
- Remove request/response/notification semantics
- Invent a new incompatible protocol
- Break existing MCP clients or servers
- Force all transports to behave exactly the same internally

Instead, it should:

- Preserve MCP compatibility
- Improve transport abstraction
- Add optional infrastructure for scalable HTTP/SSE deployments
- Make the approach easy for the community to understand and adopt

---

## 10. Forking / Contribution Strategy

Because this project builds on the original MCP architecture, there are two possible paths:

### Option A: Fork MCP Reference Implementation

Use this if the infrastructure changes need to be demonstrated directly inside an existing MCP implementation.

Benefits:

- Easier to show compatibility
- Easier to compare before/after behavior
- Useful for proposing upstream changes

Risks:

- Fork may drift from upstream
- Requires ongoing maintenance

---

### Option B: Build a Compatible Extension Layer

Create a separate project that wraps or extends existing MCP implementations.

Benefits:

- Less invasive
- Easier to experiment
- Can support multiple MCP implementations
- Better for early research

Risks:

- May need adapter code for each language/runtime
- Some changes may still require upstream discussion

---

### Recommended Approach

Start with **Option B**.

Build a compatible infrastructure layer first:

```text
mcp-session-gateway
mcp-transport-adapter
mcp-load-router
```

Then, if the design proves useful, prepare a focused upstream proposal or fork.

---

## 11. Suggested Project Structure

```text
mcp-transport-infra/
  README.md
  docs/
    design.md
    session-affinity.md
    load-balancing.md
    stdio-vs-http.md
    proposal.md

  packages/
    core/
      protocol-adapter/
      session/
      routing/

    transports/
      stdio/
      http-sse/

    gateway/
      load-balancer/
      session-registry/

  examples/
    stdio-server/
    http-sse-server/
    multi-server-load-balanced-demo/

  tests/
    transport-agnostic/
    session-routing/
    failover/
```

---

## 12. Minimum Viable Prototype

The first prototype should prove three things:

### 12.1 Same MCP Logic, Different Transport

One MCP tool/server implementation should run over:

- stdio
- HTTP/SSE

without changing business logic.

---

### 12.2 Sticky HTTP/SSE Sessions

A client should connect through a gateway and consistently reach the same MCP server instance using `session_id`.

---

### 12.3 Load-Aware Assignment

When one server crosses a configured threshold, new sessions should be routed to another healthy server while existing sessions remain sticky.

---

## 13. Failure Scenarios to Test

### Server Overload

```text
Server A reaches 70%
Existing sessions stay on A
New sessions go to B
```

### Server Crash

```text
Client reconnects with session_id
Gateway detects old server unavailable
Client is assigned to another server
Session is reinitialized or restored
```

### Client Disconnect

```text
Session enters grace period
If client reconnects, same session resumes
If timeout expires, session is cleaned up
```

### Gateway Restart

```text
Session registry survives externally
Gateway reloads session mappings
Routing continues
```

---

## 14. Public Sharing Strategy

Once the prototype works, the idea can be shared as:

- GitHub repository
- technical blog post
- architecture proposal
- MCP ecosystem discussion
- demo video
- upstream issue / RFC-style proposal

The public message should be:

> This project proposes a session-aware, transport-agnostic infrastructure layer for MCP that preserves MCP’s original architecture while improving scalability for HTTP/SSE deployments.

---

## 15. Research Thesis

> MCP should keep its original protocol semantics, but production deployments need stronger transport abstraction and session-aware infrastructure.

More directly:

> The protocol should remain MCP. The infrastructure around it should become more scalable, transport-agnostic, and session-aware.

---

## 16. Final Takeaway

The original idea was valuable because it identified a real deployment gap:

- HTTP/SSE needs better session continuity
- Load balancing needs to understand MCP sessions
- stdio and HTTP/SSE should not force different application code
- The community benefits from a clean abstraction instead of fragmented transport-specific implementations

The refined direction is:

```text
Do not replace MCP.
Do not remove protocol semantics.
Add a session-aware infrastructure layer.
Make MCP app logic transport-agnostic.
Demonstrate it with a working prototype.
Share it openly with the ecosystem.
```

---

## End of Document
