"""Start the prepared Next.js demo locally, with no cloud database or AI APIs."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys


REPO = Path(__file__).resolve().parents[1]


def demo_environment(repo: Path, inherited: dict[str, str]) -> dict[str, str]:
    env = dict(inherited)
    # Explicit empty values also override .env.local loaded by Next.js and tsx scripts.
    for key in ("DATABASE_URL", "POSTGRES_URL", "DEMO_DATABASE_URL", "VERCEL",
                "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "STT_API_KEY",
                "LLM_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL",
                "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"):
        env[key] = ""
    env.update(DEMO_MODE="1", LLM_MODE="offline", AUTH_DISABLED="1",
               PGLITE_DEMO_DIR=str((repo / "data/pglite-demo").resolve()))
    return env


def port_available(port: int) -> bool:
    try:
        with socket.socket() as probe:
            if os.name == "nt":
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            probe.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="Prepare the production build before starting (may require internet)")
    parser.add_argument("--reset", action="store_true", help="Reset only the marked demo database before starting")
    parser.add_argument("--port", type=int, default=3002)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        print("Missing npm. Install Node.js and run npm ci while online first.", file=sys.stderr)
        return 1
    if not args.build and not (REPO / ".next/BUILD_ID").is_file():
        print("Missing production build. Run this launcher with --build while online first. No data was reset.", file=sys.stderr)
        return 1
    if not port_available(args.port):
        print(f"Port {args.port} is already in use. Stop the previous demo or choose --port. No data was reset.", file=sys.stderr)
        return 1
    env = demo_environment(REPO, os.environ)
    command = ["cmd.exe", "/d", "/c", npm] if os.name == "nt" else [npm]
    server = None
    try:
        if args.build and subprocess.run([*command, "run", "build"], cwd=REPO, env=env, check=False).returncode:
            return 1
        if args.reset and subprocess.run([*command, "run", "demo:reset"], cwd=REPO, env=env, check=False).returncode:
            return 1
        print(f"Offline demo: http://127.0.0.1:{args.port} — text commands, local data/pglite-demo. Ctrl+C to stop.", flush=True)
        options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
        server = subprocess.Popen([*command, "run", "start", "--", "--hostname", "127.0.0.1", "--port", str(args.port)], cwd=REPO, env=env, **options)
        return server.wait()
    except KeyboardInterrupt:
        return 0
    except OSError as error:
        print(f"Could not start demo: {error}", file=sys.stderr)
        return 1
    finally:
        if server is not None and server.poll() is None:
            # npm starts a child Node process; stop only this launcher's process tree.
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                import signal
                os.killpg(server.pid, signal.SIGTERM)
            server.wait()


if __name__ == "__main__":
    raise SystemExit(main())
