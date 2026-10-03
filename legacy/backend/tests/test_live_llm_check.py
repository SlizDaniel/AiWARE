"""Read-only live checker is tested with controlled providers, never real API calls."""
import asyncio
from pathlib import Path
import runpy

import pytest

from app import db
from app.llm import Interpretation, ToolCall


@pytest.fixture
def checker(monkeypatch):
    script = runpy.run_path(str(Path(__file__).parents[2] / "scripts/check-live-llm.py"))
    namespace = script["check"].__globals__

    def forbidden(*args, **kwargs):
        pytest.fail("Read-only LLM check must not open SQLite")

    monkeypatch.setattr(db, "connect", forbidden)
    return namespace


def supply(monkeypatch, checker, results):
    class Provider:
        async def interpret(self, *args):
            return next(results)

    monkeypatch.setitem(checker, "provider_from_env", lambda: Provider())


def valid_results():
    return [
        Interpretation(tool_call=ToolCall("update_stock", {"item_id": 3, "delta": -4})),
        Interpretation(tool_call=ToolCall("get_stock", {"item_id": 1})),
        Interpretation(tool_call=ToolCall("get_location", {"item_id": 2})),
    ]


def test_expected_intents_pass_without_database(monkeypatch, checker, capsys):
    supply(monkeypatch, checker, iter(valid_results()))
    assert asyncio.run(checker["check"]()) == 0
    assert "3 matched tool calls" in capsys.readouterr().out


@pytest.mark.parametrize("call", [
    ToolCall("get_stock", {"item_id": 3}),
    ToolCall("update_stock", {"item_id": 1, "delta": -4}),
    ToolCall("update_stock", {"item_id": 3, "delta": 4}),
    ToolCall("update_stock", {"item_id": 3, "delta": -40}),
])
def test_valid_but_wrong_intent_fails(monkeypatch, checker, call):
    supply(monkeypatch, checker, iter([Interpretation(tool_call=call)]))
    assert asyncio.run(checker["check"]()) == 1


def test_clarifications_are_counted_for_manual_review(monkeypatch, checker, capsys):
    supply(monkeypatch, checker, iter([Interpretation(clarification="Który towar?")] * 3))
    assert asyncio.run(checker["check"]()) == 0
    assert "3 clarifications require manual review" in capsys.readouterr().out


def test_demo_guard_blocks_provider(monkeypatch, checker, tmp_path):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setenv("LLM_API_KEY", "fake-secret")
    monkeypatch.setattr("sys.argv", ["check-live-llm.py", "--env-file", str(tmp_path / "missing.env")])
    monkeypatch.setitem(checker, "provider_from_env", lambda: pytest.fail("Demo must not call the provider"))
    assert checker["main"]() == 2
