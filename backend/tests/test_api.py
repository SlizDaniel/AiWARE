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
    r = client.post("/api/command", json={"text": "gdzie leży młotek"})
    assert r.status_code == 200
    assert r.json()["type"] == "unknown"
    entries = client.get("/api/history").json()["entries"]
    assert entries == []


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
