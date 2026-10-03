"""MAGAZYNIER — backend FastAPI (tracer bullet, karta 01).

Kontrakt HTTP/WS (seam 3 z PRD):
  POST /api/command                    → karta zmiany (propozycja) albo „unknown"
  POST /api/proposals/{id}/confirm     → zapis w SQLite + wpis w audycie + broadcast WS
  GET  /api/stock                      → stany magazynowe
  GET  /api/history                    → wpisy audytu (co/kiedy)
  WS   /ws                             → push {"event": "updated"} po każdej zmianie

Niezatwierdzone propozycje żyją w pamięci procesu i NIE dotykają bazy.
"""
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import db
from app.inventory import FIELDS, MAX_UPLOAD_BYTES, REQUIRED_FIELDS, ImportFileError, read_inventory_file, suggest_mapping, validate_and_map_rows
from app.models import ItemRef
from app.parser import parse_command

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "magazyn.db")


class CommandIn(BaseModel):
    text: str


class ImportConfirm(BaseModel):
    import_id: str
    mapping: dict[str, int | None]


def create_app(db_path: str | None = None) -> FastAPI:
    path = str(db_path or os.environ.get("MAGAZYNIER_DB") or DEFAULT_DB_PATH)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        db.init_db(path)
        yield

    app = FastAPI(title="MAGAZYNIER", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    sockets: set[WebSocket] = set()
    pending_imports: dict[str, tuple[list[str], list[list[str]]]] = {}

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/stock")
    def stock() -> dict:
        return {"items": db.list_items(path)}

    @app.get("/api/history")
    def history() -> dict:
        return {"entries": db.list_audit(path)}

    @app.post("/api/import/preview")
    async def import_preview(request: Request, filename: str) -> dict:
        """Read an uploaded CSV/XLSX and suggest a mapping without writing data."""
        data = await request.body()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Plik jest za duży (limit 5 MB).")
        try:
            headers, rows = read_inventory_file(filename, data)
        except ImportFileError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        import_id = uuid.uuid4().hex
        pending_imports[import_id] = (headers, rows)
        mapping = suggest_mapping(headers)
        missing_required = [
            field for field in REQUIRED_FIELDS if mapping[field]["column"] is None
        ]
        warnings = [
            f"Nie znaleziono kolumny „{field}”. Wybierz ją ręcznie przed importem."
            for field in missing_required
        ]
        if mapping["minimum"]["column"] is None:
            warnings.append("Nie znaleziono minimum — nowe pozycje otrzymają 0, a istniejące zachowają obecny próg.")
        if mapping["location"]["column"] is None:
            warnings.append("Nie znaleziono lokalizacji — nowe pozycje pozostaną bez lokalizacji, a istniejące zachowają obecną.")
        return {
            "import_id": import_id,
            "headers": [{"index": index, "label": header or f"Kolumna {index + 1}"} for index, header in enumerate(headers)],
            "preview": rows[:5],
            "row_count": len(rows),
            "mapping": mapping,
            "missing_required": missing_required,
            "warnings": warnings,
        }

    @app.post("/api/import/confirm")
    async def import_confirm(body: ImportConfirm) -> dict:
        """Validate the user's selected mapping, then atomically upsert inventory."""
        pending = pending_imports.get(body.import_id)
        if pending is None:
            raise HTTPException(status_code=404, detail="Podgląd importu wygasł. Wczytaj plik ponownie.")
        headers, rows = pending
        mapping = {field: body.mapping.get(field) for field in FIELDS}
        try:
            imported_items = validate_and_map_rows(headers, rows, mapping)
        except ImportFileError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        result = db.import_items(path, imported_items)
        pending_imports.pop(body.import_id, None)
        await broadcast({"event": "updated"})
        return result

    @app.get("/api/reorder-drafts")
    def reorder_drafts() -> dict:
        return {"drafts": db.list_reorder_drafts(path)}

    @app.post("/api/reorder-drafts/{draft_id}/approve")
    async def approve_reorder_draft(draft_id: int) -> dict:
        result = db.decide_reorder_draft(path, draft_id, "approved")
        if result is None:
            raise HTTPException(status_code=404, detail="Szkic nie istnieje albo został już rozpatrzony")
        await broadcast({"event": "updated"})
        return {"approved": True, "sent_to_erp": False, "draft": result}

    @app.post("/api/reorder-drafts/{draft_id}/reject")
    async def reject_reorder_draft(draft_id: int) -> dict:
        result = db.decide_reorder_draft(path, draft_id, "rejected")
        if result is None:
            raise HTTPException(status_code=404, detail="Szkic nie istnieje albo został już rozpatrzony")
        await broadcast({"event": "updated"})
        return {"rejected": True, "draft": result}

    @app.post("/api/command")
    async def command(body: CommandIn) -> dict:
        items = [ItemRef(id=r["id"], name=r["name"]) for r in db.list_items(path)]
        parsed = parse_command(body.text, items)
        if parsed is None:
            return {"type": "unknown", "text": body.text}
        item = db.get_item(path, parsed.item_id)
        assert item is not None
        before = item["quantity"]
        after = before + parsed.delta
        proposal: dict[str, Any] = {
            "id": uuid.uuid4().hex,
            "tool": parsed.tool,
            "item_id": parsed.item_id,
            "item_name": parsed.item_name,
            "unit": item["unit"],
            "delta": parsed.delta,
            "before": before,
            "after": after,
            "summary": f"{parsed.item_name} {before}→{after}",
            "text": body.text,
        }
        PROPOSALS[proposal["id"]] = proposal
        return {"type": "proposal", "proposal": proposal}

    @app.post("/api/proposals/{proposal_id}/confirm")
    async def confirm(proposal_id: str) -> dict:
        proposal = PROPOSALS.pop(proposal_id, None)
        if proposal is None:
            raise HTTPException(status_code=404, detail="Nie ma takiej propozycji (lub została już rozpatrzona)")
        result = db.confirm_stock_change(
            path,
            item_id=proposal["item_id"],
            delta=proposal["delta"],
            text=proposal["text"],
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Pozycja nie istnieje w bazie")
        await broadcast({"event": "updated"})
        return {"applied": True, **result}

    async def broadcast(message: dict) -> None:
        for sock in list(sockets):
            try:
                await sock.send_json(message)
            except Exception:
                sockets.discard(sock)

    @app.websocket("/ws")
    async def ws(sock: WebSocket) -> None:
        await sock.accept()
        sockets.add(sock)
        try:
            while True:
                # klient może wysyłać pingi; backend niczego od niego tu nie wymaga
                await sock.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            sockets.discard(sock)

    return app


# Propozycje niezatwierdzone — in-memory (tracer); nigdy nie dotykają bazy.
PROPOSALS: dict[str, dict[str, Any]] = {}

app = create_app()
