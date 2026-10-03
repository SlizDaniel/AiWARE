"""Kontrakt HTTP/WS backend↔frontend (PRD, seam 3): karta zmiany, potwierdzenie, audyt.

Zasada audytu: zapis w bazie (stan + wpis) następuje WYŁĄCZNIE po zatwierdzeniu;
niezatwierdzone propozycje nie dotykają bazy.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=tmp_path / "test.db")
    with TestClient(app) as c:
        yield c


def test_seed_has_minimum_three_items_and_kartony_54_min_12(client):
    items = client.get("/api/stock").json()["items"]
    assert len(items) >= 3
    kartony = next(i for i in items if i["name"] == "Kartony")
    assert kartony["quantity"] == 54
    assert kartony["minimum"] == 12


def test_command_returns_change_card_and_writes_nothing(client):
    r = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"})
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "proposal"
    p = data["proposal"]
    assert p["tool"] == "update_stock"
    assert p["item_name"] == "Kartony"
    assert p["before"] == 54
    assert p["after"] == 52
    assert p["delta"] == -2
    assert "54→52" in p["summary"]

    # niezatwierdzone propozycje NIE dotykają bazy
    stock = client.get("/api/stock").json()["items"]
    assert next(i for i in stock if i["name"] == "Kartony")["quantity"] == 54
    assert client.get("/api/history").json()["entries"] == []


def test_confirm_writes_stock_and_audit(client):
    p = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"}).json()["proposal"]
    r = client.post(f"/api/proposals/{p['id']}/confirm")
    assert r.status_code == 200
    assert r.json()["applied"] is True

    stock = client.get("/api/stock").json()["items"]
    assert next(i for i in stock if i["name"] == "Kartony")["quantity"] == 52

    entries = client.get("/api/history").json()["entries"]
    assert len(entries) == 1
    e = entries[0]
    assert e["item_name"] == "Kartony"
    assert e["delta"] == -2
    assert e["before"] == 54
    assert e["after"] == 52
    assert e["text"] == "wzięliśmy paletę kartonów"
    assert e["ts"]


def test_unknown_command_returns_unknown_and_touches_nothing(client):
    r = client.post("/api/command", json={"text": "zamknij magazyn na noc"})
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "unknown"
    assert data["text"] == "zamknij magazyn na noc"
    assert len(data["hints"]) >= 6  # podpowiedź: 6 komend demo
    entries = client.get("/api/history").json()["entries"]
    assert entries == []


def test_query_returns_answer_without_touching_db(client):
    r = client.post("/api/command", json={"text": "ile mamy szkła?"})
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "answer"
    assert data["tool"] == "get_stock"
    assert "20" in data["text"]
    assert data["data"]["item"]["quantity"] == 20
    # pytanie nie zapisuje niczego
    assert client.get("/api/history").json()["entries"] == []


def test_query_all_stock_returns_answer(client):
    data = client.post("/api/command", json={"text": "ile mamy?"}).json()
    assert data["type"] == "answer"
    assert data["tool"] == "get_stock"
    assert len(data["data"]["items"]) >= 3
    assert "Kartony" in data["text"]


def test_location_query_returns_answer(client):
    data = client.post("/api/command", json={"text": "gdzie leży szkło?"}).json()
    assert data["type"] == "answer"
    assert data["tool"] == "get_location"
    assert "Strefa B-2" in data["text"]


def test_recall_missing_procedure_is_clarify_not_hallucination(client):
    data = client.post("/api/command", json={"text": "jak pakujemy szkło?"}).json()
    assert data["type"] == "clarify"
    assert "szkło" in data["message"]
    assert "zapamiętaj" in data["message"].lower()
    assert client.get("/api/history").json()["entries"] == []


def test_recall_procedure_returns_answer(client, ):
    from app import db
    db.remember_procedure(str(client.app.state.db_path), topic="szkło", text="szkło pakujemy w kartony Y, strefa C2")
    data = client.post("/api/command", json={"text": "jak pakujemy szkło?"}).json()
    assert data["type"] == "answer"
    assert data["tool"] == "recall_procedure"
    assert "kartony Y" in data["text"]


def test_zone_proposal_then_confirm_writes_zone_and_audit(client):
    r = client.post("/api/command", json={"text": "strefa: kartony"})
    data = r.json()
    assert data["type"] == "proposal"
    p = data["proposal"]
    assert p["tool"] == "add_zone"
    assert p["args"] == {"name": "kartony"}
    assert "kartony" in p["summary"].lower()

    # niezatwierdzona strefa nie istnieje w bazie
    assert client.get("/api/zones").json()["zones"] == []

    confirm = client.post(f"/api/proposals/{p['id']}/confirm")
    assert confirm.status_code == 200
    assert confirm.json()["applied"] is True

    zones = client.get("/api/zones").json()["zones"]
    assert [z["name"] for z in zones] == ["kartony"]

    entries = client.get("/api/history").json()["entries"]
    assert entries[0]["event_type"] == "zone_added"
    assert entries[0]["item_name"] == "kartony"


def test_zone_confirm_is_idempotent(client):
    p = client.post("/api/command", json={"text": "strefa: kartony"}).json()["proposal"]
    assert client.post(f"/api/proposals/{p['id']}/confirm").json()["created"] is True
    p2 = client.post("/api/command", json={"text": "strefa: kartony"}).json()["proposal"]
    assert client.post(f"/api/proposals/{p2['id']}/confirm").json()["created"] is False
    assert len(client.get("/api/zones").json()["zones"]) == 1


def test_missing_item_on_update_proposes_adding_it(client):
    # brak przedmiotu w bazie → propozycja DODANIA (karta zmiany), nigdy ciche zmyślanie
    data = client.post("/api/command", json={"text": "wzięliśmy paletę śrubek"}).json()
    assert data["type"] == "proposal"
    p = data["proposal"]
    assert p["tool"] == "add_item"
    assert p["args"]["name"].lower() == "śrubek"

    confirm = client.post(f"/api/proposals/{p['id']}/confirm")
    assert confirm.status_code == 200

    stock = client.get("/api/stock").json()["items"]
    added = next(i for i in stock if i["name"].lower() == "śrubek")
    assert added["quantity"] == 0
    entries = client.get("/api/history").json()["entries"]
    assert entries[0]["event_type"] == "item_added"


def test_missing_item_on_query_is_clarify(client):
    data = client.post("/api/command", json={"text": "ile mamy śrubek?"}).json()
    assert data["type"] == "clarify"
    assert "śrubek" in data["message"]
    assert client.get("/api/history").json()["entries"] == []


def test_suggested_remember_command_round_trip(client):
    # clarify przy braku procedury PODPOWADA komendę „zapamiętaj:…” — ta sugestia
    # musi być realną ścieżką: karta → confirm → recall odpowiada (brak ślemej ulicy)
    data = client.post("/api/command", json={"text": "jak pakujemy szkło?"}).json()
    assert data["type"] == "clarify"
    assert "zapamiętaj" in data["message"].lower()

    p = client.post(
        "/api/command", json={"text": "zapamiętaj: szkło pakujemy w kartony Y, strefa C2"}
    ).json()
    assert p["type"] == "proposal"
    assert p["proposal"]["tool"] == "remember_procedure"
    assert client.get("/api/procedures").json()["procedures"] == []

    # niezatwierdzona procedura nie istnieje w bazie
    still = client.post("/api/command", json={"text": "jak pakujemy szkło?"}).json()
    assert still["type"] == "clarify"

    confirm = client.post(f"/api/proposals/{p['proposal']['id']}/confirm")
    assert confirm.status_code == 200

    answer = client.post("/api/command", json={"text": "jak pakujemy szkło?"}).json()
    assert answer["type"] == "answer"
    assert "kartony Y" in answer["text"]
    procedures = client.get("/api/procedures").json()["procedures"]
    assert len(procedures) == 1
    assert procedures[0]["topic"] == "szkło"
    assert procedures[0]["text"] == "szkło pakujemy w kartony Y, strefa C2"
    assert procedures[0]["created"]
    entries = client.get("/api/history").json()["entries"]
    assert entries[0]["event_type"] == "procedure_saved"


def test_procedure_update_requires_confirmation_and_recall_searches_content(client):
    def propose(text):
        response = client.post("/api/command", json={"text": f"zapamiętaj: {text}"})
        assert response.status_code == 200
        return response.json()["proposal"]

    original = propose("szkło pakujemy w kartony Y, strefa C2")
    assert client.post(f"/api/proposals/{original['id']}/confirm").status_code == 200
    before = client.get("/api/procedures").json()["procedures"]

    replacement = propose("szkło pakujemy z przekładkami, strefa B-2")
    assert client.get("/api/procedures").json()["procedures"] == before
    assert client.post(f"/api/proposals/{replacement['id']}/confirm").status_code == 200
    after = client.get("/api/procedures").json()["procedures"]
    assert len(after) == 1
    assert after[0]["id"] == before[0]["id"]
    assert after[0]["text"] == "szkło pakujemy z przekładkami, strefa B-2"

    answer = client.post("/api/command", json={"text": "jak pakujemy przekładkami?"}).json()
    assert answer["type"] == "answer"
    assert answer["data"]["procedures"][0]["text"] == after[0]["text"]


def test_procedure_from_uppercase_transcription_keeps_topic_and_is_recalled(client):
    response = client.post(
        "/api/command", json={"text": "Zapamiętaj: SZKŁO pakujemy z PRZEKŁADKAMI, strefa C2"}
    ).json()
    assert response["type"] == "proposal"
    proposal = response["proposal"]
    assert proposal["args"]["topic"] == "szkło"
    assert client.get("/api/procedures").json()["procedures"] == []
    assert client.post(f"/api/proposals/{proposal['id']}/confirm").status_code == 200

    answer = client.post("/api/command", json={"text": "jak pakujemy szkło?"}).json()
    assert answer["type"] == "answer"
    assert answer["data"]["procedures"][0]["text"] == "SZKŁO pakujemy z PRZEKŁADKAMI, strefa C2"

    fragment = client.post("/api/command", json={"text": "jak pakujemy przekładkami?"}).json()
    assert fragment["type"] == "answer"
    assert fragment["data"]["procedures"][0]["topic"] == "szkło"


def test_draft_order_proposal_confirms_into_queue(client):
    # kontrakt dla karty 08: karta draft_order → confirm → szkic w Kolejce (nigdy auto-wysyłka)
    from app.main import PROPOSALS

    PROPOSALS["t-order"] = {
        "id": "t-order",
        "tool": "draft_order",
        "args": {"item_id": 1, "quantity": 50},
        "summary": "Szkic zamówienia: Kartony 50",
        "text": "zamów 50 kartonów",
    }
    try:
        r = client.post("/api/proposals/t-order/confirm")
        assert r.status_code == 200
        assert r.json()["applied"] is True
        orders = client.get("/api/reorder-drafts").json()["drafts"]
        assert orders[0]["quantity"] == 50
        assert orders[0]["status"] == "pending"
        assert client.get("/api/history").json()["entries"][0]["event_type"] == "reorder_draft_created"
    finally:
        PROPOSALS.pop("t-order", None)


def test_confirm_unknown_tool_is_400(client):
    from app.main import PROPOSALS

    PROPOSALS["t-bad"] = {"id": "t-bad", "tool": "nie_ma_takiego", "args": {}, "text": "x"}
    try:
        assert client.post("/api/proposals/t-bad/confirm").status_code == 400
    finally:
        PROPOSALS.pop("t-bad", None)


def test_demo_path_all_six_commands_offline(client):
    """Demo check karty 02: 6 komend demo po kolei, bez kluczy API, bez sieci."""
    komendy = [
        ("wzięliśmy paletę kartonów", "proposal", "update_stock"),
        ("doszła paleta szkła", "proposal", "update_stock"),
        ("strefa: kartony", "proposal", "add_zone"),
        ("ile mamy szkła?", "answer", "get_stock"),
        ("gdzie leży szkło?", "answer", "get_location"),
        ("jak pakujemy szkło?", "clarify", None),
    ]
    for text, typ, tool in komendy:
        data = client.post("/api/command", json={"text": text}).json()
        assert data["type"] == typ, f"{text!r} → {data['type']}, oczekiwane {typ}"
        if typ == "proposal":
            assert data["proposal"]["tool"] == tool
        elif typ == "answer":
            assert data["tool"] == tool


def test_confirm_unknown_proposal_is_404(client):
    assert client.post("/api/proposals/nie-ma-takiego/confirm").status_code == 404


def test_proposal_cannot_be_confirmed_twice(client):
    p = client.post("/api/command", json={"text": "doszła paleta szkła"}).json()["proposal"]
    assert client.post(f"/api/proposals/{p['id']}/confirm").status_code == 200
    # drugi raz ta sama propozycja nie może podwójnie zmienić bazy
    assert client.post(f"/api/proposals/{p['id']}/confirm").status_code == 404
    stock = client.get("/api/stock").json()["items"]
    assert next(i for i in stock if i["name"] == "Szkło")["quantity"] == 22


def test_ws_broadcasts_update_on_confirm(client):
    with client.websocket_connect("/ws") as ws:
        p = client.post("/api/command", json={"text": "wzięliśmy paletę kartonów"}).json()["proposal"]
        client.post(f"/api/proposals/{p['id']}/confirm")
        assert ws.receive_json() == {"event": "updated"}
