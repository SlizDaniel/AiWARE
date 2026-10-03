"""Offline demo contract: public HTTP path with external networking forbidden."""
import socket
import urllib.request
from pathlib import Path

import pytest

from fastapi.testclient import TestClient

from app.main import create_app


def test_demo_seed_and_commands_never_use_external_network(tmp_path, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setenv("LLM_API_KEY", "configured-but-forbidden")
    monkeypatch.setenv("LLM_MODE", "llm")

    def forbidden(*args, **kwargs):
        raise AssertionError("Offline demo attempted an external connection")

    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    original_connect = socket.socket.connect

    def local_only(sock, address):
        if address[0] not in {"127.0.0.1", "::1"}:
            forbidden()
        return original_connect(sock, address)

    monkeypatch.setattr(socket.socket, "connect", local_only)
    path = str(tmp_path / "demo.db")
    with TestClient(create_app(path)) as client:
        mode = client.get("/api/agent-mode").json()
        assert mode["demo_mode"] is True
        assert mode["effective_mode"] == "offline"
        assert client.put("/api/agent-mode", json={"mode": "llm"}).status_code == 409
        items = client.get("/api/stock").json()["items"]
        assert next(i for i in items if i["name"] == "Kartony")["quantity"] == 13
        assert client.get("/api/history").json()["entries"] == []
        workbook = Path(__file__).parents[2] / "demo-offline.xlsx"
        preview = client.post("/api/import/preview?filename=demo-offline.xlsx", content=workbook.read_bytes()).json()
        mapping = {field: value["column"] for field, value in preview["mapping"].items()}
        assert client.post("/api/import/confirm", json={"import_id": preview["import_id"], "mapping": mapping}).status_code == 200
        for text in ("strefa: kartony", "strefa: szkło", "strefa: folia stretch"):
            proposal = client.post("/api/command", json={"text": text}).json()["proposal"]
            assert client.post(f"/api/proposals/{proposal['id']}/confirm").status_code == 200
        assert len(client.get("/api/zones").json()["zones"]) == 3
        proposal = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"}).json()["proposal"]
        assert (proposal["before"], proposal["after"]) == (13, 11)
        result = client.post(f"/api/proposals/{proposal['id']}/confirm").json()
        assert result["applied"] is True
        drafts = client.get("/api/reorder-drafts").json()["drafts"]
        assert len(drafts) == 1
        assert drafts[0]["quantity"] == 50
        assert drafts[0]["status"] == "pending"
        assert client.post(f"/api/reorder-drafts/{drafts[0]['id']}/approve").json()["sent_to_erp"] is False
        for text in ("ile mamy szkła?", "gdzie leży szkło?", "Magu, jak pakujemy szkło?"):
            answer = client.post("/api/command", json={"text": text}).json()
            assert answer["type"] == "answer"
        assert any(e["event_type"] == "stock_change" for e in client.get("/api/history").json()["entries"])
    # Restart preserves the rehearsal instead of silently resetting it.
    with TestClient(create_app(path)) as client:
        items = client.get("/api/stock").json()["items"]
        assert next(i for i in items if i["name"] == "Kartony")["quantity"] == 11


def test_demo_reset_is_explicit_and_regular_database_is_protected(tmp_path, monkeypatch):
    from app.demo import demo_db_path, init_demo_db

    monkeypatch.setenv("DEMO_MODE", "1")
    path = str(tmp_path / "demo.db")
    with TestClient(create_app(path)) as client:
        proposal = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"}).json()["proposal"]
        client.post(f"/api/proposals/{proposal['id']}/confirm")
    init_demo_db(path, reset=True)
    with TestClient(create_app(path)) as client:
        assert client.get("/api/history").json()["entries"] == []
        assert client.get("/api/reorder-drafts").json()["drafts"] == []
        assert client.get("/api/zones").json()["zones"] == []
        items = client.get("/api/stock").json()["items"]
        assert next(i for i in items if i["name"] == "Kartony")["quantity"] == 13
    monkeypatch.setenv("DEMO_MODE", "0")
    normal = str(tmp_path / "normal.db")
    with TestClient(create_app(normal)) as client:
        before = client.get("/api/stock").json()
    with pytest.raises(ValueError, match="nie jest bazą demo"):
        init_demo_db(normal, reset=True)
    with TestClient(create_app(normal)) as client:
        assert client.get("/api/stock").json() == before
    monkeypatch.setenv("MAGAZYNIER_DB", normal)
    monkeypatch.setenv("DEMO_DB", normal)
    with pytest.raises(ValueError, match="inną bazę"):
        demo_db_path()
