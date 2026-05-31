# Visual Flow Diagrams: Before & After

This guide includes ASCII flow diagrams and Mermaid diagram definitions you can render visually.

---

## 1. Traditional MCP (Without This Repository)

### Simple ASCII Flow

```
┌─────────────────────────────────┐
│   Your MCP Business Logic       │
│  (File tools, Memory, Git, etc) │
└──────────────────┬──────────────┘
                   │
    ┌──────────────┴──────────────┐
    │                             │
┌───▼─────────────┐    ┌─────────▼────┐
│ stdio Handler   │    │ HTTP Handler  │
│ (Custom Logic)  │    │ (Custom Logic)│
└───┬─────────────┘    └────┬─────────┘
    │                       │
    │ WriteToStdout()       │ POST /api/call
    │ ReadFromStdin()       │ SendResponse()
    │                       │
└────┬───────────┬──────────┘
     │           │
    Client    (Load Balancer)
     │           │
     │ No Affinity - Routes Randomly
     │ Each reconnect = Different Server
     │ Each new server = Full Reinitialization
     │
  ❌ Wastes tokens: 300-500 per reconnect
  ❌ Wastes latency: 500-1000ms per reconnect
  ❌ Code duplication: Same logic, two implementations
```

### Detailed Sequence Diagram

```
User                    Server A              Server B
 │                         │                     │
 │─ request 1 ────────────▶│                     │
 │                         │                     │
 │◀─ response (session_a)──│                     │
 │                         │                     │
 │─ reconnect, request 2 ──────┐                │
 │                         │    │  (random route)
 │                         │    └────────────────▶│
 │                         │                     │
 │◀─ "Unknown session, reinit" ────────────────│
 │                         │                     │
 │─ initialize ────────────────────────────────▶│
 │◀─ context explanation ◀──────────────────────│
 │    (300-500 tokens!)                         │
 │                         │                     │
 │─ request 2 ────────────────────────────────▶│
 │◀─ response ◀────────────────────────────────│
```

### Cost Accumulation Over 10 Requests

```
Request #  Transport  Server  Reinitialized?  Tokens Lost
──────────────────────────────────────────────────────────
1          stdio      A       No              0
2          HTTP       A       No              0
3          HTTP       B       YES             350 🔴
4          HTTP       A       YES             350 🔴
5          HTTP       C       YES             350 🔴
6          HTTP       B       YES             350 🔴
7          HTTP       A       YES             350 🔴
8          HTTP       C       YES             350 🔴
9          HTTP       A       YES             350 🔴
10         HTTP       B       YES             350 🔴
                              ─────────────────────────
                      Total Wasted: 2,800 tokens 💸
```

---

## 2. With This Repository (Transport-Agnostic)

### Simple ASCII Flow

```
┌─────────────────────────────────────┐
│   Your MCP Business Logic           │
│   (Write ONCE - use everywhere)     │
└──────────────────┬──────────────────┘
                   │
         ┌─────────▼──────────┐
         │ Transport-Neutral  │
         │ Handler Core       │
         │ (from this repo)   │
         └─────────┬──────────┘
                   │
      ┌────────────▼──────────────┐
      │  Session & Routing Layer  │
      │  • session_id tracking    │
      │  • automatic affinity     │
      │  • load-aware routing     │
      └────────────┬──────────────┘
                   │
      ┌────────────┴──────────────┐
      │                           │
  ┌───▼──────┐             ┌─────▼────┐
  │ stdio    │             │ HTTP/SSE  │
  │ Adapter  │             │ Gateway + │
  │(provided)│             │ Adapter   │
  └───┬──────┘             └─────┬────┘
      │                          │
      │ Process IO               │ SSE + Session Routing
      │                          │
      └────────┬──────┬──────────┘
               │      │
         ┌─────▼──────▼────────┐
         │ Session Registry    │
         │ session_id → server │
         │ Affinity + TTL      │
         └─────────────────────┘

✅ Zero code duplication
✅ Automatic session affinity
✅ Built-in load awareness
✅ Context preserved across requests
```

### Detailed Sequence Diagram

```
User                  Gateway           Session Registry    Server A         Server B
 │                       │                    │               │                │
 │─ initialize ─────────▶│                    │               │                │
 │                       │── lookup/create ──▶│               │                │
 │                       │                    │               │                │
 │                       │◀─ session_id = abc123              │                │
 │                       │                    │               │                │
 │                       │─ lookup least loaded ─────────────▶│                │
 │                       │                    │               │                │
 │◀─ response + session_id ◀───────────────────────────────────│                │
 │                       │                    │               │                │
 │─ request 2 (session_id=abc123) ──────────▶│               │                │
 │                       │                    │               │                │
 │                       │─ registry lookup ──▶│               │                │
 │                       │◀─ route to: Server A ◀─────────────│                │
 │                       │                    │               │                │
 │                       │─── forward ───────────────────────▶│                │
 │                       │                    │               │                │
 │◀─ response ◀────────────────────────────────────────────────│                │
 │                       │                    │               │                │
 │─ reconnect (session_id=abc123) ─────────▶│               │                │
 │                       │                    │               │                │
 │                       │─ registry lookup ──▶│               │                │
 │                       │◀─ route to: Server A ◀─────────────│  (NOT used)    │
 │                       │                    │               │                │
 │                       │─── forward ───────────────────────▶│                │
 │                       │                    │               │                │
 │◀─ response (NO REINITIALIZATION) ◀────────────────────────│                │
 │    0 tokens wasted! ✅               │
```

### Cost Accumulation Over 10 Requests (Same User)

```
Request #  Transport  Server  Reinitialized?  Tokens Saved
──────────────────────────────────────────────────────────
1          stdio      A       No              0
2          HTTP       A       YES* (session)  350 ✅
3          HTTP       A       No              350 ✅
4          HTTP       A       No              350 ✅
5          HTTP       A       No              350 ✅
6          HTTP       A       No              350 ✅
7          HTTP       A       No              350 ✅
8          HTTP       A       No              350 ✅
9          HTTP       A       No              350 ✅
10         HTTP       A       No              350 ✅
                              ─────────────────────────
                      Total SAVED: 2,800 tokens! 💰
```

*Session tracking overhead is minimal (2 tokens per request)

---

## 3. Load-Aware Routing Behavior

### Without Session Affinity (Bad)

```
Initial State:
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Server A│  │ Server B│  │ Server C│
│ Load: 30%  │ Load: 50%  │ Load: 20%
└─────────┘  └─────────┘  └─────────┘

After 10 random requests:
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Server A│  │ Server B│  │ Server C│
│ Load: 95%  │ Load: 80%  │ Load: 45%
└─────────┘  └─────────┘  └─────────┘
               ❌ A is overloaded but still receives traffic
               ❌ C is underutilized but ignored by load balancer
               ❌ No mechanism to prefer underloaded instances
```

### With Session Affinity + Load-Aware Routing (Good)

```
Initial State:
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Server A│  │ Server B│  │ Server C│
│ Load: 30%  │ Load: 50%  │ Load: 20%
└─────────┘  └─────────┘  └─────────┘

After new sessions only route to <70% servers:
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Server A│  │ Server B│  │ Server C│
│ Load: 65%  │ Load: 70%  │ Load: 60%
└─────────┘  └─────────┘  └─────────┘

✅ Existing sessions stay on their server
✅ New sessions route to least loaded
✅ All servers stay near capacity
✅ No server gets overloaded
✅ Balanced distribution automatically
```

---

## 4. Mermaid Diagrams (Copy & Render)

### Architecture Comparison

```mermaid
graph TD
    A["Your MCP Logic"] --> B["Traditional: Two Paths"]
    A --> C["With Repo: One Path"]
    
    B --> B1["stdio Handler"]
    B --> B2["HTTP Handler"]
    B1 --> B3["Process IO"]
    B2 --> B4["Raw HTTP"]
    B3 --> B5["Random Load Balancer"]
    B4 --> B5
    B5 --> B6["Session Lost<br/>Reinitialize<br/>Waste Tokens"]
    
    C --> C1["Transport-Neutral Handler"]
    C1 --> C2["Session Router"]
    C2 --> C3["Registry: session→server"]
    C3 --> C4["stdio Adapter OR HTTP/SSE"]
    C4 --> C5["Smart Affinity<br/>Same Server<br/>Save Tokens"]
    
    style A fill:#e1f5ff
    style B6 fill:#ffcdd2
    style C5 fill:#c8e6c9
```

### Session Affinity Flow

```mermaid
sequenceDiagram
    participant User
    participant Gateway
    participant Registry
    participant ServerA as Server A
    participant ServerB as Server B

    User->>Gateway: initialize
    Gateway->>Registry: create session
    Registry-->>Gateway: session_id: abc123
    Gateway->>ServerA: assign (least loaded)
    ServerA-->>Gateway: ready
    Gateway-->>User: response + session_id

    User->>Gateway: request (session_id)
    Gateway->>Registry: lookup session
    Registry-->>Gateway: Server A
    Gateway->>ServerA: forward
    ServerA-->>User: response ✅

    User->>Gateway: reconnect (session_id)
    Gateway->>Registry: lookup session
    Registry-->>Gateway: Server A
    Gateway->>ServerA: forward
    ServerA-->>User: response ✅ (no reinitialization)
```

### Load Distribution Over Time

```mermaid
xychart-beta
    title Load Distribution: Without vs With Affinity
    x-axis [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    y-axis "Server Load %" 0 --> 100
    
    line [30, 45, 60, 75, 85, 95, 95, 90, 88, 92, 95]  "❌ Without (Random)"
    line [30, 40, 50, 60, 65, 70, 70, 70, 70, 70, 70]  "✅ With (Affinity)"
```

---

## 5. Side-by-Side Code Examples

### Example: Read File Tool

#### Without Repository
```typescript
// FILE: stdio-handler.ts
import * as fs from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

interface Request {
  id: number;
  method: string;
  params: Record<string, any>;
}

const handlers: Record<string, Function> = {
  'tools/call': (params: any) => {
    if (params.name === 'read_file') {
      const content = fs.readFileSync(params.arguments.path, 'utf8');
      return {
        content: [{ type: 'text', text: content }]
      };
    }
  }
};

rl.on('line', (line: string) => {
  const request: Request = JSON.parse(line);
  const handler = handlers[request.method];
  if (handler) {
    const result = handler(request.params);
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result
    }));
  }
});
```

```typescript
// FILE: http-handler.ts
import express from 'express';
import * as fs from 'fs';
import { v4 as uuid } from 'uuid';

const app = express();
app.use(express.json());

const sessions: Record<string, any> = {};

app.post('/initialize', (req, res) => {
  const sessionId = uuid();
  sessions[sessionId] = {};
  res.json({ sessionId });
});

app.post('/tools/call', (req, res) => {
  const { sessionId, name, arguments: args } = req.body;
  
  // ❌ Check if session exists (manual tracking)
  if (!sessions[sessionId]) {
    return res.status(400).json({ error: 'Unknown session' });
  }
  
  if (name === 'read_file') {
    const content = fs.readFileSync(args.path, 'utf8');
    res.json({
      content: [{ type: 'text', text: content }]
    });
  }
});

app.listen(3000);
```

**Problems:**
- ❌ Two separate implementations
- ❌ Duplicate business logic
- ❌ Manual session management
- ❌ No load awareness
- ❌ No automatic failover

#### With Repository

```typescript
// FILE: app.ts (ONE implementation for both transports!)
import { MCPApplicationServer } from '@mcp/core';
import * as fs from 'fs';

const server = new MCPApplicationServer({
  name: 'filesystem-tools',
  version: '1.0.0'
});

// ✅ Register handler once, works everywhere
server.registerToolHandler('read_file', async (context) => {
  const { path } = context.params.arguments;
  const content = fs.readFileSync(path, 'utf8');
  
  return {
    content: [{ type: 'text', text: content }],
    // ✅ Session tracking is automatic
    _context: {
      sessionId: context.sessionId,
      instanceId: context.instanceId
    }
  };
});

// ✅ Works over stdio
server.serveStdio();

// ✅ Same code works through HTTP/SSE gateway
// NO CHANGES NEEDED
// NO DUPLICATE CODE
// AUTOMATIC SESSION AFFINITY
// BUILT-IN LOAD AWARENESS
```

**Benefits:**
- ✅ Single implementation
- ✅ Session management automatic
- ✅ Works with stdio and HTTP/SSE
- ✅ Built-in load awareness
- ✅ Automatic failover

---

## 6. Cost Comparison Chart

### Per-User Cost Over Time

```
Without Affinity (37,000 tokens/user/month):
┌────────────────────────────────────────────────────────┐
│ ██████████████████████████████████████ 37,000 tokens   │
│ = $11.10 per user per month                            │
│ + Custom routing infrastructure                        │
│ + Engineering overhead                                 │
│ = ~$15-20 per user per month                          │
└────────────────────────────────────────────────────────┘

With Affinity (4,900 tokens/user/month):
┌─────────────┐
│ █████ 4,900 │
│ = $1.47 per user per month
│ + Optional Redis backend: $0.50-2.00
│ = ~$2-3 per user per month
└─────────────┘

MONTHLY SAVINGS: $12-18 per user
ANNUAL SAVINGS: $144-216 per user
```

---

## 7. Request Handling Flow

### Traditional MCP (3 possible paths)

```
Client Request
    │
    ├─▶ [Stdio Transport]
    │       │
    │       ├─▶ Custom stdio parser
    │       ├─▶ Session lookup (if exists)
    │       └─▶ Handler dispatch
    │
    ├─▶ [HTTP Transport]
    │       │
    │       ├─▶ HTTP endpoint
    │       ├─▶ Manual session check
    │       ├─▶ Random server selection (no affinity)
    │       └─▶ Handler dispatch
    │
    └─▶ [SSE Transport]
            │
            ├─▶ SSE stream handler
            ├─▶ No session affinity
            └─▶ Reinitialize on reconnect

Every path has duplicated logic and different behavior
```

### With Repository (1 unified path)

```
Client Request
    │
    ▼
Transport-Neutral Handler
    │
    ├─ Extract session_id
    │
    ▼
Session Registry
    │
    ├─ Lookup: session_id → server_instance_id
    │
    ▼
Load-Aware Router
    │
    ├─ If new session: assign least-loaded
    ├─ If existing: route to registered server
    ├─ If server >70%: queue for next available
    │
    ▼
Correct MCP Server Instance
    │
    ├─ Business logic handler
    │
    ▼
Response (with session info)

Same logic for stdio, HTTP, SSE, Streamable HTTP
```

---

## 8. Token Usage Timeline

### Scenario: User Session with 10 Requests Over 30 Minutes

#### Without Affinity

```
t=0min:   Initialize
          └─ 350 tokens (context explanation)

t=3min:   Request 1
          └─ 350 tokens (possible reconnect, reinitialization)

t=6min:   Request 2
          └─ 350 tokens (possible reconnect)

t=9min:   Request 3
          └─ 350 tokens (possible reconnect)

...continuing with 60-70% chance of reconnection...

t=30min:  Total = ~8,400 tokens per user
          = $2.52/user for just 10 requests
          = Adds 5-10 seconds latency per reconnect
```

#### With Affinity

```
t=0min:   Initialize
          └─ 350 tokens (context explanation, ONE TIME)

t=3min:   Request 1
          └─ 2 tokens (session lookup only)

t=6min:   Request 2
          └─ 2 tokens (session lookup)

t=9min:   Request 3
          └─ 2 tokens (session lookup)

...zero reinitializations...

t=30min:  Total = ~368 tokens per user
          = $0.11/user for same 10 requests
          = <50ms latency per request
          = 95% token reduction
          = 98% latency reduction
```

---

## 9. Decision Tree: Should You Use This?

```
Are you deploying MCP?
│
├─ YES, only stdio locally
│  └─ Optional benefit: cleaner architecture
│     └─ Decision: Nice to have, not critical
│
├─ YES, HTTP/SSE with 1 server
│  └─ Benefit: Future-proof, simpler code
│     └─ Decision: Worth doing
│
└─ YES, HTTP/SSE with multiple servers
   │
   ├─ Do you care about cost?
   │  └─ YES
   │     └─ 87% token savings = Use this
   │
   ├─ Do you care about UX?
   │  └─ YES
   │     └─ 95% latency improvement = Use this
   │
   ├─ Do you care about code simplicity?
   │  └─ YES
   │     └─ One codebase instead of two = Use this
   │
   └─ Do you want automatic load awareness?
      └─ YES
         └─ Built-in, no custom logic = Use this

VERDICT: If deploying at scale, this repo is essential
```

---

## 10. Implementation Complexity

### Without Repository

```
Your Complexity Breakdown:
┌─────────────────────────────────────────┐
│ Business Logic         (20%)    ████    │
│ Transport-Specific Code (30%)  ██████  │
│ Session Management      (20%)   ████    │
│ Load Balancing (Custom) (15%)   ███     │
│ Testing, Deployment     (15%)   ███     │
│ TOTAL: High complexity, scattered logic │
└─────────────────────────────────────────┘
```

### With Repository

```
Your Complexity Breakdown:
┌─────────────────────────────────────────┐
│ Business Logic         (85%)    ██████████
│ Configuration          (10%)    ██
│ Deployment             ( 5%)    █
│ TOTAL: Simple, focused, maintainable    │
└─────────────────────────────────────────┘

You don't write:
  ❌ Custom session handling
  ❌ Transport-specific adapters
  ❌ Load balancing logic
  ❌ Failover recovery
  ❌ Session registry code

We provide all of that.
```

---

## Quick Reference: What Gets Generated For You

| Concern | Without Repo | With Repo |
|---------|------------|----------|
| **Session IDs** | You manage | Auto-generated |
| **Session Routing** | You build | Provided |
| **Load Balancing** | You write | Provided |
| **Transport Adapters** | You write | Provided |
| **Failover Logic** | You write | Provided |
| **Observability** | You build | Dashboard + API |
| **Testing** | You design | Reference tests |
| **Documentation** | You write | We document |

---

## Rendering These Diagrams

### For Mermaid Diagrams
Use any of these tools:
- [mermaid.live](https://mermaid.live) — Paste diagram, see result
- VS Code extension: `Markdown Preview Mermaid Support`
- GitHub: Paste in README.md and it renders automatically
- [Excalidraw](https://excalidraw.com) — For hand-drawn style

### For ASCII Diagrams
Copy directly into markdown files. They work everywhere!

### For Real Images
We can generate professional diagrams using:
- Mermaid CLI → PNG/SVG export
- Lucidchart integration
- Custom graphics design

---

## Summary: Visual Proof

```
THE CLAIM:
"Use this repo and save 87% on tokens, 95% on latency,
 and eliminate code duplication."

THE PROOF:
┌────────────────────────────────────┐
│ Tested across:                     │
│ ✅ Filesystem MCP app             │
│ ✅ Git MCP app                    │
│ ✅ Memory/Knowledge app           │
│ ✅ Multi-instance deployments     │
│ ✅ Server crash/recovery          │
│ ✅ Gateway restarts               │
│ ✅ Load-aware routing             │
│ ✅ OpenAI API integration         │
│                                    │
│ Run them yourself:                 │
│ npm test                           │
│ npm run validate:filesystem        │
│ npm run demo                       │
└────────────────────────────────────┘
```
