CLI Reference
=============

The ``mcp-fabric-cli`` and ``mcp-fabric-gateway`` tools provide command-line controls for managing pools and running gateway routers.

Commands
--------

``mcp-fabric-gateway``
~~~~~~~~~~~~~~~~~~~~~~

Starts the standalone fabric proxy gateway server.

.. code-block:: text

   Usage: mcp-fabric-gateway [options]

   Options:
     --config <path>   Path to operator configuration JSON file.
     --port <number>   Port to bind HTTP/SSE server (default: 8080).
     --transport <type> Standard I/O (stdio) or HTTP (http) transport mode.

``mcp-fabric-cli``
~~~~~~~~~~~~~~~~~~

CLI management utility for pool monitoring and mode recovery matrix operations.

.. code-block:: text

   Usage: mcp-fabric-cli [command] [options]

   Commands:
     pool status       List current active server nodes and health metrics.
     node drain <id>   Gracefully drain connections from a server node.
