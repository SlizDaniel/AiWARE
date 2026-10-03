"""End-to-end contract for all registry tools through LLM interpretation."""
import json

import pytest
from fastapi.testclient import TestClient

from app.agent_contract import tool_schemas
from app.llm import OpenAICompatibleProvider
from app.main import create_app
from app.tools import TOOL_REGISTRY


@pytest.fixture
def llm_client(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_API_KEY", "fake-key")
    monkeypatch.setenv("LLM_MODE", "llm")
    with TestClient(create_app(str(tmp_path / "registry.db"))) as client:
        item = next(item for item in client.get("/api/stock").json()["items"] if item["name"] == "Kartony")

        def respond(name, args):
            def response(_, payload):
                assert {tool["function"]["name"] for tool in payload["tools"]} == set(TOOL_REGISTRY)
                return {"choices": [{"message": {"tool_calls": [{"function": {
                    "name": name, "arguments": json.dumps(args),
                }}]}}]}
            monkeypatch.setattr(OpenAICompatibleProvider, "_post_json", response)

        yield client, item, respond


@pytest.mark.parametrize("tool", ["get_stock", "get_location", "check_reorder", "recall_procedure"])
def test_read_tools_return_answers_without_writes(llm_client, tool):
    client, item, respond = llm_client
    args = {"topic": "szkło"} if tool == "recall_procedure" else {"item_id": item["id"]}
    respond(tool, args)
    response = client.post("/api/command", json={"text": "naturalne pytanie"})
    assert response.status_code == 200
    assert response.json()["type"] == ("clarify" if tool == "recall_procedure" else "answer")
    assert client.get("/api/history").json()["entries"] == []


@pytest.mark.parametrize("tool,args,endpoint", [
    ("add_zone", {"name": "Strefa testowa"}, "/api/zones"),
    ("remember_procedure", {"topic": "szkło", "text": "Pakujemy w kartony"}, "/api/procedures"),
    ("add_item", {"name": "Taśma", "quantity": 7}, "/api/stock"),
    ("draft_order", {"quantity": 50}, "/api/reorder-drafts"),
])
def test_write_tools_wait_for_confirmation(llm_client, tool, args, endpoint):
    client, item, respond = llm_client
    arguments = dict(args)
    if tool == "draft_order":
        arguments["item_id"] = item["id"]
    respond(tool, arguments)
    before = client.get(endpoint).json()
    response = client.post("/api/command", json={"text": "naturalne polecenie"})
    assert response.status_code == 200
    proposal = response.json()["proposal"]
    assert proposal["tool"] == tool
    assert client.get(endpoint).json() == before
    assert client.get("/api/history").json()["entries"] == []
    confirmed = client.post(f"/api/proposals/{proposal['id']}/confirm")
    assert confirmed.status_code == 200
    assert client.get(endpoint).json() != before
    assert len(client.get("/api/history").json()["entries"]) == 1
    assert client.post(f"/api/proposals/{proposal['id']}/confirm").status_code == 404


@pytest.mark.parametrize("tool,args", [
    ("get_location", {"item_id": 99999}),
    ("get_stock", {"item_id": True}),
    ("draft_order", {"item_id": 1, "quantity": -50}),
    ("add_zone", {"name": "   "}),
    ("add_zone", {"name": "Test", "unexpected": "extra"}),
    ("update_stock", {"item_id": 1, "delta": -2, "text": "Forged audit"}),
])
def test_invalid_calls_fall_back_without_writes(llm_client, tool, args):
    client, _, respond = llm_client
    respond(tool, args)
    response = client.post("/api/command", json={"text": "nieznane polecenie"})
    assert response.status_code == 200
    assert "offline" in response.json()["warning"]
    assert client.get("/api/history").json()["entries"] == []


def test_schemas_are_copies_of_registry_not_mutations():
    schemas = tool_schemas()
    assert len(schemas) == len(TOOL_REGISTRY)
    stock = next(tool["function"] for tool in schemas if tool["function"]["name"] == "update_stock")
    assert "text" not in stock["parameters"]["properties"]
    assert "text" in TOOL_REGISTRY["update_stock"].parameters["properties"]
    assert "additionalProperties" not in TOOL_REGISTRY["update_stock"].parameters
