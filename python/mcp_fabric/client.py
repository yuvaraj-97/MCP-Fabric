from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from .errors import FabricClientError
from .models import FabricSession


class FabricClient:
    def __init__(self, base_url: str, *, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout

    def health(self) -> dict[str, Any]:
        return self._get("health")

    def sessions(self) -> dict[str, Any]:
        return self._get("sessions")

    def observability(self) -> dict[str, Any]:
        return self._get("observability")

    def initialize(
        self,
        client_id: str | None = None,
        runtime_mode: str | None = None,
        runtime_hints: dict[str, Any] | None = None,
    ) -> FabricSession:
        body: dict[str, Any] = {"method": "initialize", "params": {}}
        if client_id is not None:
            body["params"]["clientId"] = client_id
        if runtime_mode is not None:
            body["runtimeMode"] = runtime_mode
        if runtime_hints is not None:
            body["runtimeHints"] = runtime_hints

        payload = self._post("message", body)
        return FabricSession(
            session_id=payload["sessionId"],
            server_instance_id=payload.get("serverInstanceId"),
            runtime_mode=payload.get("runtimeMode"),
            raw=payload,
        )

    def tools_list(self, session_id: str) -> dict[str, Any]:
        return self._post("message", {"method": "tools/list", "sessionId": session_id})

    def tools_call(
        self,
        session_id: str,
        *,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._post(
            "message",
            {
                "method": "tools/call",
                "sessionId": session_id,
                "params": {
                    "name": name,
                    "arguments": arguments or {},
                },
            },
        )

    def message(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._post("message", body)

    def _get(self, path: str) -> dict[str, Any]:
        request = Request(urljoin(self.base_url, path), method="GET")
        return self._send(request)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        request = Request(
            urljoin(self.base_url, path),
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        return self._send(request)

    def _send(self, request: Request) -> dict[str, Any]:
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise FabricClientError(
                f"Gateway request failed with HTTP {error.code}: {body}"
            ) from error
        except URLError as error:
            raise FabricClientError(f"Gateway request failed: {error.reason}") from error

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as error:
            raise FabricClientError(f"Gateway returned non-JSON response: {raw}") from error

        if not isinstance(parsed, dict):
            raise FabricClientError("Gateway returned a non-object JSON response")
        return parsed
