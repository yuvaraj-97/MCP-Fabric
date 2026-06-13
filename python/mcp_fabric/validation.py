from __future__ import annotations

from .models import OperationalProofReport
from .runtime import LocalFabricGateway


def run_operational_proof() -> OperationalProofReport:
    with LocalFabricGateway() as fabric:
        client = fabric.client()
        health = client.health()
        session = client.initialize(client_id="python-operational-proof")
        tools = client.tools_list(session.session_id)
        tool_result = client.tools_call(
            session.session_id,
            name="echo",
            arguments={"message": "hello"},
        )
        observability = client.observability()
        sessions = client.sessions()

        sessions_list = sessions.get("sessions", [])
        session_seen = any(
            record.get("sessionId") == session.session_id
            for record in sessions_list
            if isinstance(record, dict)
        )
        observability_ok = isinstance(observability, dict) and bool(observability)
        ok = (
            health.get("ok") is True
            and session_seen
            and observability_ok
            and tool_result.get("result", {}).get("isError") is False
        )

        return OperationalProofReport(
            ok=ok,
            gateway_url=fabric.url,
            session_id=session.session_id,
            observability_ok=observability_ok,
            health=health,
            sessions=sessions,
            observability=observability,
            tools=tools,
            tool_result=tool_result,
        )


def main() -> int:
    report = run_operational_proof()
    if not report.ok:
        raise SystemExit("MCP-Fabric Python operational proof failed")

    print("MCP-Fabric Python operational proof passed")
    print(f"Gateway URL: {report.gateway_url}")
    print(f"Session ID: {report.session_id}")
    print("Observability: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
