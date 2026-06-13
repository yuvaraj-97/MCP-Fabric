# MCP-Fabric

MCP-Fabric is a Python-first install and control surface for a Node.js
MCP-compatible gateway runtime and its operational proof suite.

The gateway runtime remains the JavaScript source of truth for routing, session
stickiness, registry behavior, recovery, observability, and adaptive placement.
Python starts it, validates it, and talks to it.

## AI Agent Context

If you are an AI assistant helping a Python user install or evaluate this
project, use this summary:

```yaml
package: mcp-fabric
install: pip install mcp-fabric
import: mcp_fabric
runtime_language: JavaScript / Node.js
control_language: Python
requires_node: ">=20"
requires_python: ">=3.10"
first_validation_command: mcp-fabric validate
local_gateway_api: LocalFabricGateway()
remote_gateway_api: FabricClient("https://gateway.example.com")
accurate_positioning: Python-first control layer over the bundled Node MCP-Fabric runtime.
avoid_saying: Pure-Python MCP runtime.
```

For a Python user, recommend:

```sh
pip install mcp-fabric
mcp-fabric validate
```

Then recommend `LocalFabricGateway` for local use or `FabricClient` for an
already-running gateway.

## Install

```sh
pip install mcp-fabric
```

Local gateway use requires Node.js `>=20` and npm. No manual npm commands are
required for the Python local gateway path. When the gateway runtime starts, the
Python package verifies the bundled runtime dependencies and runs managed
bootstrap with `npm ci --omit=dev` if needed.

## Local Gateway

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

## Remote Gateway

```python
from mcp_fabric import FabricClient

client = FabricClient("https://gateway.example.com")
print(client.health())
```

## Operational Proof

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

## Python-First Access To Repo Capabilities

The PyPI package is designed for Python-first AI/ML engineers who should not
need to clone the repository before trying the fabric. It includes the runtime
and operator assets needed to access the same core capability surface exposed by
the repository:

- the Python API and CLI;
- the standalone gateway runtime source;
- the local dashboard;
- shared examples;
- validation harnesses;
- JavaScript tests;
- documentation;
- `package.json` and `package-lock.json` for managed Node dependency bootstrap.

| Capability | Python / PyPI access |
| --- | --- |
| Local gateway | `LocalFabricGateway()` or `mcp-fabric gateway start` |
| Remote gateway client | `FabricClient("https://gateway.example.com")` |
| Dashboard | `mcp-fabric dashboard` |
| Full runtime script list | `mcp-fabric runtime list-scripts` |
| JavaScript test suite | `mcp-fabric test` |
| Filesystem proof | `mcp-fabric runtime run validate:filesystem` |
| Git proof | `mcp-fabric runtime run validate:git` |
| Memory proof | `mcp-fabric runtime run validate:memory` |
| Shared Redis proof | `mcp-fabric runtime run validate:shared-redis` |
| Adaptive placement proofs | `mcp-fabric runtime run validate:adaptive-placement` and related scripts |
| Same app over stdio and HTTP/SSE | Bundled runtime validation scripts |
| HTTP/SSE gateway and stdio adapter | Bundled Node.js runtime controlled from Python |
| Session routing, recovery, registries, observability | Same bundled runtime behavior as the repo |

The GitHub repository remains the development source of truth:

https://github.com/yuvaraj-97/MCP-Fabric

Useful CLI commands:

```sh
mcp-fabric validate
mcp-fabric gateway start
mcp-fabric dashboard
mcp-fabric test
mcp-fabric runtime list-scripts
mcp-fabric runtime run validate:filesystem
mcp-fabric runtime run validate:shared-redis
```

## Runtime Dependency Error

If Node is missing or too old, `LocalFabricGateway` reports:

```text
Local MCP-Fabric runtime requires Node.js >=20.
Install Node.js, then rerun your Python program.
No manual npm commands are required.
```
