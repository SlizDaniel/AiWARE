"""Warstwa SQLite: schemat, seed, odczyt stanów, potwierdzanie zmian, audyt,
strefy, procedury i kolejka szkiców zamówień (karty 02 + 08).

Zasada confirm-before-write: zapisy stanu dzieją się tylko w `confirm_stock_change`
(proaktywny szkic reorderu przy przekroczeniu progu — karta 08); reszta zapisów
(strefa, pozycja, procedura, szkic zamówienia z narzędzia `draft_order`) idzie
przez `log_event`/`create_reorder_draft` dopiero po zatwierdzeniu karty.
"""
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE,
    quantity INTEGER NOT NULL,
    minimum  INTEGER NOT NULL DEFAULT 0,
    unit     TEXT NOT NULL DEFAULT 'szt',
    location TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    actor     TEXT NOT NULL DEFAULT 'magazynier',
    text      TEXT NOT NULL,
    item_id   INTEGER NOT NULL REFERENCES items(id),
    item_name TEXT NOT NULL,
    delta     INTEGER NOT NULL,
    before    INTEGER NOT NULL,
    after     INTEGER NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'stock_change',
    details   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reorder_drafts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES items(id),
    item_name  TEXT NOT NULL,
    quantity   INTEGER NOT NULL,
    unit       TEXT NOT NULL,
    deliver_on TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_reorder_per_item
ON reorder_drafts(item_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS zones (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    created TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS procedures (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    topic   TEXT NOT NULL UNIQUE,
    text    TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

DEMO_REORDER_QUANTITY = 50

# Seed dema (karta 01): min. 3 pozycje, w tym „Kartony" stan 54, minimum 12.
SEED_ITEMS = [
    ("Kartony", 54, 12, "szt", "Strefa A-1"),
    ("Szkło", 20, 8, "szt", "Strefa B-2"),
    ("Folia stretch", 15, 6, "rolka", "Strefa C-1"),
]


@contextmanager
def connect(db_path: str):
    # SQLite ma wymuszanie kluczy obcych wyłączone domyślnie i świadomie tego nie
    # włączamy: audyt wpisuje item_id=0 dla zdarzeń innych niż stany (strefa,
    # procedura) — patrz log_event.
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path: str) -> None:
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
        # Migrate databases created by the tracer before order decisions were audited.
        audit_columns = {row["name"] for row in conn.execute("PRAGMA table_info(audit_log)")}
        if "event_type" not in audit_columns:
            conn.execute("ALTER TABLE audit_log ADD COLUMN event_type TEXT NOT NULL DEFAULT 'stock_change'")
        if "details" not in audit_columns:
            conn.execute("ALTER TABLE audit_log ADD COLUMN details TEXT NOT NULL DEFAULT ''")
        count = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        if count == 0:
            conn.executemany(
                "INSERT INTO items (name, quantity, minimum, unit, location) VALUES (?, ?, ?, ?, ?)",
                SEED_ITEMS,
            )


def list_items(db_path: str) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, name, quantity, minimum, unit, location FROM items ORDER BY name"
        ).fetchall()
        return [dict(r) for r in rows]


def import_items(db_path: str, items: list[dict]) -> dict[str, int]:
    """Insert new inventory rows and update existing rows by their unique name."""
    with connect(db_path) as conn:
        inserted = 0
        updated = 0
        existing_by_name = {
            str(row["name"]).casefold(): dict(row)
            for row in conn.execute("SELECT id, name, quantity, minimum, unit, location FROM items").fetchall()
        }
        for item in items:
            key = item["name"].casefold()
            existing = existing_by_name.get(key)
            if existing is not None:
                item_id = existing["id"]
                conn.execute(
                    """UPDATE items SET quantity = ?,
                           minimum = CASE WHEN ? IS NULL THEN minimum ELSE ? END,
                           unit = CASE WHEN ? IS NULL OR ? = '' THEN unit ELSE ? END,
                           location = CASE WHEN ? IS NULL THEN location ELSE ? END
                       WHERE id = ?""",
                    (
                        item["quantity"],
                        item["minimum"],
                        item["minimum"],
                        item["unit"],
                        item["unit"],
                        item["unit"],
                        item["location"],
                        item["location"],
                        item_id,
                    ),
                )
                updated += 1
            else:
                cursor = conn.execute(
                    """INSERT INTO items (name, quantity, minimum, unit, location)
                       VALUES (?, ?, ?, ?, ?)""",
                    (item["name"], item["quantity"], item["minimum"] or 0, item["unit"] or "szt", item["location"] or ""),
                )
                item_id = cursor.lastrowid
                inserted += 1
            item_row = conn.execute(
                "SELECT id, name, quantity, minimum, unit, location FROM items WHERE id = ?",
                (item_id,),
            ).fetchone()
            changed_fields = []
            for label, field in (("minimum", "minimum"), ("jednostka", "unit"), ("lokalizacja", "location")):
                previous = existing[field] if existing is not None else None
                current = item_row[field]
                if previous != current:
                    previous_display = "—" if previous is None or previous == "" else previous
                    current_display = "—" if current is None or current == "" else current
                    changed_fields.append(f"{label}: {previous_display}→{current_display}")
            if existing is None:
                changed_fields.insert(0, "nowa pozycja")
            conn.execute(
                "INSERT INTO audit_log (actor, text, item_id, item_name, delta, before, after, event_type, details) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "import",
                    "Import zatwierdzony",
                    item_id,
                    item_row["name"],
                    item_row["quantity"] - (existing["quantity"] if existing is not None else 0),
                    existing["quantity"] if existing is not None else 0,
                    item_row["quantity"],
                    "inventory_import",
                    "; ".join(changed_fields) or "Dane pozycji potwierdzone importem.",
                ),
            )
            _sync_pending_reorder(
                conn,
                item_id=item_row["id"],
                item_name=item_row["name"],
                quantity=item_row["quantity"],
                minimum=item_row["minimum"],
                unit=item_row["unit"],
                source="imporcie",
            )
    return {"inserted": inserted, "updated": updated, "total": len(items)}


def get_item(db_path: str, item_id: int) -> dict | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name, quantity, minimum, unit, location FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return dict(row) if row else None


def _sync_pending_reorder(
    conn: sqlite3.Connection,
    *,
    item_id: int,
    item_name: str,
    quantity: int,
    minimum: int,
    unit: str,
    source: str = "zmianie stanu",
) -> dict | None:
    pending = conn.execute(
        "SELECT * FROM reorder_drafts WHERE item_id = ? AND status = 'pending'",
        (item_id,),
    ).fetchone()
    if quantity < minimum:
        order_quantity = max(DEMO_REORDER_QUANTITY, minimum - quantity)
        if pending is not None:
            if pending["quantity"] != order_quantity or pending["unit"] != unit:
                conn.execute(
                    "UPDATE reorder_drafts SET quantity = ?, unit = ?, item_name = ?, "
                    "updated_at = datetime('now', 'localtime') WHERE id = ?",
                    (order_quantity, unit, item_name, pending["id"]),
                )
                _write_order_audit(
                    conn,
                    item_id=item_id,
                    item_name=item_name,
                    quantity=order_quantity,
                    unit=unit,
                    deliver_on=pending["deliver_on"],
                    event_type="reorder_draft_updated",
                    text=f"Szkic zamówienia zaktualizowany po {source}: {item_name} — {order_quantity} {unit}",
                    before=quantity,
                )
            return None

        deliver_on = _next_tuesday().isoformat()
        draft_cur = conn.execute(
            "INSERT INTO reorder_drafts (item_id, item_name, quantity, unit, deliver_on) "
            "VALUES (?, ?, ?, ?, ?)",
            (item_id, item_name, order_quantity, unit, deliver_on),
        )
        _write_order_audit(
            conn,
            item_id=item_id,
            item_name=item_name,
            quantity=order_quantity,
            unit=unit,
            deliver_on=deliver_on,
            event_type="reorder_draft_created",
            text=f"Szkic zamówienia: {item_name} — {order_quantity} {unit}",
            before=quantity,
        )
        return dict(
            conn.execute(
                "SELECT id, item_id, item_name, quantity, unit, deliver_on, status, created_at, updated_at "
                "FROM reorder_drafts WHERE id = ?",
                (draft_cur.lastrowid,),
            ).fetchone()
        )

    if pending is not None:
        conn.execute("DELETE FROM reorder_drafts WHERE id = ?", (pending["id"],))
        _write_order_audit(
            conn,
            item_id=item_id,
            item_name=item_name,
            quantity=pending["quantity"],
            unit=pending["unit"],
            deliver_on=pending["deliver_on"],
            event_type="reorder_cancelled",
            text=f"Szkic zamówienia anulowany po {source}: {item_name}",
            before=quantity,
        )
    return None


def confirm_stock_change(
    db_path: str,
    *,
    item_id: int,
    delta: int,
    text: str,
    actor: str = "magazynier",
) -> dict | None:
    """Atomowo: zmiana stanu + wpis w audycie. Zwraca wpis audytu (albo None,
    gdy pozycja nie istnieje). Poniżej progu tworzy proaktywny szkic zamówienia
    w Kolejce zatwierdzeń (karta 08) — nigdy nie wysyłany automatycznie."""
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name, quantity, minimum, unit FROM items WHERE id = ?", (item_id,)
        ).fetchone()
        if row is None:
            return None
        before = row["quantity"]
        after = before + delta
        conn.execute("UPDATE items SET quantity = ? WHERE id = ?", (after, item_id))
        cur = conn.execute(
            "INSERT INTO audit_log (actor, text, item_id, item_name, delta, before, after) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (actor, text, item_id, row["name"], delta, before, after),
        )
        audit_id = cur.lastrowid
        draft = _sync_pending_reorder(
            conn,
            item_id=item_id,
            item_name=row["name"],
            quantity=after,
            minimum=row["minimum"],
            unit=row["unit"],
        )
        return {
            "audit_id": audit_id,
            "item_id": item_id,
            "item_name": row["name"],
            "delta": delta,
            "before": before,
            "after": after,
            "reorder_draft": draft,
        }


def _next_tuesday(today: date | None = None) -> date:
    current = today or date.today()
    days_until_tuesday = (1 - current.weekday()) % 7 or 7
    return current + timedelta(days=days_until_tuesday)


def _write_order_audit(
    conn: sqlite3.Connection,
    *,
    item_id: int,
    item_name: str,
    quantity: int,
    unit: str,
    deliver_on: str,
    event_type: str,
    text: str,
    before: int,
) -> None:
    conn.execute(
        "INSERT INTO audit_log (text, item_id, item_name, delta, before, after, event_type, details) "
        "VALUES (?, ?, ?, 0, ?, ?, ?, ?)",
        (
            text,
            item_id,
            item_name,
            before,
            before,
            event_type,
            f"{quantity} {unit}; dostawa {deliver_on}",
        ),
    )


def list_reorder_drafts(db_path: str) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, item_id, item_name, quantity, unit, deliver_on, status, created_at, updated_at "
            "FROM reorder_drafts ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def decide_reorder_draft(db_path: str, draft_id: int, decision: str) -> dict | None:
    if decision not in {"approved", "rejected"}:
        raise ValueError("Nieprawidłowa decyzja szkicu zamówienia")
    with connect(db_path) as conn:
        draft = conn.execute(
            "SELECT * FROM reorder_drafts WHERE id = ? AND status = 'pending'", (draft_id,)
        ).fetchone()
        if draft is None:
            return None
        updated = conn.execute(
            "UPDATE reorder_drafts SET status = ?, updated_at = datetime('now', 'localtime') "
            "WHERE id = ? AND status = 'pending'",
            (decision, draft_id),
        )
        # Another decision can finish after our pending read. Only the writer
        # that changed the status may record a decision or report success.
        if updated.rowcount != 1:
            return None
        item = conn.execute(
            "SELECT quantity FROM items WHERE id = ?", (draft["item_id"],)
        ).fetchone()
        current_stock = item["quantity"] if item else 0
        decision_text = "zatwierdzono" if decision == "approved" else "odrzucono"
        _write_order_audit(
            conn,
            item_id=draft["item_id"],
            item_name=draft["item_name"],
            quantity=draft["quantity"],
            unit=draft["unit"],
            deliver_on=draft["deliver_on"],
            event_type=f"reorder_{decision}",
            text=(
                f"Szkic zamówienia {decision_text}: {draft['item_name']} — "
                f"{draft['quantity']} {draft['unit']}"
            ),
            before=current_stock,
        )
        result = dict(draft)
        result["status"] = decision
        return result


def create_reorder_draft(db_path: str, *, item_id: int, quantity: int) -> dict:
    """Szkic zamówienia z narzędzia `draft_order` (karta 02) — ta sama kolejka
    co proaktywny reorder (karta 08). Idempotentny gdy dla pozycji wisi już pending."""
    with connect(db_path) as conn:
        item = conn.execute(
            "SELECT id, name, quantity, minimum, unit FROM items WHERE id = ?", (item_id,)
        ).fetchone()
        if item is None:
            return {}
        pending = conn.execute(
            "SELECT id FROM reorder_drafts WHERE item_id = ? AND status = 'pending'",
            (item_id,),
        ).fetchone()
        if pending is not None:
            existing = conn.execute(
                "SELECT id, item_id, item_name, quantity, unit, deliver_on, status "
                "FROM reorder_drafts WHERE id = ?",
                (pending["id"],),
            ).fetchone()
            return {**dict(existing), "created": False}
        deliver_on = _next_tuesday().isoformat()
        cur = conn.execute(
            "INSERT INTO reorder_drafts (item_id, item_name, quantity, unit, deliver_on) "
            "VALUES (?, ?, ?, ?, ?)",
            (item_id, item["name"], quantity, item["unit"], deliver_on),
        )
        _write_order_audit(
            conn,
            item_id=item_id,
            item_name=item["name"],
            quantity=quantity,
            unit=item["unit"],
            deliver_on=deliver_on,
            event_type="reorder_draft_created",
            text=f"Szkic zamówienia: {item['name']} — {quantity} {item['unit']}",
            before=item["quantity"],
        )
        return {
            "id": cur.lastrowid,
            "item_id": item_id,
            "item_name": item["name"],
            "quantity": quantity,
            "unit": item["unit"],
            "deliver_on": deliver_on,
            "status": "pending",
            "created": True,
        }


def list_audit(db_path: str) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, ts, actor, text, item_name, delta, before, after, event_type, details "
            "FROM audit_log ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def log_event(
    db_path: str,
    *,
    event_type: str,
    text: str,
    label: str,
    details: str = "",
    actor: str = "magazynier",
) -> dict:
    """Wpis audytu dla zmian innych niż stany (strefa, nowa pozycja, procedura,
    szkic zamówienia z narzędzia). Kolumny liczbowe (item_id=0, delta/before/after=0)
    są neutralne — Historia renderuje te wpisy po `event_type`, nie po delcie."""
    with connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO audit_log (actor, event_type, text, item_id, item_name, delta, before, after, details) "
            "VALUES (?, ?, ?, 0, ?, 0, 0, 0, ?)",
            (actor, event_type, text, label, details),
        )
        return {"audit_id": cur.lastrowid, "event_type": event_type, "item_name": label}


def add_zone(db_path: str, name: str) -> dict:
    """Strefa nazwana podczas spaceru („strefa: X”). Idempotentna po nazwie."""
    name = name.strip()
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name FROM zones WHERE lower(name) = lower(?)", (name,)
        ).fetchone()
        if row is not None:
            return {"id": row["id"], "name": row["name"], "created": False}
        cur = conn.execute("INSERT INTO zones (name) VALUES (?)", (name,))
        return {"id": cur.lastrowid, "name": name, "created": True}


def list_zones(db_path: str) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute("SELECT id, name, created FROM zones ORDER BY name").fetchall()
        return [dict(r) for r in rows]


def remember_procedure(db_path: str, *, topic: str, text: str) -> dict:
    """Zapis/aktualizacja procedury po temacie (ten sam temat → nowa treść)."""
    topic = topic.strip().lower()
    text = text.strip()
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id FROM procedures WHERE lower(topic) = lower(?)", (topic,)
        ).fetchone()
        if row is not None:
            conn.execute("UPDATE procedures SET text = ? WHERE id = ?", (text, row["id"]))
            return {"id": row["id"], "topic": topic, "text": text, "updated": True}
        cur = conn.execute(
            "INSERT INTO procedures (topic, text) VALUES (?, ?)", (topic, text)
        )
        return {"id": cur.lastrowid, "topic": topic, "text": text, "updated": False}


def list_procedures(db_path: str) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute("SELECT id, topic, text, created FROM procedures ORDER BY topic").fetchall()
        return [dict(r) for r in rows]


def find_procedures(db_path: str, query: str) -> list[dict]:
    """Recall po fragmencie tematu LUB treści procedury."""
    fragment = query.strip().casefold()
    with connect(db_path) as conn:
        # SQLite lower() handles ASCII only; Polish uppercase text needs Unicode folding.
        conn.create_function("casefold", 1, str.casefold, deterministic=True)
        rows = conn.execute(
            "SELECT id, topic, text FROM procedures "
            "WHERE instr(casefold(topic), ?) > 0 OR instr(casefold(text), ?) > 0 ORDER BY id DESC",
            (fragment, fragment),
        ).fetchall()
        return [dict(r) for r in rows]


def add_item(
    db_path: str,
    *,
    name: str,
    quantity: int = 0,
    unit: str = "szt",
    minimum: int = 0,
    location: str = "",
) -> dict:
    """Nowa pozycja (ścieżka odtworzenia z karty 02: brak przedmiotu → propozycja dodania)."""
    name = name.strip()
    with connect(db_path) as conn:
        existing = conn.execute("SELECT id FROM items WHERE lower(name) = lower(?)", (name,)).fetchone()
        if existing is not None:
            return {"id": existing["id"], "name": name, "created": False}
        cur = conn.execute(
            "INSERT INTO items (name, quantity, minimum, unit, location) VALUES (?, ?, ?, ?, ?)",
            (name, quantity, minimum, unit, location),
        )
        return {"id": cur.lastrowid, "name": name, "created": True}
