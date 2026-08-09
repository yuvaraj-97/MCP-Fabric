TypeScript API Reference
========================

This section provides details regarding the TypeScript / Node.js core components and gateway.

Core Session Registry
---------------------

The Session Registry tracks active sessions and maps client request contexts to server endpoints.

.. code-block:: typescript

   import { MemorySessionRegistry } from '@mcp-fabric/gateway';

   const registry = new MemorySessionRegistry();
   await registry.registerSession('session-123', 'endpoint-node-1');

Load Router
-----------

The dynamic router distributes traffic based on server load metrics, response latency, and capacity.

.. code-block:: typescript

   import { LoadRouter } from '@mcp-fabric/gateway';

   const router = new LoadRouter({ policy: 'adaptive-latency' });
   const targetNode = await router.selectNode(requestContext);
