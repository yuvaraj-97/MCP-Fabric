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
    gateway_start.add_argument("--env", action="append", default=[], metavar="KEY=VALUE")

    dashboard = subparsers.add_parser("dashboard")
    dashboard.add_argument("--host", default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=4321)
    dashboard.add_argument("--env", action="append", default=[], metavar="KEY=VALUE")

    runtime = subparsers.add_parser("runtime")
    runtime_subparsers = runtime.add_subparsers(dest="runtime_command", required=True)
    runtime_subparsers.add_parser("list-scripts")
    runtime_run = runtime_subparsers.add_parser("run")
    runtime_run.add_argument("script")
    runtime_run.add_argument("--env", action="append", default=[], metavar="KEY=VALUE")
    runtime_run.add_argument("script_args", nargs=argparse.REMAINDER)

    subparsers.add_parser("test")
    subparsers.add_parser("validate")
    subparsers.add_parser("version")
    analyze = subparsers.add_parser("analyze")
    analyze.add_argument("path", nargs="?", default=".")

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
                **parse_env_pairs(args.env),
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
        return run_runtime_npm_script(
            args.script,
            args=script_args,
            env=parse_env_pairs(args.env),
        )

    if args.command == "test":
        return run_runtime_npm_script("test")

    if args.command == "analyze":
        return run_analysis(args.path)

    parser.error("unsupported command")
    return 2


def gateway_start_foreground(args: argparse.Namespace) -> int:
    fabric = LocalFabricGateway(
        host=args.host,
        port=args.port,
        adaptive_placement=args.adaptive_placement,
        redis_url=args.redis_url,
        env=parse_env_pairs(args.env),
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


def parse_env_pairs(pairs: list[str]) -> dict[str, str]:
    parsed = {}
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"--env must be KEY=VALUE, got: {pair}")
        key, value = pair.split("=", 1)
        key = key.strip()
        if not key:
            raise SystemExit("--env key must not be empty")
        parsed[key] = value
    return parsed


def run_analysis(path: str = ".") -> int:
    import os
    import re

    print("==============================================================================")
    print("                         MCP-FABRIC MIGRATION ANALYZER                        ")
    print("==============================================================================")
    print(f"Scanning directory: {os.path.abspath(path)}")

    extensions = (".py", ".js", ".ts", ".json")
    findings = []

    patterns = {
        "initialize_dep": (re.compile(r'\binitialize\b|\binitialized\b', re.IGNORECASE), "Legacy initialize/initialized handshakes are obsolete in MCP 2026-07-28."),
        "session_id_dep": (re.compile(r'Mcp-Session-Id|\bsessionId\b', re.IGNORECASE), "Mcp-Session-Id / sessionId detected. Consider migrating to explicit state handles (e.g., browser_id, sandbox_id)."),
        "session_browser": (re.compile(r'\bsession\.browser\b'), "session.browser usage should be migrated to browser_id workload handle"),
        "session_shell": (re.compile(r'\bsession\.shell\b'), "session.shell usage should be migrated to shell_id workload handle"),
        "session_transaction": (re.compile(r'\bsession\.transaction\b'), "session.transaction usage should be migrated to transaction_id workload handle"),
        "modern_handles": (re.compile(r'\b(browser_id|sandbox_id|shell_id|transaction_id|workspace_id)\b'), "Stateless workload affinity handle detected")
    }

    file_count = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".venv", "__pycache__", "build", "dist", ".pytest_cache")]
        for file in files:
            if file.endswith(extensions):
                file_count += 1
                filepath = os.path.join(root, file)
                is_fabric_compat = any(dir_name in filepath for dir_name in ["packages/core", "packages/transports", "packages/gateway"])
                try:
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        for line_num, line in enumerate(f, 1):
                            for name, (pattern, msg) in patterns.items():
                                if pattern.search(line):
                                    if is_fabric_compat:
                                        category = "legitimate legacy compatibility code inside MCP-Fabric"
                                    elif name == "modern_handles":
                                        category = "already-compatible modern usage"
                                    elif name == "initialize_dep":
                                        category = "legacy protocol dependency"
                                    elif name in ["session_browser", "session_shell", "session_transaction"]:
                                        category = "likely explicit workload handle candidate"
                                    else:
                                        category = "application state hidden in MCP session"

                                    findings.append({
                                        "file": filepath,
                                        "line": line_num,
                                        "content": line.strip(),
                                        "message": msg,
                                        "category": category
                                    })
                except Exception:
                    pass

    print(f"Scanned {file_count} files.")
    if not findings:
        print("\n[SUCCESS] No deprecated MCP capabilities or legacy session assumptions found.")
        return 0

    categories = [
        "legitimate legacy compatibility code inside MCP-Fabric",
        "legacy protocol dependency",
        "application state hidden in MCP session",
        "likely explicit workload handle candidate",
        "already-compatible modern usage"
    ]

    for cat in categories:
        cat_findings = [f for f in findings if f["category"] == cat]
        if cat_findings:
            print(f"\nCategory: {cat.upper()}")
            print("------------------------------------------------------------------------------")
            for idx, f in enumerate(cat_findings, 1):
                print(f"  [{idx}] File: {f['file']}:{f['line']}")
                print(f"      Line: {f['content']}")
                print(f"      Details: {f['message']}")
            print("------------------------------------------------------------------------------")

    print("\nRecommendation: Transition to stateless MCP 2026-07-28 with explicit state handles.")
    print("==============================================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
