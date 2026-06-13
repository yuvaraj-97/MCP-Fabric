from __future__ import annotations

import os
import json
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .client import FabricClient
from .errors import GatewayRuntimeError, NodeRuntimeError
from .paths import bundled_runtime_dir, standalone_gateway_entrypoint

NODE_ERROR = """Local MCP-Fabric runtime requires Node.js >=20.
Install Node.js, then rerun your Python program.
No manual npm commands are required."""

GATEWAY_DEFAULTS = {
    "server_count": 3,
    "load_threshold": 0.7,
    "auto_scale_threshold": 0.8,
    "session_ttl_ms": 300_000,
    "reconnect_grace_ms": 30_000,
    "on_disconnect": "cancel",
    "allow_public_bind": False,
    "enforce_startup_security_audit": True,
    "session_registry_backend": "memory",
    "session_registry_file": None,
    "session_registry_redis_key": "mcp:gateway:sessions",
    "server_instances": "built-in self-contained demo fleet",
    "remote_base_urls": None,
}


class LocalFabricGateway:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int | None = None,
        adaptive_placement: bool = False,
        adaptive_placement_client_allowlist: list[str] | str | None = None,
        redis_url: str | None = None,
        server_count: int | None = None,
        load_threshold: float | None = None,
        auto_scale_threshold: float | None = None,
        session_ttl_ms: int | None = None,
        reconnect_grace_ms: int | None = None,
        on_disconnect: str | None = None,
        allow_public_bind: bool | None = None,
        enforce_startup_security_audit: bool | None = None,
        session_registry_backend: str | None = None,
        session_registry_file: str | None = None,
        session_registry_redis_key: str | None = None,
        server_instances: list[dict[str, Any]] | None = None,
        remote_base_urls: dict[str, str] | None = None,
        env: dict[str, str] | None = None,
        print_config: bool = True,
        keep_artifacts: bool = False,
        log_level: str = "info",
        startup_timeout: float = 10.0,
        runtime_dir: str | os.PathLike[str] | None = None,
    ):
        self.host = host
        self.port = port
        self.adaptive_placement = adaptive_placement
        self.adaptive_placement_client_allowlist = adaptive_placement_client_allowlist
        self.redis_url = redis_url
        self.server_count = server_count
        self.load_threshold = load_threshold
        self.auto_scale_threshold = auto_scale_threshold
        self.session_ttl_ms = session_ttl_ms
        self.reconnect_grace_ms = reconnect_grace_ms
        self.on_disconnect = on_disconnect
        self.allow_public_bind = allow_public_bind
        self.enforce_startup_security_audit = enforce_startup_security_audit
        self.session_registry_backend = session_registry_backend
        self.session_registry_file = session_registry_file
        self.session_registry_redis_key = session_registry_redis_key
        self.server_instances = server_instances
        self.remote_base_urls = remote_base_urls
        self.env = env or {}
        self.print_config = print_config
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

        requested_port = self.port
        selected_port = requested_port if requested_port is not None else find_free_port(self.host)
        self.port = selected_port
        self.url = f"http://{self.host}:{selected_port}"
        if self.print_config:
            print_runtime_config(
                "http-sse",
                {
                    "host": report_value(self.host, "default"),
                    "port": report_value(selected_port, "user" if requested_port is not None else "auto"),
                    "adaptive_placement": report_value(self.adaptive_placement, "user" if self.adaptive_placement else "default"),
                    "adaptive_placement_client_allowlist": report_value(self.adaptive_placement_client_allowlist, "user" if self.adaptive_placement_client_allowlist is not None else "default"),
                    "redis_url": report_value(redact(self.redis_url), "user" if self.redis_url else "default"),
                    "server_count": defaulted_report(self.server_count, "server_count"),
                    "load_threshold": defaulted_report(self.load_threshold, "load_threshold"),
                    "auto_scale_threshold": defaulted_report(self.auto_scale_threshold, "auto_scale_threshold"),
                    "session_ttl_ms": defaulted_report(self.session_ttl_ms, "session_ttl_ms"),
                    "reconnect_grace_ms": defaulted_report(self.reconnect_grace_ms, "reconnect_grace_ms"),
                    "on_disconnect": defaulted_report(self.on_disconnect, "on_disconnect"),
                    "allow_public_bind": defaulted_report(self.allow_public_bind, "allow_public_bind"),
                    "enforce_startup_security_audit": defaulted_report(self.enforce_startup_security_audit, "enforce_startup_security_audit"),
                    "session_registry_backend": defaulted_report(self.session_registry_backend, "session_registry_backend"),
                    "session_registry_file": defaulted_report(self.session_registry_file, "session_registry_file"),
                    "session_registry_redis_key": defaulted_report(self.session_registry_redis_key, "session_registry_redis_key"),
                    "server_instances": defaulted_report(self.server_instances, "server_instances"),
                    "remote_base_urls": defaulted_report(self.remote_base_urls, "remote_base_urls"),
                    "env": report_value(redact_mapping(self.env), "user" if self.env else "default"),
                    "runtime_dir": report_value(str(self.runtime_dir), "resolved"),
                },
            )

        env = {**os.environ, **self.env}
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
        put_optional_env(env, "MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST", format_allowlist(self.adaptive_placement_client_allowlist))
        put_optional_env(env, "MCP_GATEWAY_DEFAULT_SERVER_COUNT", self.server_count)
        put_optional_env(env, "MCP_GATEWAY_LOAD_THRESHOLD", self.load_threshold)
        put_optional_env(env, "MCP_GATEWAY_AUTOSCALE_THRESHOLD", self.auto_scale_threshold)
        put_optional_env(env, "MCP_GATEWAY_SESSION_TTL_MS", self.session_ttl_ms)
        put_optional_env(env, "MCP_GATEWAY_RECONNECT_GRACE_MS", self.reconnect_grace_ms)
        put_optional_env(env, "MCP_GATEWAY_ON_DISCONNECT", self.on_disconnect)
        put_optional_env(env, "MCP_GATEWAY_ALLOW_PUBLIC_BIND", self.allow_public_bind)
        put_optional_env(env, "MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT", self.enforce_startup_security_audit)
        put_optional_env(env, "MCP_GATEWAY_SESSION_REGISTRY_BACKEND", self.session_registry_backend)
        put_optional_env(env, "MCP_GATEWAY_SESSION_REGISTRY_FILE", self.session_registry_file)
        put_optional_env(env, "MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY", self.session_registry_redis_key)
        put_optional_env(env, "SERVER_INSTANCES_JSON", json.dumps(self.server_instances) if self.server_instances is not None else None)
        put_optional_env(env, "REMOTE_BASE_URLS_JSON", json.dumps(self.remote_base_urls) if self.remote_base_urls is not None else None)
        if self.redis_url:
            env["REDIS_URL"] = self.redis_url
            env["MCP_GATEWAY_SESSION_REGISTRY_REDIS_URL"] = self.redis_url

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


def put_optional_env(env: dict[str, str], name: str, value: object | None) -> None:
    if value is None:
        return
    if isinstance(value, bool):
        env[name] = "true" if value else "false"
        return
    env[name] = str(value)


def format_allowlist(value: list[str] | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return ",".join(value)


def report_value(value: object, source: str) -> dict[str, object]:
    return {"value": value, "source": source}


def defaulted_report(value: object | None, default_key: str) -> dict[str, object]:
    if value is not None:
        return report_value(value, "user")
    return report_value(GATEWAY_DEFAULTS[default_key], "runtime-default")


def print_runtime_config(transport: str, config: dict[str, object]) -> None:
    print(
        "[mcp-fabric] local runtime configuration "
        + json.dumps({"transport": transport, "config": config}, sort_keys=True),
        file=sys.stderr,
    )


def redact(value: object) -> object:
    if value is None:
        return None
    return "<redacted>"


def redact_mapping(values: dict[str, str]) -> dict[str, str]:
    redacted = {}
    for key, value in values.items():
        upper_key = key.upper()
        if any(token in upper_key for token in ("TOKEN", "PASSWORD", "SECRET", "KEY", "AUTH")):
            redacted[key] = "<redacted>"
        else:
            redacted[key] = value
    return redacted


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
