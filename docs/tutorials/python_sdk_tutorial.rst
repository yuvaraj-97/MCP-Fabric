Python SDK Tutorial
===================

Learn how to integrate the ``mcp-fabric`` Python SDK into your LLM agent application.

Basic Usage
-----------

.. code-block:: python

   from mcp_fabric import FabricClient

   async def main():
       async with FabricClient(endpoint="http://localhost:8080") as client:
           tools = await client.list_tools()
           print("Available tools across pool:", tools)

   if __name__ == "__main__":
       import asyncio
       asyncio.run(main())
