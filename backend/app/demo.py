"""Isolated, persistent offline rehearsal database and explicit reset command."""
import argparse
import os
from pathlib import Path

from app import db

DEFAULT_DEMO_DB = Path(__file__).resolve().parents[1] / "magazyn-demo.db"
PROCEDURE = "Szkło owijamy folią, wkładamy do kartonów z przekładkami; towar leży w Strefie B-2."
# Rehearsal values stay fixed even if the regular seed changes elsewhere.
DEMO_ITEMS = [
    ("Kartony", 13, 12, "szt", "Strefa A-1"),
    ("Szkło", 20, 8, "szt", "Strefa B-2"),
    ("Folia stretch", 15, 6, "rolka", "Strefa C-1"),
]


def demo_db_path() -> str:
    path = Path(os.environ.get("DEMO_DB") or DEFAULT_DEMO_DB).resolve()
    normal = Path(os.environ.get("MAGAZYNIER_DB") or DEFAULT_DEMO_DB.with_name("magazyn.db")).resolve()
    if path == normal:
        raise ValueError("DEMO_DB musi wskazywać inną bazę niż MAGAZYNIER_DB.")
    return str(path)


def init_demo_db(path: str, *, reset: bool = False) -> None:
    """Seed only a new database; never take ownership of existing regular data."""
    with db.connect(path) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if tables and "demo_metadata" not in tables:
            raise ValueError("Baza nie jest bazą demo. Wskaż nowy plik przez DEMO_DB.")
        already_seeded = "demo_metadata" in tables
    db.init_db(path)
    if already_seeded and not reset:
        return
    with db.connect(path) as conn:
        for table in ("audit_log", "reorder_drafts", "zones", "procedures", "items"):
            conn.execute(f"DELETE FROM {table}")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('items', 'zones', 'procedures', 'audit_log', 'reorder_drafts')")
        conn.executemany("INSERT INTO items (name, quantity, minimum, unit, location) VALUES (?, ?, ?, ?, ?)", DEMO_ITEMS)
        conn.execute("INSERT INTO procedures (topic, text) VALUES (?, ?)", ("szkło", PROCEDURE))
        conn.execute("CREATE TABLE IF NOT EXISTS demo_metadata (version INTEGER NOT NULL)")
        conn.execute("DELETE FROM demo_metadata")
        conn.execute("INSERT INTO demo_metadata VALUES (1)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Przygotuj osobną bazę demo (zatrzymaj backend przed resetem).")
    parser.add_argument("--reset", action="store_true", help="Usuń przebieg poprzedniej próby z bazy demo")
    args = parser.parse_args()
    target = demo_db_path()
    init_demo_db(target, reset=args.reset)
    print(f"Baza demo gotowa: {target}")
