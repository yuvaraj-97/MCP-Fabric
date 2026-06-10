# Python-First Packaging Plan for MCP-Fabric

## Goal

MCP-Fabric should be installable and usable by Python users with:

```sh
pip install mcp-fabric
```

The Python package must provide complete local use of the current repository by
default, not only a thin remote client. A Python user should not need to clone
this repository manually, inspect the JavaScript source layout, or run separate
`npm` commands before using MCP-Fabric.

## Product Decision

MCP-Fabric remains implemented primarily in the existing Node/JavaScript
codebase. The Python package becomes the default user-facing installation and
control surface.

Positioning:

> MCP-Fabric is a Node-based runtime fabric with a Python-first installation and
> control layer.

The JavaScript gateway remains the source of truth for:

- gateway routing;
- session stickiness;
- Redis-backed session registry behavior;
- adaptive placement;
- telemetry;
- observability;
- recovery behavior.

Python should control and consume the runtime, not fork it.

## Required v1 Experience

The target v1 user flow is:

```sh
pip install mcp-fabric
```

Then:

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

Users should also be able to connect to an already-running gateway:

```python
from mcp_fabric import FabricClient

client = FabricClient("http://127.0.0.1:4400")
```

## v1 Must Include Full Local Use

There is no separate v2 plan for bundling the runtime. v1 must include the full
local-use story.

`pip install mcp-fabric` should install enough of MCP-Fabric for Python users to
start and use the local gateway without cloning this repository.

The package may rely on a supported runtime dependency only if the dependency is
detected and explained clearly. The user experience must still be owned by the
Python package.

## Runtime Packaging Strategy

The current gateway is Node-based, so v1 must choose one of these approaches.

### Preferred: Bundle a Runnable Gateway Runtime

Package a runnable gateway artifact with the Python package.

Possible implementation options:

- bundle selected JavaScript source plus required runtime dependencies;
- bundle a compiled runtime using Bun, `pkg`, `nexe`, or a similar tool;
- ship platform-specific wheels containing the gateway runtime.

The goal is that users do not manually run:

```sh
npm install
npm run ...
```

### Acceptable Fallback: Managed Node Runtime

If fully bundling an executable is too risky for the first implementation slice,
v1 may require Node.js `>=20`, but Python must manage everything else.

In this fallback:

- `LocalFabricGateway` checks for Node.js;
- missing Node produces a clear error;
- Python starts the bundled gateway source;
- Python manages dependency/bootstrap steps;
- Python owns startup, port selection, logs, health checks, and shutdown;
- users do not manually run `npm install` or `npm run demo`.

Example error:

```text
Local MCP-Fabric runtime requires Node.js >=20.
Install Node.js, then rerun your Python program.
No manual npm commands are required.
```

## Repository Layout

Add a Python package inside the existing repository:

```text
MCP_Improvement/
  packages/
  validation/
  examples/
  apps/
  docs/
  package.json

  python/
    pyproject.toml
    README.md
    mcp_fabric/
      __init__.py
      client.py
      runtime.py
      models.py
      errors.py
      paths.py
      validation.py
      cli.py
      _bundled/
        README.md
```

During development, do not manually duplicate the whole repository into
`python/mcp_fabric/_bundled/`.

Instead:

- keep the source of truth at the repository root;
- configure Python packaging to include the selected runtime files;
- copy/package runtime files into the wheel at build time;
- have `mcp_fabric.paths` locate the bundled runtime directory after install.

## Python API

### `FabricClient`

`FabricClient` is the Python HTTP client for an MCP-Fabric gateway.

Required methods:

```python
client.health()
client.sessions()
client.observability()

client.initialize(
    client_id: str | None = None,
    runtime_mode: str | None = None,
    runtime_hints: dict | None = None,
)

client.tools_list(session_id: str)

client.tools_call(
    session_id: str,
    name: str,
    arguments: dict | None = None,
)
```

It should use the existing gateway endpoints:

```text
GET  /health
GET  /sessions
GET  /observability
POST /message
POST /instances
```

### `LocalFabricGateway`

`LocalFabricGateway` manages the bundled local runtime lifecycle.

Expected use:

```python
from mcp_fabric import LocalFabricGateway

with LocalFabricGateway() as fabric:
    client = fabric.client()
```

Required behavior:

- locate the bundled runtime;
- choose a free local port when none is provided;
- start the gateway process;
- wait for readiness;
- expose `fabric.url`;
- return a configured `FabricClient`;
- capture logs;
- terminate the process on context exit;
- fail clearly if startup fails.

Suggested constructor:

```python
LocalFabricGateway(
    host="127.0.0.1",
    port=None,
    adaptive_placement=False,
    redis_url=None,
    keep_artifacts=False,
    log_level="info",
)
```

### `validation.py`

Expose operational proof helpers:

```python
from mcp_fabric.validation import run_operational_proof

report = run_operational_proof()
assert report.ok
```

## Required Operational Proof

Add a Python operational proof that validates the full local path:

1. Python starts the bundled MCP-Fabric gateway.
2. Python initializes a session.
3. Python lists tools.
4. Python calls a tool.
5. Python reads `/observability`.
6. Python verifies session/routing metadata.
7. Python shuts the gateway down cleanly.

The proof should be runnable as:

```sh
python -m mcp_fabric.validation
```

or:

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

## Packaging Requirements

`python/pyproject.toml` should define:

- package name: `mcp-fabric`;
- import name: `mcp_fabric`;
- supported Python version, preferably `>=3.10`;
- console script:

```toml
[project.scripts]
mcp-fabric = "mcp_fabric.cli:main"
```

Required CLI commands:

```sh
mcp-fabric gateway start
mcp-fabric validate
mcp-fabric version
```

For v1, `mcp-fabric validate` is required.

## Documentation Requirements

Add Python documentation covering:

1. Installation:

   ```sh
   pip install mcp-fabric
   ```

2. Local gateway usage:

   ```python
   from mcp_fabric import LocalFabricGateway

   with LocalFabricGateway() as fabric:
       client = fabric.client()
   ```

3. Remote gateway usage:

   ```python
   from mcp_fabric import FabricClient

   client = FabricClient("https://gateway.example.com")
   ```

4. Operational proof:

   ```sh
   mcp-fabric validate
   ```

5. Runtime dependency note:

   Explain whether the package includes a bundled executable runtime or requires
   Node.js.

## What Not To Do

Do not rewrite the gateway in Python.

Do not duplicate routing logic in Python.

Do not duplicate adaptive placement logic in Python.

Do not create a second implementation of the session registry.

Do not let Python and JavaScript behavior drift.

The Python package should expose, launch, and validate the existing runtime. It
should not become a competing runtime implementation.

## Production Readiness Language

After this work, the repository can say:

> MCP-Fabric provides a Python-first install and control surface for the local
> gateway runtime.

Do not claim:

> MCP-Fabric is a pure Python runtime.

The honest claim is:

> Python users can install, start, validate, and use MCP-Fabric locally through
> the Python package, while the proven gateway runtime remains the source of
> truth.

## Acceptance Criteria

The implementation is complete when:

- `pip install mcp-fabric` installs the Python package;
- Python users can import `mcp_fabric`;
- `LocalFabricGateway` starts the bundled/local MCP-Fabric gateway;
- `FabricClient` can call `/message`, `/health`, `/sessions`, and
  `/observability`;
- `mcp-fabric validate` passes locally;
- no manual `npm install` or `npm run ...` is required from the user;
- existing JavaScript tests still pass;
- Python wrapper tests pass;
- documentation clearly explains the architecture;
- the JavaScript gateway remains the single source of truth.
