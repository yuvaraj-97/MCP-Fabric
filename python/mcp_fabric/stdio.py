from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .errors import FabricClientError, GatewayRuntimeError
from .models import FabricSession
from .paths import bundled_runtime_dir, stdio_server_entrypoint
from .runtime import ensure_node_runtime, ensure_runtime_dependencies
from .runtime import print_runtime_config, redact_mapping, report_value


class LocalStdioServer:
    def __init__(
        self,
        *,
        server_instance_id: str = "stdio-server-1",
        env: dict[str, str] | None = None,
        print_config: bool = True,
        runtime_dir: str | os.PathLike[str] | None = None,
    ):
        self.server_instance_id = server_instance_id
        self.env = env or {}
        self.print_config = print_config
        self.runtime_dir = Path(runtime_dir).resolve() if runtime_dir else bundled_runtime_dir()
        self.process: subprocess.Popen[str] | None = None
        self.logs: list[str] = []

    def __enter__(self) -> "LocalStdioServer":
        self.start()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.stop()

    def start(self) -> "LocalStdioServer":
        if self.process is not None:
            return self

        ensure_node_runtime()
        ensure_runtime_dependencies(self.runtime_dir)
        entrypoint = stdio_server_entrypoint(self.runtime_dir)
        if not entrypoint.exists():
            raise GatewayRuntimeError(f"Bundled stdio entrypoint not found: {entrypoint}")
        if self.print_config:
            print_runtime_config(
                "stdio",
                {
                    "server_instance_id": report_value(self.server_instance_id, "user" if self.server_instance_id != "stdio-server-1" else "default"),
                    "env": report_value(redact_mapping(self.env), "user" if self.env else "default"),
                    "runtime_dir": report_value(str(self.runtime_dir), "resolved"),
                },
            )

        env = {**os.environ, **self.env}
        env["SERVER_INSTANCE_ID"] = self.server_instance_id
        self.process = subprocess.Popen(
            ["node", str(entrypoint)],
            cwd=str(self.runtime_dir),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return self

    def stop(self) -> None:
        process = self.process
        if process is None:
            return

        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

        if process.stderr is not None:
            self.logs.extend(line.rstrip() for line in process.stderr.readlines())
            process.stderr.close()
        if process.stdout is not None:
            process.stdout.close()
        if process.stdin is not None:
            process.stdin.close()

        self.process = None

    def client(self) -> "StdioFabricClient":
        if self.process is None:
            raise GatewayRuntimeError("Local stdio server is not running")
        return StdioFabricClient(self.process)


class StdioFabricClient:
    def __init__(self, process: subprocess.Popen[str]):
        if process.stdin is None or process.stdout is None:
            raise TypeError("process must expose text stdin and stdout pipes")
        self.process = process
        self._next_id = 1

    def initialize(self, client_id: str | None = None) -> FabricSession:
        params: dict[str, Any] = {}
        if client_id is not None:
            params["clientId"] = client_id
        payload = self.message({"method": "initialize", "params": params})
        result = payload["result"]
        return FabricSession(
            session_id=result["sessionId"],
            server_instance_id=result.get("serverInstanceId"),
            runtime_mode="stdio",
            raw=payload,
        )

    def tools_list(self, session_id: str) -> dict[str, Any]:
        return self.message({"method": "tools/list", "sessionId": session_id})

    def tools_call(
        self,
        session_id: str,
        *,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.message(
            {
                "method": "tools/call",
                "sessionId": session_id,
                "params": {
                    "name": name,
                    "arguments": arguments or {},
                },
            }
        )

    def message(self, body: dict[str, Any]) -> dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        message = {
            "jsonrpc": "2.0",
            "id": request_id,
            **body,
        }

        stdin = self.process.stdin
        stdout = self.process.stdout
        if stdin is None or stdout is None:
            raise FabricClientError("stdio process pipes are closed")
        if self.process.poll() is not None:
            raise FabricClientError(f"stdio process exited with code {self.process.returncode}")

        stdin.write(json.dumps(message) + "\n")
        stdin.flush()

        while True:
            line = stdout.readline()
            if line == "":
                raise FabricClientError("stdio process closed stdout before returning a response")
            payload = json.loads(line)
            if payload.get("method") == "event":
                continue
            if payload.get("id") != request_id:
                continue
            if "error" in payload:
                raise FabricClientError(payload["error"].get("message", "stdio request failed"))
            return payload
