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
