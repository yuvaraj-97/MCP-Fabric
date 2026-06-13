class McpFabricError(Exception):
    """Base exception for MCP-Fabric Python package errors."""


class FabricClientError(McpFabricError):
    """Raised when a gateway HTTP request fails."""


class GatewayRuntimeError(McpFabricError):
    """Raised when the local gateway runtime cannot be started or managed."""


class NodeRuntimeError(GatewayRuntimeError):
    """Raised when the required Node.js runtime is unavailable."""
