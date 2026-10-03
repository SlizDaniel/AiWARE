"""Warstwa SQLite: schemat, seed, odczyt stanów, potwierdzanie zmian, audyt.

Zasada tracer bullet: audyt (i zmiana stanu) zapisywane są tylko w
`confirm_stock_change` — nic nie dotyka bazy przed zatwierdzeniem.
"""
import sqlite3
from contextlib import contextmanager

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
    after     INTEGER NOT NULL
);
"""

# Seed dema (karta 01): min. 3 pozycje, w tym „Kartony" stan 54, minimum 12.
SEED_ITEMS = [
    ("Kartony", 54, 12, "szt", "Strefa A-1"),
    ("Szkło", 20, 8, "szt", "Strefa B-2"),
    ("Folia stretch", 15, 6, "rolka", "Strefa C-1"),
]


@contextmanager
def connect(db_path: str):
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


def get_item(db_path: str, item_id: int) -> dict | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name, quantity, minimum, unit, location FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return dict(row) if row else None


def confirm_stock_change(
    db_path: str,
    *,
    item_id: int,
    delta: int,
    text: str,
    actor: str = "magazynier",
) -> dict | None:
    """Atomowo: zmiana stanu + wpis w audycie. Zwraca wpis audytu (albo None,
    gdy pozycja nie istnieje)."""
    with connect(db_path) as conn:
        row = conn.execute("SELECT id, name, quantity FROM items WHERE id = ?", (item_id,)).fetchone()
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
        return {
            "audit_id": audit_id,
            "item_id": item_id,
            "item_name": row["name"],
            "delta": delta,
            "before": before,
            "after": after,
        }


def list_audit(db_path: str) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, ts, actor, text, item_name, delta, before, after "
            "FROM audit_log ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]
