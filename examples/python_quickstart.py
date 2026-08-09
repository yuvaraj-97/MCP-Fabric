"""
Complete end-to-end Python example using mcp_fabric to start a local MCP gateway,
initialize a session, query tools, call tools with workload affinity, and inspect telemetry.
"""

import asyncio
from mcp_fabric import LocalFabric, FabricClient

async def main():
    print("🚀 Initializing MCP-Fabric local HTTP/SSE Gateway...")
    
    # Spin up local fabric runtime with 2 load-balanced server instances
    with LocalFabric(
        transport="http-sse",
        host="127.0.0.1",
        port=4400,
        server_count=2,
        load_threshold=0.7,
        session_ttl_ms=60_000,
    ) as fabric:
        
        # Connect client to the local gateway
        client: FabricClient = fabric.client()
        
        print("\n1. Health Check:")
        health = client.health()
        print("   Status:", health)

        print("\n2. Initializing Session:")
        session = client.initialize(client_id="developer-agent")
        print(f"   Created Session ID: {session.session_id}")

        print("\n3. Listing Available Tools Across Pool:")
        tools = client.tools_list(session.session_id)
        print("   Tools:", tools)

        print("\n4. Executing Tool Call with Session Affinity:")
        result = client.tools_call(
            session_id=session.session_id,
            name="echo",
            arguments={"message": "Hello from MCP-Fabric!"}
        )
        print("   Result:", result)

        print("\n5. Checking Pool Telemetry & Active Sessions:")
        sessions = client.sessions()
        print("   Active Sessions:", sessions)

if __name__ == "__main__":
    asyncio.run(main())
