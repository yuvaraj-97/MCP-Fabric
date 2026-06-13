from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FabricSession:
    session_id: str
    server_instance_id: str | None
    runtime_mode: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class OperationalProofReport:
    ok: bool
    gateway_url: str
    session_id: str
    observability_ok: bool
    health: dict[str, Any]
    sessions: dict[str, Any]
    observability: dict[str, Any]
    tools: dict[str, Any]
    tool_result: dict[str, Any]
