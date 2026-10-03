"""Seam intencja → narzędzie (PRD, seam 2): fixtura tekst → oczekiwane wywołanie narzędzia.

Kontrakt wspólny dla offline-parsera (karta 02) i LLM function-calling (karta 03).
6 komend demo: „wzięliśmy paletę X", „doszła paleta X", „strefa: X", „ile mamy X?",
„gdzie leży X?", „jak pakujemy X?". „paleta" = 2 szt.
"""
import pytest

from app.models import ItemRef
from app.parser import SZT_NA_PALETE, parse_command

ITEMS = [
    ItemRef(id=1, name="Kartony"),
    ItemRef(id=2, name="Szkło"),
    ItemRef(id=3, name="Folia stretch"),
]


@pytest.mark.parametrize(
    "text, expected",
    [
        # komenda demo 1–2: wzięto / doszło („paleta" = 2 szt)
        ("wzięliśmy paletę kartonów", {"tool": "update_stock", "item_id": 1, "delta": -2}),
        ("Wzięliśmy paletę szkła", {"tool": "update_stock", "item_id": 2, "delta": -2}),
        ("wzięliśmy paletę folii stretch", {"tool": "update_stock", "item_id": 3, "delta": -2}),
        ("wzięliśmy 2 palety kartonów", {"tool": "update_stock", "item_id": 1, "delta": -4}),
        ("doszła paleta kartonów", {"tool": "update_stock", "item_id": 1, "delta": 2}),
        ("doszła paleta szkła", {"tool": "update_stock", "item_id": 2, "delta": 2}),
        # komenda demo 3: nazwanie strefy podczas spaceru
        ("strefa: kartony", {"tool": "add_zone", "args": {"name": "kartony"}}),
        ("Strefa: folia", {"tool": "add_zone", "args": {"name": "folia"}}),
        ("strefa: pakowanie szkła", {"tool": "add_zone", "args": {"name": "pakowanie szkła"}}),
        # komenda demo 4: pytanie o stan
        ("ile mamy szkła?", {"tool": "get_stock", "args": {"item_id": 2}}),
        ("ile mamy kartonów", {"tool": "get_stock", "args": {"item_id": 1}}),
        ("ile mamy?", {"tool": "get_stock", "args": {}}),
        # komenda demo 5: pytanie o lokalizację
        ("gdzie leży szkło?", {"tool": "get_location", "args": {"item_id": 2}}),
        ("gdzie leżą kartony?", {"tool": "get_location", "args": {"item_id": 1}}),
        # komenda demo 6: pamięć proceduralna
        ("jak pakujemy szkło?", {"tool": "recall_procedure", "args": {"topic": "szkło"}}),
        ("jak pakujemy folię stretch?", {"tool": "recall_procedure", "args": {"topic": "folię stretch"}}),
        # zapis procedury (sugestia z clarify przy braku procedury — patrz test_api)
        (
            "zapamiętaj: szkło pakujemy w kartony Y, strefa C2",
            {
                "tool": "remember_procedure",
                "args": {"topic": "szkło", "text": "szkło pakujemy w kartony Y, strefa C2"},
            },
        ),
    ],
)
def test_utterance_maps_to_tool_call(text: str, expected: dict):
    parsed = parse_command(text, ITEMS)
    assert parsed is not None, f"komenda nierozpoznana: {text!r}"
    assert parsed.tool == expected["tool"]
    if "item_id" in expected:
        assert parsed.item_id == expected["item_id"]
        assert parsed.args == {"item_id": expected["item_id"], "delta": expected["delta"]}
        assert parsed.delta == expected["delta"]
    else:
        assert parsed.args == expected["args"]


def test_paleta_is_two_pieces():
    parsed = parse_command("wzięliśmy paletę kartonów", ITEMS)
    assert parsed.delta == -SZT_NA_PALETE


def test_unknown_text_returns_none():
    # nieznane komendy → None (API zamieni na prośbę o doprecyzowanie; nigdy nie zgaduje po cichu)
    assert parse_command("policz palety na hali", ITEMS) is None
    assert parse_command("zamknij magazyn na noc", ITEMS) is None
    assert parse_command("", ITEMS) is None


def test_missing_item_update_intent_is_not_silent():
    # brak przedmiotu w bazie → rozpoznana intencja BEZ argumentów wykonania
    # (API proponuje dodanie pozycji zamiast cicho upaść)
    parsed = parse_command("wzięliśmy paletę śrubek", ITEMS)
    assert parsed is not None
    assert parsed.tool == "update_stock"
    assert parsed.item_id is None
    assert parsed.missing_item == "śrubek"
    assert parsed.args == {}


def test_missing_item_query_intent_is_not_silent():
    parsed = parse_command("ile mamy śrubek?", ITEMS)
    assert parsed is not None
    assert parsed.tool == "get_stock"
    assert parsed.item_id is None
    assert parsed.missing_item == "śrubek"


def test_take_without_palette_returns_none():
    # komendy demo używają „palety" — inne zdania z „wzięliśmy" nie wywołają update_stock
    assert parse_command("wzięliśmy kartony", ITEMS) is None
