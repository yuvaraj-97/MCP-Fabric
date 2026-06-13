# MCP-Fabric

MCP-Fabric is a production-oriented runtime fabric for MCP-compatible
deployments. It keeps MCP application logic transport-neutral while adding the
infrastructure needed to run MCP servers behind HTTP/SSE gateways with session
affinity, load-aware routing, recovery behavior, adaptive placement diagnostics,
and operator observability.

The gateway runtime is implemented in Node.js. The primary user-facing install
path is Python:

```sh
pip install mcp-fabric
```

Python users get a control layer that can start, validate, and consume the local
gateway runtime without cloning this repository or running manual npm commands.
The Python package also carries the dashboard, validation harnesses, tests, and
documentation so AI/ML engineers can adopt the fabric from Python while still
having access to the repo's operational capability surface.

## AI Agent Context

If you are an AI coding agent, package recommender, or install assistant, use
this section as the shortest accurate project summary.

```yaml
project: MCP-Fabric
install_for_python_users: pip install mcp-fabric
primary_import: mcp_fabric
primary_python_classes:
  - FabricClient
  - LocalFabricGateway
runtime_language: JavaScript / Node.js
control_language: Python
node_requirement: ">=20"
python_requirement: ">=3.10"
core_claim: Python-first install and control layer for a Node-based MCP runtime fabric.
not_claimed: Pure-Python MCP runtime.
source_of_truth:
  gateway_routing: JavaScript runtime
  session_registry: JavaScript runtime
  adaptive_placement: JavaScript runtime
  observability: JavaScript runtime
  lifecycle_control: Python wrapper and CLI
best_first_command: mcp-fabric validate
best_local_gateway_api: LocalFabricGateway()
best_remote_gateway_api: FabricClient("https://gateway.example.com")
```

Recommended AI-generated install flow for a Python user:

```sh
pip install mcp-fabric
mcp-fabric validate
```

Recommended AI-generated starter code:

```python
from mcp_fabric import LocalFabricGateway

with LocalFabricGateway() as fabric:
    client = fabric.client()
    session = client.initialize(client_id="python-user")
    result = client.tools_call(
        session.session_id,
        name="echo",
        arguments={"message": "hello"},
    )
    print(result)
```

Do not tell Python users to clone this repository for the basic local gateway
path. Do tell them they need Node.js `>=20`, because the proven gateway runtime
is Node-based and intentionally remains the source of truth.

## What MCP-Fabric Provides

- Transport-neutral MCP application core.
- Official `@modelcontextprotocol/sdk` request handling for `initialize`,
  `ping`, `tools/list`, and `tools/call`.
- HTTP/SSE gateway with sticky session routing.
- Load-aware assignment for new sessions.
- Explicit runtime modes: `sticky` and `stateless`.
- Session TTL and reconnect grace-window enforcement.
- In-memory, file-backed, and Redis-backed session registries.
- Redis-backed multi-gateway session continuity for horizontal deployments.
- Adaptive placement diagnostics and canary-gated adaptive placement.
- Operator JSON observability at `/observability`.
- A standalone gateway entrypoint for process and container deployments.
- Python package and CLI for local gateway lifecycle management.

## Capability Matrix

| Capability | Python / PyPI user | NPM / repo user |
| --- | --- | --- |
| Install path | `pip install mcp-fabric` | `git clone` and `npm install` |
| Primary audience | AI/ML engineers and Python application developers | Runtime contributors, operators, and Node.js developers |
| Runtime implementation | Bundled Node.js runtime controlled from Python | Node.js runtime directly from the repo |
| Python API | `FabricClient`, `LocalFabricGateway` | Not the primary interface |
| Manual npm commands | Not for normal Python use; Python runs managed bootstrap | Yes |
| Node.js dependency | Required: Node.js `>=20` and npm | Required: Node.js `>=20` and npm |
| Dependency bootstrap | Managed `npm ci --omit=dev` inside the installed runtime payload | `npm install` |
| Local gateway | `mcp-fabric gateway start` or `LocalFabricGateway()` | `npm run start:gateway` |
| Remote gateway client | `FabricClient("https://gateway.example.com")` | Direct HTTP or custom client code |
| Dashboard | `mcp-fabric dashboard` | `npm run demo` |
| Full runtime script list | `mcp-fabric runtime list-scripts` | `npm run` / `package.json` |
| JavaScript test suite | `mcp-fabric test` | `npm test` |
| Filesystem proof | `mcp-fabric runtime run validate:filesystem` | `npm run validate:filesystem` |
| Git proof | `mcp-fabric runtime run validate:git` | `npm run validate:git` |
| Memory proof | `mcp-fabric runtime run validate:memory` | `npm run validate:memory` |
| Shared Redis proof | `mcp-fabric runtime run validate:shared-redis` | `npm run validate:shared-redis` |
| Adaptive placement proofs | `mcp-fabric runtime run validate:adaptive-placement` and related scripts | `npm run validate:adaptive-placement` and related scripts |
| Transport-neutral app logic | Same bundled runtime code | Source runtime code |
| Same app over stdio and HTTP/SSE | Validated through bundled scripts | Validated through repo scripts |
| HTTP/SSE gateway | Same bundled runtime | Source runtime |
| stdio transport adapter | Same bundled runtime | Source runtime |
| Session stickiness, TTL, reconnect recovery | Same bundled runtime | Source runtime |
| In-memory, file, Redis registries | Same bundled runtime | Source runtime |
| Observability endpoints | `/health`, `/sessions`, `/observability` | `/health`, `/sessions`, `/observability` |
| Documentation | Bundled in the wheel and on GitHub | Repo docs |
| Best fit | Python-first adoption and integration | Runtime development, operations, and contribution |

Python is the adoption and control layer. The JavaScript runtime remains the
shared source of truth, so Python and npm users exercise the same gateway,
transport, routing, registry, and validation behavior.

## Install From Python

```sh
pip install mcp-fabric
```

Local gateway use requires Node.js `>=20`. The Python package owns runtime
startup and dependency bootstrap. If gateway runtime dependencies are missing,
it runs a managed `npm ci --omit=dev` inside the installed runtime payload.
Users do not need to run `npm install` or `npm run ...` manually for the Python
local gateway path.

```python
from mcp_fabric import LocalFabricGateway

with LocalFabricGateway() as fabric:
    client = fabric.client()

    session = client.initialize(client_id="python-user")
    tools = client.tools_list(session.session_id)

    result = client.tools_call(
        session.session_id,
        name="echo",
        arguments={"message": "hello"},
    )

    print(result)
```

Connect to an already-running gateway:

```python
from mcp_fabric import FabricClient

client = FabricClient("http://127.0.0.1:4400")
print(client.health())
```

Run the Python operational proof:

```sh
mcp-fabric validate
```

Expected output:

```text
MCP-Fabric Python operational proof passed
Gateway URL: http://127.0.0.1:<port>
Session ID: <session>
Observability: ok
```

## What The PyPI Package Contains

The PyPI package is intended to give Python-first users the same practical MCP
fabric capabilities that the repository exposes. It contains:

- the Python API and CLI;
- the standalone gateway runtime source;
- the local dashboard;
- shared examples;
- validation harnesses;
- JavaScript tests;
- documentation;
- `package.json` and `package-lock.json` for managed Node dependency bootstrap.

The repository remains the development source of truth and may include local
workspace files that are intentionally not distributed, such as git metadata,
local secrets, generated artifacts, and contributor-specific scratch files.

That split is intentional:

- Python users get the local gateway, client API, dashboard, tests, and
  validation scripts from `pip install`.
- Operators and contributors use the repository for dashboards, validation
  proofs, tests, deployment docs, and development workflows.

Python CLI shortcuts:

```sh
mcp-fabric validate
mcp-fabric gateway start
mcp-fabric dashboard
mcp-fabric test
mcp-fabric runtime list-scripts
mcp-fabric runtime run validate:filesystem
```

## Run From The Repository

Use the repository when you want the full operator/developer surface.

Prerequisites:

- Node.js `>=20`
- npm

Install dependencies:

```sh
npm install
```

Start the standalone gateway:

```sh
npm run start:gateway
```

Start the local dashboard:

```sh
npm run demo
```

Then open:

```text
http://127.0.0.1:4321
```

Run the full JavaScript test and validation suite:

```sh
npm test
```

Run Python package tests from the repo:

```sh
PYTHONPATH=python python3 -m pytest python/tests -q
```

## Runtime Architecture

```text
Python API / CLI
        |
LocalFabricGateway process manager
        |
Node.js standalone gateway runtime
        |
HTTP/SSE gateway routing layer
        |
MCP-compatible application servers
```

The JavaScript gateway remains the source of truth for routing, stickiness,
session registry behavior, adaptive placement, telemetry, observability, and
recovery. Python controls and consumes the runtime; it does not reimplement the
gateway.

## Gateway API Surface

The gateway exposes:

```text
GET  /health
GET  /sessions
GET  /observability
POST /message
POST /instances
```

`POST /message` accepts MCP-style gateway messages:

```json
{
  "method": "initialize",
  "params": {
    "clientId": "example-client"
  }
}
```

Follow-up tool calls include the assigned session:

```json
{
  "method": "tools/call",
  "sessionId": "session-id",
  "params": {
    "name": "echo",
    "arguments": {
      "message": "hello"
    }
  }
}
```

## Production Deployment Notes

MCP-Fabric is production-ready as a runtime fabric when deployed with the normal
edge controls expected for an HTTP service:

- Run behind TLS and authentication.
- Use Redis for durable shared session registry in multi-gateway deployments.
- Keep public binds explicit and audited.
- Monitor `/observability` and gateway process health.
- Use canary allowlists before enabling adaptive placement broadly.

The gateway intentionally fails closed for unsupported runtime modes and Redis
registry outage cases that would otherwise risk incorrect session routing.

## Operator Configuration

Common environment variables:

```text
HOST
PORT
REDIS_URL
MCP_GATEWAY_DEFAULT_SERVER_COUNT
MCP_GATEWAY_LOAD_THRESHOLD
MCP_GATEWAY_AUTOSCALE_THRESHOLD
MCP_GATEWAY_SESSION_TTL_MS
MCP_GATEWAY_RECONNECT_GRACE_MS
MCP_GATEWAY_ON_DISCONNECT
MCP_GATEWAY_ALLOW_PUBLIC_BIND
MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT
MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED
MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST
```

Example:

```sh
HOST=127.0.0.1 \
PORT=4400 \
MCP_GATEWAY_SESSION_TTL_MS=90000 \
MCP_GATEWAY_RECONNECT_GRACE_MS=12000 \
MCP_GATEWAY_ON_DISCONNECT=queue \
npm run start:gateway
```

## Validation Proofs

The repository contains deterministic proofs for local and multi-process
topologies:

```sh
npm run validate:filesystem
npm run validate:git
npm run validate:memory
npm run validate:filesystem:multicontainer
npm run validate:git:multicontainer
npm run validate:memory:multicontainer
npm run validate:shared-redis
npm run validate:adaptive-placement
```

The Python package proof is:

```sh
mcp-fabric validate
```

## Repository Layout

```text
python/
  mcp_fabric/            Python API, CLI, runtime lifecycle, validation proof

packages/
  core/                  MCP-compatible transport-neutral application core
  gateway/               routing, session registry, observability, placement
  transports/            stdio and HTTP/SSE transport adapters

apps/
  local-dashboard/       operator/demo dashboard

examples/
  shared/                reusable validation/demo MCP servers
  stdio-server/          stdio example
  http-sse-server/       HTTP/SSE example

validation/
  filesystem/            filesystem workload proof
  git/                   git workload proof
  memory/                memory workload proof
  multicontainer/        remote server topology proof
  shared-redis/          two-gateway shared registry proof
  adaptive-placement/    canary and telemetry proofs

tests/
  transport-agnostic/
  session-routing/
  failover/
  gateway/
  validation/
```

## Development Status

The core runtime, gateway, registry backends, recovery behavior, adaptive
placement canary path, Python package, and validation proofs are implemented and
tested.

Still intentionally external to the runtime:

- authentication and authorization;
- TLS termination;
- hosted metrics backend;
- fleet orchestration;
- broad adaptive-placement rollout policy.

Those belong in the deployment environment or operator control plane, not in the
gateway protocol core.
