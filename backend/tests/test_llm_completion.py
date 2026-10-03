"""Task 03: incomplete provider output must never become a warehouse action."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.agent_contract import tool_schemas
from app.llm import LLMProviderError, OpenAICompatibleProvider
from app.main import create_app


def response(reason):
    return {"choices": [{"finish_reason": reason, "message": {
        "tool_calls": [{"function": {"name": "update_stock", "arguments":
            json.dumps({"item_id": 1, "delta": -40})}}],
    }}]}


@pytest.mark.parametrize("reason", ["length", "content_filter", None, "unknown", []])
def test_incomplete_completion_rejected_even_with_valid_arguments(monkeypatch, reason):
    provider = OpenAICompatibleProvider("fake-key")
    monkeypatch.setattr(provider, "_post_json", lambda _: response(reason))
    with pytest.raises(LLMProviderError):
        asyncio.run(provider.interpret("wzięliśmy paletę kartonów", tool_schemas()))


@pytest.mark.parametrize("reason", ["stop", "tool_calls"])
def test_completed_response_accepted(monkeypatch, reason):
    provider = OpenAICompatibleProvider("fake-key")
    monkeypatch.setattr(provider, "_post_json", lambda _: response(reason))
    result = asyncio.run(provider.interpret("pobraliśmy czterdzieści kartonów", tool_schemas()))
    assert result.tool_call.arguments["delta"] == -40


def test_compatible_endpoint_can_omit_finish_reason(monkeypatch):
    provider = OpenAICompatibleProvider("fake-key")
    payload = response("tool_calls")
    del payload["choices"][0]["finish_reason"]
    monkeypatch.setattr(provider, "_post_json", lambda _: payload)
    assert asyncio.run(provider.interpret("komenda", tool_schemas())).tool_call is not None


def test_refusal_never_becomes_a_tool_call(monkeypatch):
    provider = OpenAICompatibleProvider("fake-key")
    payload = response("tool_calls")
    payload["choices"][0]["message"]["refusal"] = "Request refused"
    monkeypatch.setattr(provider, "_post_json", lambda _: payload)
    with pytest.raises(LLMProviderError):
        asyncio.run(provider.interpret("wzięliśmy paletę kartonów", tool_schemas()))


def test_truncated_response_uses_offline_without_writing(monkeypatch, tmp_path):
    monkeypatch.setenv("DEMO_MODE", "0")
    monkeypatch.setenv("LLM_API_KEY", "fake-key")
    monkeypatch.setenv("LLM_MODE", "llm")
    monkeypatch.setattr(OpenAICompatibleProvider, "_post_json", lambda *_: response("length"))
    with TestClient(create_app(str(tmp_path / "stock.db"))) as client:
        data = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"}).json()
        assert data["proposal"]["delta"] == -2
        assert "offline" in data["warning"]
        assert client.get("/api/history").json()["entries"] == []
        items = client.get("/api/stock").json()["items"]
        assert next(item for item in items if item["name"] == "Kartony")["quantity"] == 54
