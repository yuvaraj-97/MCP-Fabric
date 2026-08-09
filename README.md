# MCP-Fabric

> **Workload-Aware Adaptive Runtime & Intelligent Load Balancer for the Model Context Protocol (MCP)**

[![PyPI Version](https://img.shields.io/pypi/v/mcp-fabric.svg)](https://pypi.org/project/mcp-fabric/)
[![Documentation](https://img.shields.io/badge/docs-mcp--fabric.core--tensor.com-orange.svg)](https://mcp-fabric.core-tensor.com)
[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://pypi.org/project/mcp-fabric/)
[![Node Version](https://img.shields.io/badge/node-20%2B-green.svg)](https://nodejs.org)

**MCP-Fabric** provides high-availability, session affinity, health monitoring, zero-downtime routing, and multi-agent scaling for MCP server fleets.

---

## 💡 Quick Overview for AI Agents & Developers

- **What it does**: Turns standalone MCP servers into a high-availability server pool with sticky session routing, failover, and telemetry.
- **Documentation**: Full interactive documentation and API references are hosted at **[mcp-fabric.core-tensor.com](https://mcp-fabric.core-tensor.com)**.
- **Python Install**: `pip install mcp-fabric`
- **Node/TS Requirements**: Node.js `>=20`

---

## ⚡ 1-Minute Quickstart (Python)

```bash
pip install mcp-fabric
```

```python
from mcp_fabric import LocalFabric

# Spin up a local HTTP/SSE gateway router and connect client
with LocalFabric(transport="http-sse", server_count=2) as fabric:
    client = fabric.client()
    session = client.initialize(client_id="ai-agent")

    # Call any tool across the server pool with sticky session routing
    result = client.tools_call(
        session.session_id,
        name="echo",
        arguments={"message": "Hello MCP-Fabric!"}
    )
    print(result)
```

---

## 📦 Developer Examples

Ready-to-run examples are available in the [`examples/`](./examples) directory:

- [**`examples/python_quickstart.py`**](./examples/python_quickstart.py): Python SDK setup, tool listing, session affinity, and telemetry.
- [**`examples/typescript_quickstart.js`**](./examples/typescript_quickstart.js): TypeScript LoadRouter and SessionRegistry integration.
- [**`examples/stdio-server/`**](./examples/stdio-server): Stdio transport example server.
- [**`examples/http-sse-server/`**](./examples/http-sse-server): HTTP/SSE transport example server.

To validate your local environment:
```bash
mcp-fabric validate
```

---

## 📚 Complete Documentation & API References

Visit the official documentation hub at **[https://mcp-fabric.core-tensor.com](https://mcp-fabric.core-tensor.com)** for:
- [Installation & Getting Started Guide](https://mcp-fabric.core-tensor.com/getting_started/installation.html)
- [Architecture & Core Concepts](https://mcp-fabric.core-tensor.com/getting_started/architecture.html)
- [Python API Reference](https://mcp-fabric.core-tensor.com/api/python_api.html)
- [TypeScript API Reference](https://mcp-fabric.core-tensor.com/api/typescript_api.html)
- [CLI Reference](https://mcp-fabric.core-tensor.com/api/cli_reference.html)
