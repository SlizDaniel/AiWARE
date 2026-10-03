from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app


@pytest.fixture()
def client_factory(tmp_path):
    def make(quantity: int = 54):
        db_path = tmp_path / f"reorder-{quantity}.db"
        app = create_app(db_path=db_path)
        context = TestClient(app)
        context.__enter__()
        with db.connect(str(db_path)) as conn:
            conn.execute("UPDATE items SET quantity = ? WHERE name = 'Kartony'", (quantity,))
        return context, db_path

    contexts = []

    def create(quantity: int = 54):
        context, db_path = make(quantity)
        contexts.append(context)
        return context, db_path

    yield create
    for context in contexts:
        context.__exit__(None, None, None)


def test_confirm_below_minimum_creates_one_order_draft_and_audit(client_factory):
    client, _ = client_factory(quantity=13)
    proposal = client.post(
        "/api/command", json={"text": "wzięliśmy paletę kartonów"}
    ).json()["proposal"]

    assert client.get("/api/reorder-drafts").json()["drafts"] == []
    response = client.post(f"/api/proposals/{proposal['id']}/confirm")
    result = response.json()
    assert response.status_code == 200
    assert result["reorder_draft"]["quantity"] == 50
    assert result["reorder_draft"]["status"] == "pending"
    assert result["reorder_draft"]["deliver_on"] == db._next_tuesday(date.today()).isoformat()
    assert len(client.get("/api/reorder-drafts").json()["drafts"]) == 1

    entries = client.get("/api/history").json()["entries"]
    assert [entry["event_type"] for entry in entries] == [
        "reorder_draft_created",
        "stock_change",
    ]


def test_equal_to_minimum_does_not_create_order_draft(client_factory):
    client, _ = client_factory(quantity=14)
    proposal = client.post(
        "/api/command", json={"text": "wzięliśmy paletę kartonów"}
    ).json()["proposal"]

    client.post(f"/api/proposals/{proposal['id']}/confirm")

    kartony = next(item for item in client.get("/api/stock").json()["items"] if item["name"] == "Kartony")
    assert kartony["quantity"] == 12
    assert client.get("/api/reorder-drafts").json()["drafts"] == []


def test_large_shortfall_scales_order_quantity_to_cover_minimum(client_factory):
    client, db_path = client_factory(quantity=13)
    with db.connect(str(db_path)) as conn:
        conn.execute("UPDATE items SET minimum = 80 WHERE name = 'Kartony'")
    proposal = client.post(
        "/api/command", json={"text": "wzięliśmy paletę kartonów"}
    ).json()["proposal"]

    draft = client.post(f"/api/proposals/{proposal['id']}/confirm").json()["reorder_draft"]

    assert draft["quantity"] == 69


@pytest.mark.parametrize(
    ("decision", "expected_status", "event_type"),
    [
        ("approve", "approved", "reorder_approved"),
        ("reject", "rejected", "reorder_rejected"),
    ],
)
def test_reorder_decision_is_audited_and_never_sent_to_erp(
    client_factory, decision, expected_status, event_type
):
    client, _ = client_factory(quantity=13)
    proposal = client.post(
        "/api/command", json={"text": "wzięliśmy paletę kartonów"}
    ).json()["proposal"]
    draft = client.post(f"/api/proposals/{proposal['id']}/confirm").json()["reorder_draft"]

    response = client.post(f"/api/reorder-drafts/{draft['id']}/{decision}")

    assert response.status_code == 200
    assert response.json()["draft"]["status"] == expected_status
    if decision == "approve":
        assert response.json()["sent_to_erp"] is False
    assert client.get("/api/reorder-drafts").json()["drafts"][0]["status"] == expected_status
    assert client.get("/api/history").json()["entries"][0]["event_type"] == event_type
    assert client.post(f"/api/reorder-drafts/{draft['id']}/{decision}").status_code == 404


def test_only_one_pending_draft_per_item(client_factory):
    client, _ = client_factory(quantity=13)
    for _ in range(2):
        proposal = client.post(
            "/api/command", json={"text": "wzięliśmy paletę kartonów"}
        ).json()["proposal"]
        client.post(f"/api/proposals/{proposal['id']}/confirm")

    drafts = client.get("/api/reorder-drafts").json()["drafts"]
    assert len(drafts) == 1
    assert drafts[0]["status"] == "pending"
