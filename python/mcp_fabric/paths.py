from __future__ import annotations

from pathlib import Path


def package_root() -> Path:
    return Path(__file__).resolve().parent


def bundled_runtime_dir() -> Path:
    bundled = package_root() / "_bundled"
    if (bundled / "packages" / "gateway" / "bin" / "standalone-gateway.js").exists():
        return bundled

    source_root = package_root().parents[1]
    if (source_root / "packages" / "gateway" / "bin" / "standalone-gateway.js").exists():
        return source_root

    return bundled


def standalone_gateway_entrypoint(runtime_dir: Path | None = None) -> Path:
    root = runtime_dir or bundled_runtime_dir()
    return root / "packages" / "gateway" / "bin" / "standalone-gateway.js"
