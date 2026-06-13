from __future__ import annotations

import os
from typing import Any, Literal

from .runtime import LocalFabricGateway
from .stdio import LocalStdioServer

TransportName = Literal["http-sse", "stdio"]


class LocalFabric:
    def __init__(
        self,
        *,
        transport: TransportName = "http-sse",
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
        server_instance_id: str = "stdio-server-1",
        keep_artifacts: bool = False,
        log_level: str = "info",
        startup_timeout: float = 10.0,
        runtime_dir: str | os.PathLike[str] | None = None,
    ):
        if transport not in ("http-sse", "stdio"):
            raise ValueError("transport must be 'http-sse' or 'stdio'")

        self.transport = transport
        if transport == "http-sse":
            self._runtime = LocalFabricGateway(
                host=host,
                port=port,
                adaptive_placement=adaptive_placement,
                adaptive_placement_client_allowlist=adaptive_placement_client_allowlist,
                redis_url=redis_url,
                server_count=server_count,
                load_threshold=load_threshold,
                auto_scale_threshold=auto_scale_threshold,
                session_ttl_ms=session_ttl_ms,
                reconnect_grace_ms=reconnect_grace_ms,
                on_disconnect=on_disconnect,
                allow_public_bind=allow_public_bind,
                enforce_startup_security_audit=enforce_startup_security_audit,
                session_registry_backend=session_registry_backend,
                session_registry_file=session_registry_file,
                session_registry_redis_key=session_registry_redis_key,
                server_instances=server_instances,
                remote_base_urls=remote_base_urls,
                env=env,
                print_config=print_config,
                keep_artifacts=keep_artifacts,
                log_level=log_level,
                startup_timeout=startup_timeout,
                runtime_dir=runtime_dir,
            )
        else:
            self._runtime = LocalStdioServer(
                server_instance_id=server_instance_id,
                env=env,
                print_config=print_config,
                runtime_dir=runtime_dir,
            )

    def __enter__(self) -> "LocalFabric":
        self.start()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.stop()

    def start(self) -> "LocalFabric":
        self._runtime.start()
        return self

    def stop(self) -> None:
        self._runtime.stop()

    def client(self):
        return self._runtime.client()

    @property
    def url(self) -> str | None:
        return getattr(self._runtime, "url", None) or None

    @property
    def logs(self) -> list[str]:
        return getattr(self._runtime, "logs", [])
