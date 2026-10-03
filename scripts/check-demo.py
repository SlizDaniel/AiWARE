"""Run existing automated demo checks without touching the running warehouse."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


def run(label: str, command: list[str], directory: Path, env: dict[str, str]) -> bool:
    print(f"\n--- {label} ---", flush=True)
    try:
        return subprocess.run(command, cwd=directory, env=env, check=False).returncode == 0
    except OSError as exc:
        print(f"Could not start {label}: {exc}", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", action="store_true", help="Also require Docker configuration and daemon checks")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    backend = repo / "backend"
    venv_python = backend / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    python = str(venv_python) if venv_python.is_file() else sys.executable
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        print("Missing npm: install Node.js and prepare frontend dependencies before this check.", file=sys.stderr)
        return 1
    docker = shutil.which("docker") if args.docker else None
    if args.docker and not docker:
        print("Missing Docker CLI; use the default check for local development.", file=sys.stderr)
        return 1

    # Normal test fixtures use temporary databases; demo fixtures enable demo themselves.
    # Inherited presentation settings or real API keys must not affect the checks.
    env = {**os.environ, "DEMO_MODE": "0", "LLM_MODE": "offline", "LLM_API_KEY": "", "STT_API_KEY": ""}
    if not run("Backend contracts, demo, import/export, LLM and STT", [python, "-m", "pytest", "-q"], backend, env):
        print("Prepare backend development dependencies first if pytest is unavailable.", file=sys.stderr)
        return 1
    npm_command = ["cmd.exe", "/d", "/c", npm] if os.name == "nt" else [npm]
    if not run("Frontend typecheck and production build", [*npm_command, "run", "build"], repo / "frontend", env):
        return 1
    node = shutil.which("node")
    if not node or not run("Map zone matching and procedure search", [node, "--test", "src/components/zoneItems.test.mjs", "src/components/procedures.test.mjs"], repo / "frontend", env):
        return 1
    if docker:
        compose = [docker, "compose", "-f", str(repo / "docker-compose.yml"), "-f", str(repo / "docker-compose.demo.yml")]
        if not run("Demo Compose configuration", [*compose, "config", "--quiet"], repo, env):
            return 1
        if not run("Docker daemon", [docker, "info", "--format", "{{.ServerVersion}}"], repo, env):
            return 1
    print("\nAutomated checks PASSED. No running warehouse data was reset.")
    print("Still required: manual GUI rehearsal, live LLM/STT check, and running prepared Docker images offline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
