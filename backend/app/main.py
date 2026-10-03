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

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import db
from app.models import ItemRef
from app.parser import parse_command

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "magazyn.db")


class CommandIn(BaseModel):
    text: str


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

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/stock")
    def stock() -> dict:
        return {"items": db.list_items(path)}

    @app.get("/api/history")
    def history() -> dict:
        return {"entries": db.list_audit(path)}

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
