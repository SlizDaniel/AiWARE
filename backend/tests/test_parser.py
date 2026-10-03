"""Seam intencja → narzędzie (PRD, seam A/B): fixtura tekst → oczekiwane wywołanie update_stock.

Kontrakt wspólny: parser offline (karta 01), później LLM pod ten sam kontrakt (karta 02).
„paleta" = 2 szt. Parser rozpoznaje wyłącznie „wzięliśmy paletę X" / „doszła paleta X".
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
        # fixtura z karty 01: „wzięliśmy paletę kartonów" → update_stock(kartony, -2)
        ("wzięliśmy paletę kartonów", {"tool": "update_stock", "item_id": 1, "delta": -2}),
        ("Wzięliśmy paletę szkła", {"tool": "update_stock", "item_id": 2, "delta": -2}),
        ("wzięliśmy paletę folii stretch", {"tool": "update_stock", "item_id": 3, "delta": -2}),
        ("wzięliśmy 2 palety kartonów", {"tool": "update_stock", "item_id": 1, "delta": -4}),
        # towar doszedł
        ("doszła paleta kartonów", {"tool": "update_stock", "item_id": 1, "delta": 2}),
        ("doszła paleta szkła", {"tool": "update_stock", "item_id": 2, "delta": 2}),
    ],
)
def test_utterance_maps_to_update_stock(text: str, expected: dict):
    parsed = parse_command(text, ITEMS)
    assert parsed is not None, f"komenda nierozpoznana: {text!r}"
    assert parsed.tool == expected["tool"]
    # kontrakt wywołania narzędzia: update_stock(item_id=..., delta=...)
    assert parsed.args == {"item_id": expected["item_id"], "delta": expected["delta"]}
    assert parsed.delta == expected["delta"]


def test_paleta_is_two_pieces():
    parsed = parse_command("wzięliśmy paletę kartonów", ITEMS)
    assert parsed.delta == -SZT_NA_PALETE


def test_unknown_text_returns_none():
    assert parse_command("policz palety na hali", ITEMS) is None
    assert parse_command("jak pakujemy szkło?", ITEMS) is None
    assert parse_command("", ITEMS) is None


def test_unknown_item_returns_none():
    # „paleta" rozpoznana, ale towaru nie ma w bazie → brak propozycji (nic nie dotyka bazy)
    assert parse_command("wzięliśmy paletę śrubek", ITEMS) is None


def test_take_without_palette_returns_none():
    # w tracerze tylko wzorce „paleta X" — inne zdania nie powinny wywołać update_stock
    assert parse_command("wzięliśmy kartony", ITEMS) is None
