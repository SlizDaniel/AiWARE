"""Rejestr narzędzi agenta (karta 02): 8 narzędzi z PRD działa na realnej bazie SQLite.

Narzędzia to jedyna droga do danych (read) i zapisów (write). update_stock wykonuje
się WYŁĄCZNIE po zatwierdzeniu karty — przed tym nic nie dotyka bazy.
"""
import pytest

from app import db
from app.tools import TOOL_REGISTRY, call_tool

TOOLS_Z_PRD = {
    "get_stock",
    "update_stock",
    "check_reorder",
    "draft_order",
    "get_location",
    "add_zone",
    "remember_procedure",
    "recall_procedure",
}


@pytest.fixture()
def db_path(tmp_path):
    p = str(tmp_path / "tools.db")
    db.init_db(p)
    return p


def test_registry_contains_all_eight_prd_tools():
    assert TOOLS_Z_PRD <= set(TOOL_REGISTRY)


def test_every_tool_has_kind_description_and_json_schema():
    for spec in TOOL_REGISTRY.values():
        assert spec.kind in {"read", "write"}
        assert spec.description
        assert spec.parameters.get("type") == "object"


def test_get_stock_single_and_all(db_path):
    single = call_tool(db_path, "get_stock", item_id=1)
    assert single["item"]["name"] == "Kartony"
    assert single["item"]["quantity"] == 54

    everything = call_tool(db_path, "get_stock")
    assert {i["name"] for i in everything["items"]} >= {"Kartony", "Szkło", "Folia stretch"}


def test_update_stock_writes_state_and_audit(db_path):
    result = call_tool(db_path, "update_stock", item_id=1, delta=-2, text="wzięliśmy paletę kartonów")
    assert result["after"] == 52
    entry = db.list_audit(db_path)[0]
    assert entry["event_type"] == "stock_change"
    assert entry["item_name"] == "Kartony"


def test_check_reorder_flags_below_minimum(db_path):
    above = call_tool(db_path, "check_reorder", item_id=1)
    assert above["below_minimum"] is False

    db.confirm_stock_change(db_path, item_id=1, delta=-45, text="test progu")
    below = call_tool(db_path, "check_reorder", item_id=1)
    assert below["below_minimum"] is True
    assert below["quantity"] == 9
    assert below["minimum"] == 12
    assert below["suggested_quantity"] == 3


def test_draft_order_persists_with_status_draft(db_path):
    d = call_tool(db_path, "draft_order", item_id=1, quantity=50)
    assert d["status"] == "pending"
    assert d["deliver_on"] == db._next_tuesday().isoformat()

    rows = db.list_reorder_drafts(db_path)
    assert len(rows) == 1
    assert rows[0]["quantity"] == 50
    assert rows[0]["item_name"] == "Kartony"


def test_draft_order_is_idempotent_while_pending(db_path):
    first = call_tool(db_path, "draft_order", item_id=1, quantity=50)
    again = call_tool(db_path, "draft_order", item_id=1, quantity=30)
    assert first["created"] is True
    assert again["created"] is False
    assert again["id"] == first["id"]
    assert len(db.list_reorder_drafts(db_path)) == 1


def test_get_location_returns_zone(db_path):
    loc = call_tool(db_path, "get_location", item_id=2)
    assert loc["item_name"] == "Szkło"
    assert loc["location"] == "Strefa B-2"


def test_add_zone_is_idempotent(db_path):
    first = call_tool(db_path, "add_zone", name="kartony")
    assert first["created"] is True

    again = call_tool(db_path, "add_zone", name="kartony")
    assert again["created"] is False
    assert again["id"] == first["id"]

    assert [z["name"] for z in db.list_zones(db_path)] == ["kartony"]


def test_remember_and_recall_procedure(db_path):
    call_tool(db_path, "remember_procedure", topic="szkło", text="szkło pakujemy w kartony Y, strefa C2")

    hit = call_tool(db_path, "recall_procedure", topic="szkło")
    assert hit["procedures"][0]["text"].startswith("szkło pakujemy")

    # wyszukiwanie po fragmencie tekstu procedury
    frag = call_tool(db_path, "recall_procedure", topic="pakujemy")
    assert len(frag["procedures"]) == 1

    assert call_tool(db_path, "recall_procedure", topic="elektronika")["procedures"] == []


def test_remember_procedure_updates_existing_topic(db_path):
    call_tool(db_path, "remember_procedure", topic="szkło", text="stara wersja")
    call_tool(db_path, "remember_procedure", topic="szkło", text="nowa wersja")

    procs = call_tool(db_path, "recall_procedure", topic="szkło")["procedures"]
    assert len(procs) == 1
    assert procs[0]["text"] == "nowa wersja"


def test_unknown_tool_raises(db_path):
    with pytest.raises(KeyError):
        call_tool(db_path, "nie_ma_takiego")
