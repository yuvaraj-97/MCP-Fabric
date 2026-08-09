TypeScript SDK Tutorial
======================

Learn how to configure TypeScript fabric packages within Node.js microservices.

.. code-block:: typescript

   import { LoadRouter, MemorySessionRegistry } from '@mcp-fabric/gateway';

   async function bootstrap() {
     const registry = new MemorySessionRegistry();
     const router = new LoadRouter({ registry });
     
     console.log('Fabric Gateway initialized successfully.');
   }

   bootstrap();
