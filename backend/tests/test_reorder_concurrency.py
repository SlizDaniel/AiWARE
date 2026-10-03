"""Task 08: concurrent decisions must produce a single status and audit entry."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading
from types import SimpleNamespace

import pytest

from app import db


@pytest.mark.parametrize("decisions", [("approved", "rejected"), ("approved", "approved"), ("rejected", "rejected")])
def test_two_decisions_after_same_pending_read_record_only_one(monkeypatch, tmp_path, decisions):
    path = str(tmp_path / "stock.db")
    db.init_db(path)
    draft = db.create_reorder_draft(path, item_id=1, quantity=50)
    original_connect = db.connect
    both_have_read = threading.Barrier(2)

    class Connection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, sql, parameters=()):
            cursor = self.connection.execute(sql, parameters)
            if sql == "SELECT * FROM reorder_drafts WHERE id = ? AND status = 'pending'":
                row = cursor.fetchone()
                both_have_read.wait(timeout=5)
                return SimpleNamespace(fetchone=lambda: row)
            return cursor

    @contextmanager
    def simultaneous_read(db_path):
        with original_connect(db_path) as connection:
            yield Connection(connection)

    monkeypatch.setattr(db, "connect", simultaneous_read)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda decision: db.decide_reorder_draft(path, draft["id"], decision),
                                   decisions))
    accepted = [result for result in results if result is not None]
    assert len(accepted) == 1
    with original_connect(path) as connection:
        status = connection.execute("SELECT status FROM reorder_drafts WHERE id = ?", (draft["id"],)).fetchone()["status"]
        decisions = connection.execute("SELECT event_type FROM audit_log WHERE event_type IN ('reorder_approved', 'reorder_rejected')").fetchall()
    assert status == accepted[0]["status"]
    assert [row["event_type"] for row in decisions] == [f"reorder_{status}"]
