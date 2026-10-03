"""Rejestr narzędzi agenta (PRD) — 8 narzędzi na realnej bazie SQLite.

- `kind="read"`  — pytania; wykonywane natychmiast, nie zmieniają bazy.
- `kind="write"` — WYŁĄCZNIE po zatwierdzeniu karty (confirm-before-write).

Każde narzędzie ma JSON Schema argumentów: offline-parser (karta 02) i LLM
function calling (karta 03) grają pod ten sam kontrakt wywołań (seam 2 w PRD).
`add_item` jest poza ósemką z PRD — to ścieżka odtworzenia z karty 02
(brak przedmiotu w bazie → propozycja dodania).
"""
from dataclasses import dataclass
from typing import Callable

from app import db


@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: str  # "read" | "write"
    description: str
    parameters: dict
    handler: Callable[..., dict]


def _schema(properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties, "required": required or []}


def _t_get_stock(db_path: str, *, item_id: int | None = None) -> dict:
    if item_id is None:
        return {"items": db.list_items(db_path)}
    return {"item": db.get_item(db_path, item_id)}


def _t_update_stock(db_path: str, *, item_id: int, delta: int, text: str = "") -> dict:
    result = db.confirm_stock_change(db_path, item_id=item_id, delta=delta, text=text)
    if result is None:
        raise ValueError("Pozycja nie istnieje w bazie")
    return result


def _t_check_reorder(db_path: str, *, item_id: int) -> dict:
    item = db.get_item(db_path, item_id)
    if item is None:
        return {}
    below = item["quantity"] < item["minimum"]
    return {
        "item_id": item["id"],
        "item_name": item["name"],
        "quantity": item["quantity"],
        "minimum": item["minimum"],
        "below_minimum": below,
        "suggested_quantity": max(0, item["minimum"] - item["quantity"]),
    }


def _t_draft_order(db_path: str, *, item_id: int, quantity: int) -> dict:
    draft = db.create_reorder_draft(db_path, item_id=item_id, quantity=quantity)
    if not draft:
        raise ValueError("Pozycja nie istnieje w bazie")
    return draft


def _t_get_location(db_path: str, *, item_id: int) -> dict:
    item = db.get_item(db_path, item_id)
    if item is None:
        return {}
    return {
        "item_id": item["id"],
        "item_name": item["name"],
        "location": item["location"],
        "quantity": item["quantity"],
        "unit": item["unit"],
    }


def _t_remember_procedure(db_path: str, *, topic: str, text: str) -> dict:
    return db.remember_procedure(db_path, topic=topic, text=text)


def _t_recall_procedure(db_path: str, *, topic: str) -> dict:
    return {"procedures": db.find_procedures(db_path, topic)}


TOOL_REGISTRY: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in [
        ToolSpec(
            name="get_stock",
            kind="read",
            description="Ile czego mamy: stan jednej pozycji albo całego magazynu.",
            parameters=_schema(
                {
                    "item_id": {"type": "integer", "description": "ID pozycji; brak = cały magazyn"},
                }
            ),
            handler=_t_get_stock,
        ),
        ToolSpec(
            name="update_stock",
            kind="write",
            description="Zmiana stanu pozycji o delta (np. wzięliśmy/doszła paleta).",
            parameters=_schema(
                {
                    "item_id": {"type": "integer"},
                    "delta": {"type": "integer", "description": "Zmiana stanu, może być ujemna"},
                    "text": {"type": "string", "description": "Oryginalna komenda do audytu"},
                },
                required=["item_id", "delta"],
            ),
            handler=_t_update_stock,
        ),
        ToolSpec(
            name="check_reorder",
            kind="read",
            description="Czy stan poniżej minimum i ile brakuje do progu.",
            parameters=_schema({"item_id": {"type": "integer"}}, required=["item_id"]),
            handler=_t_check_reorder,
        ),
        ToolSpec(
            name="draft_order",
            kind="write",
            description="Szkic zamówienia do Kolejki zatwierdzeń (dostawa we wtorek; nigdy nie wysyłany automatycznie).",
            parameters=_schema(
                {
                    "item_id": {"type": "integer"},
                    "quantity": {"type": "integer"},
                },
                required=["item_id", "quantity"],
            ),
            handler=_t_draft_order,
        ),
        ToolSpec(
            name="get_location",
            kind="read",
            description="Gdzie leży pozycja (lokalizacja/strefa).",
            parameters=_schema({"item_id": {"type": "integer"}}, required=["item_id"]),
            handler=_t_get_location,
        ),
        ToolSpec(
            name="add_zone",
            kind="write",
            description="Nazwanie strefy podczas spaceru („strefa: X”).",
            parameters=_schema({"name": {"type": "string"}}, required=["name"]),
            handler=lambda db_path, *, name: db.add_zone(db_path, name),
        ),
        ToolSpec(
            name="remember_procedure",
            kind="write",
            description="Zapamiętanie procedury („zapamiętaj: X pakujemy w…”).",
            parameters=_schema(
                {"topic": {"type": "string"}, "text": {"type": "string"}},
                required=["topic", "text"],
            ),
            handler=_t_remember_procedure,
        ),
        ToolSpec(
            name="recall_procedure",
            kind="read",
            description="Odszukanie procedury po temacie lub fragmencie („jak pakujemy X?”).",
            parameters=_schema({"topic": {"type": "string"}}, required=["topic"]),
            handler=_t_recall_procedure,
        ),
        ToolSpec(
            name="add_item",
            kind="write",
            description="Dodanie nowej pozycji do bazy (gdy agent nie zna towaru z komendy).",
            parameters=_schema(
                {
                    "name": {"type": "string"},
                    "quantity": {"type": "integer"},
                    "unit": {"type": "string"},
                },
                required=["name"],
            ),
            handler=lambda db_path, *, name, quantity=0, unit="szt": db.add_item(
                db_path, name=name, quantity=quantity, unit=unit
            ),
        ),
    ]
}


def call_tool(db_path: str, tool: str, **kwargs) -> dict:
    """Wywołanie narzędzia po nazwie — punkt wejścia dla parsera offline i (później) LLM."""
    return TOOL_REGISTRY[tool].handler(db_path, **kwargs)
