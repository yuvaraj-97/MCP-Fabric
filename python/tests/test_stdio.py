from __future__ import annotations

import json
from io import StringIO

from mcp_fabric import StdioFabricClient
from mcp_fabric.local import LocalFabric


def test_stdio_fabric_client_calls_json_line_process():
    process = FakeProcess(
        [
            {"jsonrpc": "2.0", "method": "event", "params": {"event": "session.ready"}},
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "sessionId": "stdio-session-1",
                    "serverInstanceId": "stdio-a",
                    "initialized": True,
                },
            },
            {
                "jsonrpc": "2.0",
                "id": 2,
                "result": {
                    "tools": [{"name": "echo"}],
                },
            },
            {
                "jsonrpc": "2.0",
                "id": 3,
                "result": {
                    "isError": False,
                    "structuredContent": {"message": "hello"},
                },
            },
        ]
    )

    client = StdioFabricClient(process)
    session = client.initialize(client_id="python-user")
    tools = client.tools_list(session.session_id)
    result = client.tools_call(
        session.session_id,
        name="echo",
        arguments={"message": "hello"},
    )

    requests = [json.loads(line) for line in process.stdin.getvalue().splitlines()]
    assert session.session_id == "stdio-session-1"
    assert session.runtime_mode == "stdio"
    assert tools["result"]["tools"][0]["name"] == "echo"
    assert result["result"]["structuredContent"]["message"] == "hello"
    assert requests[0]["method"] == "initialize"
    assert requests[0]["params"]["clientId"] == "python-user"
    assert requests[1]["method"] == "tools/list"
    assert requests[1]["sessionId"] == "stdio-session-1"
    assert requests[2]["method"] == "tools/call"
    assert requests[2]["params"]["name"] == "echo"


class FakeProcess:
    def __init__(self, responses):
        self.stdin = StringIO()
        self.stdout = StringIO(
            "".join(json.dumps(response) + "\n" for response in responses)
        )
        self.returncode = None

    def poll(self):
        return self.returncode


def test_local_fabric_selects_http_transport(monkeypatch):
    selected = {}

    class FakeGateway:
        url = "http://127.0.0.1:4400"
        logs = []

        def __init__(self, **kwargs):
            selected["transport"] = "http-sse"
            selected["kwargs"] = kwargs

        def start(self):
            selected["started"] = True

        def stop(self):
            selected["stopped"] = True

        def client(self):
            return "http-client"

    monkeypatch.setattr("mcp_fabric.local.LocalFabricGateway", FakeGateway)

    with LocalFabric(transport="http-sse", port=4400) as fabric:
        assert fabric.client() == "http-client"
        assert fabric.url == "http://127.0.0.1:4400"

    assert selected["transport"] == "http-sse"
    assert selected["kwargs"]["port"] == 4400
    assert selected["started"] is True
    assert selected["stopped"] is True


def test_local_fabric_selects_stdio_transport(monkeypatch):
    selected = {}

    class FakeStdio:
        logs = []

        def __init__(self, **kwargs):
            selected["transport"] = "stdio"
            selected["kwargs"] = kwargs

        def start(self):
            selected["started"] = True

        def stop(self):
            selected["stopped"] = True

        def client(self):
            return "stdio-client"

    monkeypatch.setattr("mcp_fabric.local.LocalStdioServer", FakeStdio)

    with LocalFabric(
        transport="stdio",
        server_instance_id="stdio-a",
        env={"CUSTOM_STDIO_FLAG": "1"},
    ) as fabric:
        assert fabric.client() == "stdio-client"
        assert fabric.url is None

    assert selected["transport"] == "stdio"
    assert selected["kwargs"]["server_instance_id"] == "stdio-a"
    assert selected["kwargs"]["env"] == {"CUSTOM_STDIO_FLAG": "1"}
    assert selected["started"] is True
    assert selected["stopped"] is True
