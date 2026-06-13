from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

from .client import FabricClient
from .errors import GatewayRuntimeError, NodeRuntimeError
from .paths import bundled_runtime_dir, standalone_gateway_entrypoint

NODE_ERROR = """Local MCP-Fabric runtime requires Node.js >=20.
Install Node.js, then rerun your Python program.
No manual npm commands are required."""


class LocalFabricGateway:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int | None = None,
        adaptive_placement: bool = False,
        redis_url: str | None = None,
        keep_artifacts: bool = False,
        log_level: str = "info",
        startup_timeout: float = 10.0,
        runtime_dir: str | os.PathLike[str] | None = None,
    ):
        self.host = host
        self.port = port
        self.adaptive_placement = adaptive_placement
        self.redis_url = redis_url
        self.keep_artifacts = keep_artifacts
        self.log_level = log_level
        self.startup_timeout = startup_timeout
        self.runtime_dir = Path(runtime_dir).resolve() if runtime_dir else bundled_runtime_dir()
        self.process: subprocess.Popen[str] | None = None
        self.logs: list[str] = []
        self.url = ""

    def __enter__(self) -> "LocalFabricGateway":
        self.start()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.stop()

    def start(self) -> "LocalFabricGateway":
        if self.process is not None:
            return self

        ensure_node_runtime()
        entrypoint = standalone_gateway_entrypoint(self.runtime_dir)
        if not entrypoint.exists():
            raise GatewayRuntimeError(f"Bundled gateway entrypoint not found: {entrypoint}")
        ensure_runtime_dependencies(self.runtime_dir)

        selected_port = self.port if self.port is not None else find_free_port(self.host)
        self.port = selected_port
        self.url = f"http://{self.host}:{selected_port}"

        env = os.environ.copy()
        env.update(
            {
                "HOST": self.host,
                "PORT": str(selected_port),
                "LOG_LEVEL": self.log_level,
                "MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED": (
                    "true" if self.adaptive_placement else "false"
                ),
            }
        )
        if self.redis_url:
            env["REDIS_URL"] = self.redis_url

        self.process = subprocess.Popen(
            ["node", str(entrypoint)],
            cwd=str(self.runtime_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        try:
            wait_for_gateway_ready(self.client(), self.process, self.logs, self.startup_timeout)
        except Exception:
            self.stop()
            raise
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

        if process.stdout is not None:
            for line in process.stdout.readlines():
                self.logs.append(line.rstrip())
            process.stdout.close()

        self.process = None

    def client(self) -> FabricClient:
        if not self.url and self.port is not None:
            self.url = f"http://{self.host}:{self.port}"
        return FabricClient(self.url)


def ensure_node_runtime() -> None:
    node = shutil.which("node")
    if node is None:
        raise NodeRuntimeError(NODE_ERROR)

    try:
        completed = subprocess.run(
            [node, "--version"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise NodeRuntimeError(NODE_ERROR) from error

    version = completed.stdout.strip().lstrip("v")
    major_text = version.split(".", 1)[0]
    try:
        major = int(major_text)
    except ValueError as error:
        raise NodeRuntimeError(NODE_ERROR) from error
    if major < 20:
        raise NodeRuntimeError(NODE_ERROR)


def ensure_runtime_dependencies(runtime_dir: Path) -> None:
    if (runtime_dir / "node_modules" / "@modelcontextprotocol" / "sdk").exists():
        return
    if not (runtime_dir / "package-lock.json").exists():
        raise GatewayRuntimeError(
            "Bundled MCP-Fabric runtime dependencies are missing and package-lock.json "
            f"was not found in {runtime_dir}."
        )
    if shutil.which("npm") is None:
        raise GatewayRuntimeError(
            "Bundled MCP-Fabric runtime dependencies are missing. Install npm from "
            "the Node.js toolchain, then rerun your Python program. No manual npm "
            "commands are required."
        )

    completed = subprocess.run(
        ["npm", "ci", "--omit=dev"],
        cwd=str(runtime_dir),
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise GatewayRuntimeError(
            "Managed MCP-Fabric runtime dependency bootstrap failed with "
            f"exit code {completed.returncode}.\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )


def run_runtime_npm_script(
    script: str,
    *,
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    runtime_dir: str | os.PathLike[str] | None = None,
) -> int:
    ensure_node_runtime()
    resolved_runtime_dir = Path(runtime_dir).resolve() if runtime_dir else bundled_runtime_dir()
    ensure_runtime_dependencies(resolved_runtime_dir)

    command = ["npm", "run", script]
    if args:
        command.extend(["--", *args])

    completed = subprocess.run(
        command,
        cwd=str(resolved_runtime_dir),
        env={**os.environ, **(env or {})},
    )
    return int(completed.returncode)


def list_runtime_npm_scripts(
    *,
    runtime_dir: str | os.PathLike[str] | None = None,
) -> dict[str, str]:
    import json

    resolved_runtime_dir = Path(runtime_dir).resolve() if runtime_dir else bundled_runtime_dir()
    package_json = resolved_runtime_dir / "package.json"
    if not package_json.exists():
        raise GatewayRuntimeError(f"Bundled package.json not found: {package_json}")

    with package_json.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    scripts = payload.get("scripts", {})
    if not isinstance(scripts, dict):
        return {}
    return {str(name): str(command) for name, command in scripts.items()}


def find_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def wait_for_gateway_ready(
    client: FabricClient,
    process: subprocess.Popen[str],
    logs: list[str],
    timeout: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None

    while time.monotonic() < deadline:
        if process.poll() is not None:
            if process.stdout is not None:
                logs.extend(line.rstrip() for line in process.stdout.readlines())
            raise GatewayRuntimeError(
                "Local MCP-Fabric gateway exited before readiness. "
                f"Exit code: {process.returncode}. Logs: {logs[-20:]}"
            )

        try:
            health = client.health()
            if health.get("ok") is True:
                return health
        except Exception as error:
            last_error = error
        time.sleep(0.1)

    raise GatewayRuntimeError(
        f"Local MCP-Fabric gateway did not become ready within {timeout:.1f}s"
        + (f": {last_error}" if last_error else "")
    )
