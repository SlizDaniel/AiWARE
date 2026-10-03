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
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import db
from app.llm import LLMProviderError, provider_from_env
from app.models import ItemRef
from app.parser import ParsedCommand, parse_command

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "magazyn.db")


class CommandIn(BaseModel):
    text: str


class AgentModeIn(BaseModel):
    mode: Literal["llm", "offline", "mock"]


UPDATE_STOCK_TOOL = {
    "type": "function",
    "function": {
        "name": "update_stock",
        "description": "Proponuje zmianę ilości jednej pozycji magazynowej.",
        "parameters": {
            "type": "object",
            "properties": {
                "item_id": {"type": "integer", "description": "ID z kontekstu magazynu"},
                "delta": {"type": "integer", "description": "Zmiana ilości; ujemna oznacza pobranie"},
            },
            "required": ["item_id", "delta"],
            "additionalProperties": False,
        },
    },
}


def create_app(db_path: str | None = None) -> FastAPI:
    path = str(db_path or os.environ.get("MAGAZYNIER_DB") or DEFAULT_DB_PATH)
    requested_mode = os.environ.get("LLM_MODE", "llm").lower()
    if requested_mode not in {"llm", "offline", "mock"}:
        requested_mode = "llm"

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

    @app.get("/api/agent-mode")
    def get_agent_mode() -> dict:
        key_present = bool(os.environ.get("LLM_API_KEY", "").strip())
        effective_mode = requested_mode
        warning = None
        if requested_mode == "llm" and not key_present:
            effective_mode = "offline"
            warning = "Brak LLM_API_KEY — agent działa w trybie offline."
        elif requested_mode == "mock":
            # Karta 13 rozszerzy mock o pełną, seedowaną ścieżkę demo.
            effective_mode = "offline"
            warning = "Tryb mock używa na razie parsera offline."
        return {
            "mode": requested_mode,
            "effective_mode": effective_mode,
            "llm_available": key_present,
            "warning": warning,
        }

    @app.put("/api/agent-mode")
    def set_agent_mode(body: AgentModeIn) -> dict:
        nonlocal requested_mode
        requested_mode = body.mode
        return get_agent_mode()

    @app.get("/api/stock")
    def stock() -> dict:
        return {"items": db.list_items(path)}

    @app.get("/api/history")
    def history() -> dict:
        return {"entries": db.list_audit(path)}

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
        rows = db.list_items(path)
        items = [ItemRef(id=r["id"], name=r["name"]) for r in rows]
        requested = requested_mode
        warning = None
        parsed = None

        if requested == "llm" and os.environ.get("LLM_API_KEY", "").strip():
            inventory_context = ", ".join(
                f"id={row['id']}, nazwa={row['name']}, ilość={row['quantity']} {row['unit']}"
                for row in rows
            )
            try:
                interpretation = await provider_from_env().interpret(
                    body.text, [UPDATE_STOCK_TOOL], inventory_context
                )
                if interpretation.tool_call is None:
                    return {
                        "type": "unknown",
                        "text": body.text,
                        "message": interpretation.clarification or "Doprecyzuj polecenie.",
                    }
                call = interpretation.tool_call
                args = call.arguments
                row = next(
                    (candidate for candidate in rows if candidate["id"] == args.get("item_id")),
                    None,
                )
                delta = args.get("delta")
                if (
                    call.name != "update_stock"
                    or row is None
                    or not isinstance(delta, int)
                    or isinstance(delta, bool)
                    or delta == 0
                ):
                    raise LLMProviderError("Tool call does not match the inventory contract")
                parsed = ParsedCommand(
                    tool=call.name,
                    item_id=row["id"],
                    item_name=row["name"],
                    delta=delta,
                    text=body.text,
                )
            except LLMProviderError:
                parsed = parse_command(body.text, items)
                warning = "LLM nie zwrócił poprawnej propozycji — użyto parsera offline."
        else:
            parsed = parse_command(body.text, items)
            if requested == "llm":
                warning = "Brak LLM_API_KEY — użyto parsera offline."
            elif requested == "mock":
                warning = "Tryb mock używa na razie parsera offline."

        if parsed is None:
            result = {"type": "unknown", "text": body.text}
            if warning:
                result["warning"] = warning
            return result
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
        result = {"type": "proposal", "proposal": proposal}
        if warning:
            result["warning"] = warning
        return result

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
