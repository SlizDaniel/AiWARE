"""Card 12: settings observed through HTTP and commands, including restart."""
from fastapi.testclient import TestClient
from io import BytesIO
import pytest

from app.main import create_app


def test_new_prefix_applies_immediately_and_survives_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_MODE", "offline")
    path = tmp_path / "settings.db"
    with TestClient(create_app(path)) as client:
        assert client.get("/api/settings").json()["prefix"] == "Magu"
        assert client.patch("/api/settings", json={"prefix": "Gosiu"}).status_code == 200
        assert client.post("/api/command", json={"text": "Gosiu, ile mamy kartonów?"}).json()["type"] == "answer"
        rejected = client.post("/api/command", json={"text": "Magu, wzięliśmy paletę kartonów"}).json()
        assert rejected["type"] == "clarify"
        assert client.post("/api/command", json={"text": "ile mamy kartonów?"}).json()["type"] == "answer"
    with TestClient(create_app(path)) as restarted:
        assert restarted.get("/api/settings").json()["prefix"] == "Gosiu"
        assert restarted.post("/api/command", json={"text": "Magu, wzięliśmy paletę kartonów"}).json()["type"] == "clarify"


def test_mode_change_affects_next_command_and_both_controls_persist(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODE", "offline")
    monkeypatch.setattr("app.llm.urlopen", lambda *_args, **_kwargs: BytesIO(b'{"choices":[{"message":{"content":"LLM response"}}]}'))
    path = tmp_path / "mode.db"
    with TestClient(create_app(path)) as client:
        assert client.post("/api/command", json={"text": "ile mamy kartonów?"}).json()["type"] == "answer"
        assert client.patch("/api/settings", json={"mode": "llm"}).status_code == 200
        assert client.post("/api/command", json={"text": "ile mamy kartonów?"}).json()["message"] == "LLM response"
    with TestClient(create_app(path)) as restarted:
        assert restarted.get("/api/agent-mode").json()["mode"] == "llm"
        assert restarted.put("/api/agent-mode", json={"mode": "offline"}).status_code == 200
        assert restarted.get("/api/settings").json()["mode"] == "offline"
        assert restarted.post("/api/command", json={"text": "ile mamy kartonów?"}).json()["type"] == "answer"
    with TestClient(create_app(path)) as restarted_again:
        assert restarted_again.get("/api/settings").json()["mode"] == "offline"


def test_defaults_apply_only_to_new_items_and_text_mode_disables_audio(tmp_path, monkeypatch):
    monkeypatch.setenv("STT_API_KEY", "secret-stt")
    monkeypatch.setenv("LLM_API_KEY", "secret-llm")
    path = tmp_path / "defaults.db"
    with TestClient(create_app(path)) as client:
        response = client.patch("/api/settings", json={"adapter": "file_import", "default_minimum": 7, "voice_mode": "text", "mode": "offline"})
        assert response.status_code == 200
        settings = response.json()
        assert settings["ai_usage"]["llm_enabled"] is False
        assert settings["ai_usage"]["stt_enabled"] is False
        assert "secret-stt" not in response.text and "secret-llm" not in response.text
        assert settings["ai_usage"]["disclosure"]
        assert client.post("/api/stt", content=b"audio").status_code == 503
        preview = client.post("/api/import/preview?filename=stock.csv", content=b"Name,Quantity\nKartony,54\nBolts,10").json()
        mapping = {field: suggestion["column"] for field, suggestion in preview["mapping"].items()}
        assert client.post("/api/import/confirm", json={"import_id": preview["import_id"], "mapping": mapping}).status_code == 200
        items = client.get("/api/stock").json()["items"]
        assert next(item for item in items if item["name"] == "Bolts")["minimum"] == 7
        assert next(item for item in items if item["name"] == "Kartony")["minimum"] == 12
        proposal = client.post("/api/command", json={"text": "wzięliśmy paletę nakrętek"}).json()["proposal"]
        assert client.post(f"/api/proposals/{proposal['id']}/confirm").status_code == 200
        assert next(item for item in client.get("/api/stock").json()["items"] if item["name"] == "Nakrętek")["minimum"] == 7
    with TestClient(create_app(path)) as restarted:
        settings = restarted.get("/api/settings").json()
        assert (settings["adapter"], settings["default_minimum"], settings["voice_mode"]) == ("file_import", 7, "text")


@pytest.mark.parametrize("changes", [{"prefix": ""}, {"prefix": "Gosiu, ile"}, {"prefix": None}, {"mode": "broken"}, {"default_minimum": -1}, {"default_minimum": 2.5}, {"voice_mode": "always"}, {"adapter": "erp"}])
def test_invalid_settings_do_not_change_configuration(tmp_path, changes):
    with TestClient(create_app(tmp_path / "invalid.db")) as client:
        before = client.get("/api/settings").json()
        assert client.patch("/api/settings", json=changes).status_code == 422
        assert client.get("/api/settings").json() == before


def test_settings_cannot_enable_cloud_in_offline_demo(tmp_path, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    with TestClient(create_app(tmp_path / "demo.db")) as client:
        assert client.patch("/api/settings", json={"mode": "llm", "prefix": "Gosiu"}).status_code == 409
        assert client.get("/api/settings").json()["prefix"] == "Magu"
        assert client.get("/api/settings").json()["mode"] == "mock"
