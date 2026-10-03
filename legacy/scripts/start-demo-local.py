"""Task 13: run an isolated offline rehearsal without Docker or downloads."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


def require_free_port(port: int) -> None:
    with socket.socket() as listener:
        if os.name == 'nt':
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind(('127.0.0.1', port))


def wait_ready(url: str, processes: list[subprocess.Popen]) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError('Demo process exited during startup; see its output above.')
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError):
            pass
        time.sleep(0.2)
    raise RuntimeError(f'Demo did not become ready: {url}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset', action='store_true', help='Reset only the local demo database before startup')
    parser.add_argument('--built', action='store_true', help='Serve an existing frontend build instead of the development server')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    backend = repo / 'backend'
    python = backend / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    vite = repo / 'frontend/node_modules/vite/bin/vite.js'
    node = shutil.which('node')
    if not python.is_file() or not vite.is_file() or not node:
        print('Prepare backend .venv and frontend node_modules using README first. No dependencies were downloaded.', file=sys.stderr)
        return 1
    if args.built and not (repo / 'frontend/dist/index.html').is_file():
        print('Missing frontend build. Run npm run build in frontend before this rehearsal. Demo data was not reset.', file=sys.stderr)
        return 1
    processes: list[subprocess.Popen] = []
    env = {**os.environ, 'DEMO_MODE': '1', 'LLM_MODE': 'mock',
           'LLM_API_KEY': '', 'STT_API_KEY': '',
           'DEMO_DB': str(backend / 'magazyn-demo-local.db')}
    # No reload: keep the owned process tree small and predictable.
    process_options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    try:
        # Refuse occupied ports before resetting any rehearsal data.
        for port in (8001, 5174):
            require_free_port(port)
        if args.reset:
            subprocess.run([str(python), '-m', 'app.demo', '--reset'], cwd=backend,
                           env=env, check=True, **process_options)
        processes.append(subprocess.Popen(
            [str(python), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001'],
            cwd=backend, env=env, **process_options))
        wait_ready('http://127.0.0.1:8001/api/health', processes)
        processes.append(subprocess.Popen(
            [node, str(vite), *(['preview'] if args.built else []), '--config', 'vite.demo.config.ts'],
            cwd=repo / 'frontend', env=env, **process_options))
        wait_ready('http://127.0.0.1:5174', processes)
        print('\nOffline demo: http://127.0.0.1:5174', flush=True)
        print('Frontend: existing build (no hot reload)' if args.built else 'Frontend: development server', flush=True)
        print(f'Import file: {repo / "demo-offline.xlsx"}', flush=True)
        print('Text commands replace voice. Ctrl+C stops both demo servers. Next rehearsal: --reset.', flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        raise RuntimeError('A demo server stopped unexpectedly.')
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f'Local demo FAILED: {exc}', file=sys.stderr)
        return 1
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                if os.name == 'nt':
                    # Windows venv redirectors and Vite helpers are child processes.
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   check=False, **process_options)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    raise SystemExit(main())
