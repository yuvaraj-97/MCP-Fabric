Quickstart Guide
================

This quickstart guides you through launching an MCP Fabric router and connecting clients using the Python SDK.

1. Launching the Adaptive Fabric Gateway
---------------------------------------

Start the MCP Fabric standalone gateway with standard I/O or HTTP transport:

.. code-block:: bash

   mcp-fabric-gateway --config config.json --port 8080

2. Connecting via Python SDK
----------------------------

.. code-block:: python

   from mcp_fabric import FabricClient, RoutingPolicy

   # Initialize client connected to fabric pool
   client = FabricClient(
       endpoint="http://localhost:8080",
       routing_policy=RoutingPolicy.ADAPTIVE_LATENCY
   )

   # Execute tool call across fabric pool
   response = client.call_tool("search_database", {"query": "enterprise docs"})
   print("Response from server:", response)

3. Inspecting Pool Telemetry
---------------------------

Check the active fabric pool health and dynamic routing table:

.. code-block:: bash

   mcp-fabric-cli pool status
