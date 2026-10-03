"""Provider contract tests: no API key, network, or inventory writes required."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.llm import LLMProviderError, OpenAICompatibleProvider, ToolCall
from app.main import create_app


TOOLS = [{
    "type": "function",
    "function": {
        "name": "update_stock",
        "parameters": {
            "type": "object",
            "properties": {
                "item_id": {"type": "integer", "minimum": 1},
                "delta": {"type": "integer", "minimum": -1000, "maximum": 1000},
            },
            "required": ["item_id", "delta"],
            "additionalProperties": False,
        },
    },
}]


def interpret(monkeypatch, message, tools=TOOLS):
    provider = OpenAICompatibleProvider("fake-key")
    monkeypatch.setattr(provider, "_post_json", lambda _: {"choices": [{"message": message}]})
    return asyncio.run(provider.interpret("pobraliśmy cztery kartony", tools))


def call_message(arguments, name="update_stock"):
    return {"tool_calls": [{"function": {"name": name, "arguments": json.dumps(arguments)}}]}


def test_valid_call_is_returned_without_execution(monkeypatch):
    result = interpret(monkeypatch, call_message({"item_id": 1, "delta": -4}))
    assert result.tool_call == ToolCall("update_stock", {"item_id": 1, "delta": -4})
    assert result.clarification is None


def test_clarification_is_returned_without_a_tool(monkeypatch):
    result = interpret(monkeypatch, {"content": "  Ile kartonów pobrano?  "})
    assert result.tool_call is None
    assert result.clarification == "Ile kartonów pobrano?"


@pytest.mark.parametrize("message", [
    None, [], "wrong shape", {}, {"content": " "},
    {"tool_calls": "wrong type"}, {"tool_calls": 4},
    {"tool_calls": [None]},
    {"tool_calls": [{"function": {"name": "update_stock", "arguments": "{broken"}}]},
    {"tool_calls": [{}, {}]},
    call_message({"item_id": 1, "delta": -4}, "unregistered_tool"),
])
def test_bad_response_raises_fallback_error_instead_of_crashing(monkeypatch, message):
    with pytest.raises(LLMProviderError):
        interpret(monkeypatch, message)


@pytest.mark.parametrize("arguments", [
    [], {"item_id": 1}, {"item_id": True, "delta": -4},
    {"item_id": 1, "delta": "-4"}, {"item_id": 0, "delta": -4},
    {"item_id": 1, "delta": -1001}, {"item_id": 1, "delta": 1001},
    {"item_id": 1, "delta": -4, "execute_without_confirmation": True},
])
def test_invalid_arguments_are_rejected(monkeypatch, arguments):
    with pytest.raises(LLMProviderError):
        interpret(monkeypatch, call_message(arguments))


def test_nested_objects_and_array_items_are_validated(monkeypatch):
    tools = [{"type": "function", "function": {
        "name": "update_stock",
        "parameters": {
            "type": "object", "required": ["changes"], "additionalProperties": False,
            "properties": {"changes": {
                "type": "array", "minItems": 1,
                "items": {
                    "type": "object", "required": ["action"], "additionalProperties": False,
                    "properties": {"action": {"type": "string", "enum": ["take", "receive"]}},
                },
            }},
        },
    }}]
    result = interpret(monkeypatch, call_message({"changes": [{"action": "take"}]}), tools)
    assert result.tool_call.arguments == {"changes": [{"action": "take"}]}
    for arguments in ({"changes": []}, {"changes": [{"action": "delete"}]}, {"changes": [4]}):
        with pytest.raises(LLMProviderError):
            interpret(monkeypatch, call_message(arguments), tools)


def test_transport_failure_becomes_fallback_error(monkeypatch):
    provider = OpenAICompatibleProvider("fake-key")

    def fail(_):
        raise TimeoutError("timeout")

    monkeypatch.setattr(provider, "_post_json", fail)
    with pytest.raises(LLMProviderError):
        asyncio.run(provider.interpret("pobraliśmy kartony", TOOLS))


def test_invalid_llm_response_falls_back_to_offline_proposal(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_API_KEY", "fake-key")
    monkeypatch.setenv("LLM_MODE", "llm")
    monkeypatch.setattr(OpenAICompatibleProvider, "_post_json", lambda *_: {"choices": [{"message": None}]})
    with TestClient(create_app(str(tmp_path / "stock.db"))) as client:
        response = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"})
        assert response.status_code == 200
        data = response.json()
        assert data["proposal"]["delta"] == -2
        assert "offline" in data["warning"]
        assert client.get("/api/history").json()["entries"] == []
        items = client.get("/api/stock").json()["items"]
        assert next(item for item in items if item["id"] == data["proposal"]["item_id"])["quantity"] == 54


def test_mode_switch_and_missing_key_never_call_external_provider(monkeypatch, tmp_path):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_MODE", "llm")

    def unexpected_network(*_):
        pytest.fail("Offline commands must never call the LLM endpoint")

    monkeypatch.setattr(OpenAICompatibleProvider, "_post_json", unexpected_network)
    with TestClient(create_app(str(tmp_path / "stock.db"))) as client:
        assert client.get("/api/agent-mode").json()["effective_mode"] == "offline"
        assert client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"}).json()["type"] == "proposal"
        for mode in ("offline", "mock"):
            status = client.put("/api/agent-mode", json={"mode": mode})
            assert status.status_code == 200
            assert status.json()["mode"] == mode
            assert client.post("/api/command", json={"text": "doszła paleta kartonów"}).json()["type"] == "proposal"


def test_llm_stock_call_uses_registry_only_after_confirmation(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_API_KEY", "fake-key")
    monkeypatch.setenv("LLM_MODE", "llm")
    with TestClient(create_app(str(tmp_path / "stock.db"))) as client:
        item = next(item for item in client.get("/api/stock").json()["items"] if item["name"] == "Kartony")
        message = call_message({"item_id": item["id"], "delta": -4})
        monkeypatch.setattr(OpenAICompatibleProvider, "_post_json", lambda *_: {"choices": [{"message": message}]})
        proposal = client.post("/api/command", json={"text": "pobraliśmy cztery kartony"}).json()["proposal"]
        assert proposal["args"] == {"item_id": item["id"], "delta": -4}
        assert client.get("/api/history").json()["entries"] == []
        response = client.post(f"/api/proposals/{proposal['id']}/confirm")
        assert response.status_code == 200
        assert response.json()["after"] == 50
        entry = client.get("/api/history").json()["entries"][0]
        assert entry["text"] == "pobraliśmy cztery kartony"
