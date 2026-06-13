import json
from io import BytesIO

from mcp_fabric import FabricClient


def test_fabric_client_calls_gateway_endpoints(monkeypatch):
    requests = []

    def fake_urlopen(request, timeout):
        body = None
        if request.data is not None:
            body = json.loads(request.data.decode("utf-8"))
        requests.append((request.get_method(), request.selector, body, timeout))
        if body and body["method"] == "initialize":
            return JsonResponse(
                {
                    "sessionId": "session-1",
                    "serverInstanceId": "server-a",
                    "runtimeMode": "sticky",
                    "result": {"serverInfo": {"name": "test"}},
                }
            )
        if body:
            return JsonResponse({"sessionId": body["sessionId"], "result": {"isError": False}})
        return JsonResponse({"ok": True, "sessions": []})

    client = FabricClient("http://127.0.0.1:4400")
    monkeypatch.setattr("mcp_fabric.client.urlopen", fake_urlopen)

    assert client.health()["ok"] is True
    session = client.initialize(client_id="python-user")
    assert session.session_id == "session-1"
    client.tools_list(session.session_id)
    client.tools_call(session.session_id, name="echo", arguments={"message": "hello"})

    assert requests[0] == ("GET", "/health", None, 10.0)
    assert requests[1][2]["params"]["clientId"] == "python-user"
    assert requests[2][2]["method"] == "tools/list"
    assert requests[3][2]["params"]["name"] == "echo"


class JsonResponse:
    def __init__(self, payload):
        self._body = BytesIO(json.dumps(payload).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return self._body.read()
