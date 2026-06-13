from __future__ import annotations

import subprocess

import pytest

from mcp_fabric.errors import GatewayRuntimeError, NodeRuntimeError
from mcp_fabric.runtime import (
    NODE_ERROR,
    ensure_node_runtime,
    ensure_runtime_dependencies,
    list_runtime_npm_scripts,
    run_runtime_npm_script,
)


def test_ensure_node_runtime_rejects_missing_node(monkeypatch):
    monkeypatch.setattr("mcp_fabric.runtime.shutil.which", lambda _name: None)

    with pytest.raises(NodeRuntimeError, match="requires Node.js >=20"):
        ensure_node_runtime()


def test_ensure_node_runtime_rejects_old_node(monkeypatch):
    monkeypatch.setattr("mcp_fabric.runtime.shutil.which", lambda _name: "/bin/node")

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(args=["node", "--version"], returncode=0, stdout="v18.0.0\n")

    monkeypatch.setattr("mcp_fabric.runtime.subprocess.run", fake_run)

    with pytest.raises(NodeRuntimeError) as error:
        ensure_node_runtime()

    assert str(error.value) == NODE_ERROR


def test_ensure_runtime_dependencies_accepts_existing_node_modules(tmp_path):
    (tmp_path / "node_modules" / "@modelcontextprotocol" / "sdk").mkdir(parents=True)

    ensure_runtime_dependencies(tmp_path)


def test_ensure_runtime_dependencies_requires_package_lock(tmp_path):
    with pytest.raises(GatewayRuntimeError, match="package-lock.json"):
        ensure_runtime_dependencies(tmp_path)


def test_ensure_runtime_dependencies_bootstraps_with_npm(monkeypatch, tmp_path):
    (tmp_path / "package-lock.json").write_text("{}", encoding="utf-8")
    calls = []
    monkeypatch.setattr("mcp_fabric.runtime.shutil.which", lambda name: "/bin/npm" if name == "npm" else None)

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(args=command, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("mcp_fabric.runtime.subprocess.run", fake_run)

    ensure_runtime_dependencies(tmp_path)

    assert calls[0][0] == ["npm", "ci", "--omit=dev"]
    assert calls[0][1]["cwd"] == str(tmp_path)


def test_list_runtime_npm_scripts_reads_bundled_package_json(tmp_path):
    (tmp_path / "package.json").write_text(
        '{"scripts":{"test":"node tests/run-tests.js"}}',
        encoding="utf-8",
    )

    assert list_runtime_npm_scripts(runtime_dir=tmp_path) == {
        "test": "node tests/run-tests.js",
    }


def test_run_runtime_npm_script_uses_managed_runtime(monkeypatch, tmp_path):
    (tmp_path / "node_modules" / "@modelcontextprotocol" / "sdk").mkdir(parents=True)
    calls = []
    monkeypatch.setattr("mcp_fabric.runtime.shutil.which", lambda name: f"/bin/{name}")

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        if command == ["/bin/node", "--version"]:
            return subprocess.CompletedProcess(args=command, returncode=0, stdout="v20.0.0\n")
        return subprocess.CompletedProcess(args=command, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("mcp_fabric.runtime.subprocess.run", fake_run)

    result = run_runtime_npm_script(
        "validate:filesystem",
        args=["--flag"],
        runtime_dir=tmp_path,
    )

    assert result == 0
    assert calls[-1][0] == ["npm", "run", "validate:filesystem", "--", "--flag"]
    assert calls[-1][1]["cwd"] == str(tmp_path)


def test_local_gateway_maps_operator_options_to_env(monkeypatch, tmp_path):
    entrypoint = tmp_path / "packages" / "gateway" / "bin" / "standalone-gateway.js"
    entrypoint.parent.mkdir(parents=True)
    entrypoint.write_text("", encoding="utf-8")
    (tmp_path / "node_modules" / "@modelcontextprotocol" / "sdk").mkdir(parents=True)
    captured = {}

    class FakeProcess:
        stdout = None

        def poll(self):
            return None

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs["env"]
        return FakeProcess()

    monkeypatch.setattr("mcp_fabric.runtime.ensure_node_runtime", lambda: None)
    monkeypatch.setattr("mcp_fabric.runtime.subprocess.Popen", fake_popen)
    monkeypatch.setattr("mcp_fabric.runtime.wait_for_gateway_ready", lambda *_args: {"ok": True})

    from mcp_fabric import LocalFabricGateway

    gateway = LocalFabricGateway(
        port=4400,
        adaptive_placement=True,
        adaptive_placement_client_allowlist=["client-a", "client-b"],
        redis_url="redis://localhost:6379/0",
        server_count=4,
        load_threshold=0.6,
        auto_scale_threshold=0.9,
        session_ttl_ms=1000,
        reconnect_grace_ms=2000,
        on_disconnect="queue",
        allow_public_bind=True,
        enforce_startup_security_audit=False,
        session_registry_backend="redis",
        session_registry_file="/tmp/sessions.json",
        session_registry_redis_key="custom:key",
        server_instances=[{"serverInstanceId": "a"}],
        remote_base_urls={"a": "http://127.0.0.1:4100"},
        env={"CUSTOM_RUNTIME_FLAG": "1"},
        runtime_dir=tmp_path,
    )
    gateway.start()

    env = captured["env"]
    assert env["CUSTOM_RUNTIME_FLAG"] == "1"
    assert env["PORT"] == "4400"
    assert env["MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED"] == "true"
    assert env["MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST"] == "client-a,client-b"
    assert env["REDIS_URL"] == "redis://localhost:6379/0"
    assert env["MCP_GATEWAY_SESSION_REGISTRY_REDIS_URL"] == "redis://localhost:6379/0"
    assert env["MCP_GATEWAY_DEFAULT_SERVER_COUNT"] == "4"
    assert env["MCP_GATEWAY_LOAD_THRESHOLD"] == "0.6"
    assert env["MCP_GATEWAY_AUTOSCALE_THRESHOLD"] == "0.9"
    assert env["MCP_GATEWAY_SESSION_TTL_MS"] == "1000"
    assert env["MCP_GATEWAY_RECONNECT_GRACE_MS"] == "2000"
    assert env["MCP_GATEWAY_ON_DISCONNECT"] == "queue"
    assert env["MCP_GATEWAY_ALLOW_PUBLIC_BIND"] == "true"
    assert env["MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT"] == "false"
    assert env["MCP_GATEWAY_SESSION_REGISTRY_BACKEND"] == "redis"
    assert env["MCP_GATEWAY_SESSION_REGISTRY_FILE"] == "/tmp/sessions.json"
    assert env["MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY"] == "custom:key"
    assert env["SERVER_INSTANCES_JSON"] == '[{"serverInstanceId": "a"}]'
    assert env["REMOTE_BASE_URLS_JSON"] == '{"a": "http://127.0.0.1:4100"}'
