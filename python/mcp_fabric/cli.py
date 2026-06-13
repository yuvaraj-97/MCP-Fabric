from __future__ import annotations

import argparse
import signal
import sys
import time

from . import __version__
from .runtime import LocalFabricGateway
from .runtime import list_runtime_npm_scripts, run_runtime_npm_script
from .validation import main as validate_main


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mcp-fabric")
    subparsers = parser.add_subparsers(dest="command", required=True)

    gateway = subparsers.add_parser("gateway")
    gateway_subparsers = gateway.add_subparsers(dest="gateway_command", required=True)
    gateway_start = gateway_subparsers.add_parser("start")
    gateway_start.add_argument("--host", default="127.0.0.1")
    gateway_start.add_argument("--port", type=int)
    gateway_start.add_argument("--adaptive-placement", action="store_true")
    gateway_start.add_argument("--redis-url")

    dashboard = subparsers.add_parser("dashboard")
    dashboard.add_argument("--host", default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=4321)

    runtime = subparsers.add_parser("runtime")
    runtime_subparsers = runtime.add_subparsers(dest="runtime_command", required=True)
    runtime_subparsers.add_parser("list-scripts")
    runtime_run = runtime_subparsers.add_parser("run")
    runtime_run.add_argument("script")
    runtime_run.add_argument("script_args", nargs=argparse.REMAINDER)

    subparsers.add_parser("test")
    subparsers.add_parser("validate")
    subparsers.add_parser("version")

    args = parser.parse_args(argv)

    if args.command == "version":
        print(__version__)
        return 0

    if args.command == "validate":
        return validate_main()

    if args.command == "dashboard":
        return run_runtime_npm_script(
            "demo",
            env={
                "HOST": args.host,
                "PORT": str(args.port),
            },
        )

    if args.command == "gateway" and args.gateway_command == "start":
        return gateway_start_foreground(args)

    if args.command == "runtime" and args.runtime_command == "list-scripts":
        for name, command in sorted(list_runtime_npm_scripts().items()):
            print(f"{name}\t{command}")
        return 0

    if args.command == "runtime" and args.runtime_command == "run":
        script_args = args.script_args
        if script_args and script_args[0] == "--":
            script_args = script_args[1:]
        return run_runtime_npm_script(args.script, args=script_args)

    if args.command == "test":
        return run_runtime_npm_script("test")

    parser.error("unsupported command")
    return 2


def gateway_start_foreground(args: argparse.Namespace) -> int:
    fabric = LocalFabricGateway(
        host=args.host,
        port=args.port,
        adaptive_placement=args.adaptive_placement,
        redis_url=args.redis_url,
    )
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        fabric.stop()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    fabric.start()
    print(f"MCP-Fabric gateway running at {fabric.url}")
    while not stopping:
        if fabric.process is not None and fabric.process.poll() is not None:
            return int(fabric.process.returncode or 0)
        time.sleep(0.25)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
