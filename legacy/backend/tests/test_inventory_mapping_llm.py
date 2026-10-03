"""Import mapping through HTTP, with only the external LLM transport replaced."""
import json
from io import BytesIO
import pytest

from fastapi.testclient import TestClient

from app.main import create_app


def test_llm_maps_unusual_headers_without_writing_until_confirmation(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODE", "llm")
    monkeypatch.setenv("DEMO_MODE", "0")
    mapping = {
        "name": {"column": 0, "confidence": 0.93},
        "quantity": {"column": 1, "confidence": 0.91},
        "minimum": {"column": 2, "confidence": 0.88},
        "location": {"column": 3, "confidence": 0.9},
        "unit": {"column": None, "confidence": 0},
    }
    def response(request, **kwargs):
        payload = json.loads(request.data)
        assert "opis handlowy" in payload["messages"][1]["content"]
        sample = json.loads(payload["messages"][1]["content"].split("\n", 1)[1])
        assert len(sample["sample_rows"]) == 5
        assert "Sixth hidden row" not in payload["messages"][1]["content"]
        return BytesIO(json.dumps({"choices": [{"finish_reason": "tool_calls", "message": {
            "tool_calls": [{"function": {"name": "map_inventory_columns", "arguments": json.dumps({
                **mapping, "unit": {"column": -1, "confidence": 0},
            })}}]
        }}]}).encode())
    monkeypatch.setattr("app.llm.urlopen", response)
    with TestClient(create_app(tmp_path / "mapping.db")) as client:
        before = client.get("/api/stock").json()
        preview = client.post("/api/import/preview?filename=odd.csv", content=(
            "opis handlowy;na stanie dzisiaj;punkt alarmowy;adres regału\n"
            "Nietypowy produkt;27;6;C2\n"
            "Produkt 2;1;0;A1\nProdukt 3;2;0;A1\nProdukt 4;3;0;A1\n"
            "Produkt 5;4;0;A1\nSixth hidden row;5;0;A1\n"
        ).encode()).json()
        assert preview["mapping_source"] == "llm"
        assert preview["mapping"] == mapping
        assert client.get("/api/stock").json() == before
        confirmed = client.post("/api/import/confirm", json={
            "import_id": preview["import_id"],
            "mapping": {field: value["column"] for field, value in mapping.items()},
        })
        assert confirmed.status_code == 200
        product = next(item for item in client.get("/api/stock").json()["items"] if item["name"] == "Nietypowy produkt")
        assert (product["quantity"], product["minimum"], product["location"]) == (27, 6, "C2")


@pytest.mark.parametrize("failure", ["timeout", "invalid_json", "out_of_range", "duplicate", "missing", "confidence", "refusal", "truncated", "clarification"])
def test_unusable_ai_mapping_falls_back_and_remains_editable(tmp_path, monkeypatch, failure):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODE", "llm")
    monkeypatch.setenv("DEMO_MODE", "0")
    mapping = {
        "name": {"column": 0, "confidence": 0.9},
        "quantity": {"column": 1, "confidence": 0.9},
        "minimum": {"column": -1, "confidence": 0},
        "location": {"column": -1, "confidence": 0},
        "unit": {"column": -1, "confidence": 0},
    }
    if failure == "out_of_range":
        mapping["name"]["column"] = 5
    elif failure == "duplicate":
        mapping["quantity"]["column"] = 0
    elif failure == "missing":
        mapping["name"]["column"] = -1
    elif failure == "confidence":
        mapping["name"]["confidence"] = 1.1
    message = {"tool_calls": [{"function": {
        "name": "map_inventory_columns", "arguments": json.dumps(mapping),
    }}]}
    if failure == "refusal":
        message["refusal"] = "Cannot comply"
    elif failure == "clarification":
        message = {"content": "Która kolumna oznacza ilość?"}
    def response(*args, **kwargs):
        if failure == "timeout":
            raise TimeoutError("test")
        if failure == "invalid_json":
            return BytesIO(b"not json")
        return BytesIO(json.dumps({"choices": [{
            "finish_reason": "length" if failure == "truncated" else "stop", "message": message,
        }]}).encode())
    monkeypatch.setattr("app.llm.urlopen", response)
    with TestClient(create_app(tmp_path / "fallback.db")) as client:
        before = client.get("/api/stock").json()
        preview = client.post("/api/import/preview?filename=test.csv", content=b"Nazwa;Ilosc\nNowy towar;25\n").json()
        assert preview["mapping_source"] == "deterministic"
        assert preview["mapping"]["name"]["column"] == 0
        assert preview["mapping"]["quantity"]["column"] == 1
        assert any("AI nie" in warning for warning in preview["warnings"])
        assert client.get("/api/stock").json() == before
        # User correction is authoritative, even after an AI failure.
        confirmed = client.post("/api/import/confirm", json={
            "import_id": preview["import_id"], "mapping": {"name": 0, "quantity": 1},
        })
        assert confirmed.status_code == 200


@pytest.mark.parametrize("mode,key,demo", [("offline", "test-key", "0"), ("mock", "test-key", "0"), ("llm", "", "0"), ("llm", "test-key", "1")])
def test_offline_mock_missing_key_and_demo_never_send_files(tmp_path, monkeypatch, mode, key, demo):
    monkeypatch.setenv("LLM_MODE", mode)
    monkeypatch.setenv("LLM_API_KEY", key)
    monkeypatch.setenv("DEMO_MODE", demo)
    def unexpected_request(*args, **kwargs):
        pytest.fail("Offline mapping must never call an external API")
    monkeypatch.setattr("app.llm.urlopen", unexpected_request)
    with TestClient(create_app(tmp_path / "offline.db")) as client:
        preview = client.post("/api/import/preview?filename=test.csv", content=b"Nazwa;Ilosc\nTowar;25\n").json()
        assert preview["mapping_source"] == "deterministic"
        assert preview["mapping"]["quantity"]["column"] == 1


@pytest.mark.parametrize("headers", [
    "Nazwa produktu;Ilość;Stan minimalny;Miejsce;Miara",
    "Item name;Stock;Reorder point;Shelf;Unit",
])
def test_two_header_variants_import_the_same_demo_inventory(tmp_path, monkeypatch, headers):
    monkeypatch.setenv("LLM_MODE", "offline")
    monkeypatch.setenv("DEMO_MODE", "0")
    data = headers + "\nKartony;54;12;Strefa A-1;szt\nSzkło;20;8;Strefa B-2;szt\nFolia stretch;15;6;Strefa C-1;rolka\nTaśma pakowa;36;10;Strefa A-2;rolka\n"
    with TestClient(create_app(tmp_path / "variants.db")) as client:
        preview = client.post("/api/import/preview?filename=variant.csv", content=data.encode()).json()
        mapping = {field: value["column"] for field, value in preview["mapping"].items()}
        assert mapping == {"name": 0, "quantity": 1, "minimum": 2, "location": 3, "unit": 4}
        for import_attempt in range(2):
            if import_attempt:
                preview = client.post("/api/import/preview?filename=variant.csv", content=data.encode()).json()
            result = client.post("/api/import/confirm", json={"import_id": preview["import_id"], "mapping": mapping})
            assert result.status_code == 200
        items = client.get("/api/stock").json()["items"]
        assert sorted((i["name"], i["quantity"], i["minimum"], i["location"], i["unit"]) for i in items) == [
            ("Folia stretch", 15, 6, "Strefa C-1", "rolka"),
            ("Kartony", 54, 12, "Strefa A-1", "szt"),
            ("Szkło", 20, 8, "Strefa B-2", "szt"),
            ("Taśma pakowa", 36, 10, "Strefa A-2", "rolka"),
        ]
