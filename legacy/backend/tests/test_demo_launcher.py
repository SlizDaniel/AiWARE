"""Local rehearsal guards are checked without launching or resetting anything."""
from pathlib import Path
import runpy

import pytest


def test_missing_build_blocks_reset_and_start(monkeypatch, capsys):
    script = runpy.run_path(str(Path(__file__).parents[2] / "scripts/start-demo-local.py"))
    namespace = script["main"].__globals__
    monkeypatch.setattr(Path, "is_file", lambda path: path.name != "index.html")
    monkeypatch.setattr("sys.argv", ["start-demo-local.py", "--built", "--reset"])
    monkeypatch.setattr(namespace["shutil"], "which", lambda _: "prepared-node")

    def forbidden(*args, **kwargs):
        pytest.fail("Missing build must block all process launches and database resets")

    monkeypatch.setattr(namespace["subprocess"], "run", forbidden)
    monkeypatch.setattr(namespace["subprocess"], "Popen", forbidden)
    assert script["main"]() == 1
    assert "Demo data was not reset" in capsys.readouterr().err
