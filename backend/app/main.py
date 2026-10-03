"""MAGAZYNIER — backend FastAPI (karta 02: rejestr narzędzi + 6 komend offline).

Kontrakt HTTP/WS (seam 3 z PRD):
  POST /api/command                   → proposal (karta zmiany) | answer | clarify | unknown
  POST /api/proposals/{id}/confirm    → zapis przez narzędzie write + wpis w audycie + broadcast WS
  GET  /api/stock                     → stany magazynowe
  GET  /api/history                   → wpisy audytu (kto/kiedy/co)
  GET  /api/zones | /api/procedures | /api/orders → odczyt stref, procedur, szkiców zamówień
  WS   /ws                            → push {"event": "updated"} po każdej zmianie

Ścieżka offline: parser deterministyczny (karta 02) gra bez sieci i bez kluczy —
to MockAgent z PRD, gwarantowana ścieżka dema awaryjnego. LLM function calling
(karta 03) podpią się pod ten sam rejestr narzędzi i kontrakt odpowiedzi.

Zasada confirm-before-write: narzędzia „write” wykonują się WYŁĄCZNIE w
/confirm; niezatwierdzone propozycje żyją w pamięci procesu i NIE dotykają bazy.
Pytania (read) nie zapisują niczego.
"""
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import db
from app.agent_contract import normalize_call, tool_schemas
from app.llm import LLMProviderError, provider_from_env

from app.inventory import FIELDS, MAX_UPLOAD_BYTES, REQUIRED_FIELDS, ImportFileError, read_inventory_file, suggest_mapping, validate_and_map_rows

from app.models import ItemRef
from app.parser import ParsedCommand, parse_command
from app.tools import TOOL_REGISTRY, call_tool

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "magazyn.db")

READ_TOOLS = {name for name, spec in TOOL_REGISTRY.items() if spec.kind == "read"}

HINTS = [
    "wzięliśmy paletę X",
    "doszła paleta X",
    "strefa: X",
    "ile mamy X?",
    "gdzie leży X?",
    "jak pakujemy X?",
]


class CommandIn(BaseModel):
    text: str


class AgentModeIn(BaseModel):
    mode: Literal["llm", "offline", "mock"]


class ImportConfirm(BaseModel):
    import_id: str
    mapping: dict[str, int | None]



def create_app(db_path: str | None = None) -> FastAPI:
    path = str(db_path or os.environ.get("MAGAZYNIER_DB") or DEFAULT_DB_PATH)

    requested_mode = os.environ.get("LLM_MODE", "llm").lower()
    if requested_mode not in {"llm", "offline", "mock"}:
        requested_mode = "llm"

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        db.init_db(path)
        yield

    app = FastAPI(title="MAGAZYNIER", version="0.2.0", lifespan=lifespan)
    app.state.db_path = path
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
        return {"status": "ok", "mode": "offline-parser"}

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

    @app.get("/api/zones")
    def zones() -> dict:
        return {"zones": db.list_zones(path)}

    @app.get("/api/procedures")
    def procedures() -> dict:
        return {"procedures": db.list_procedures(path)}

    @app.post("/api/command")
    async def command(body: CommandIn) -> dict:
        rows = db.list_items(path)
        items = [ItemRef(id=r["id"], name=r["name"]) for r in rows]
        requested = requested_mode
        warning = None
        parsed = None

        if requested == "llm" and os.environ.get("LLM_API_KEY", "").strip():
            inventory_context = ", ".join(
                f"id={row['id']}, nazwa={row['name']}, ilość={row['quantity']} {row['unit']}, "
                f"minimum={row['minimum']}, lokalizacja={row['location']}"
                for row in rows
            )
            try:
                interpretation = await provider_from_env().interpret(
                    body.text, tool_schemas(), "W tym demo jedna paleta = 2 jednostki towaru. " + inventory_context
                )
                if interpretation.tool_call is None:
                    return {
                        "type": "clarify",
                        "text": body.text,
                        "message": interpretation.clarification or "Doprecyzuj polecenie.",
                    }
                parsed = normalize_call(interpretation.tool_call, body.text, items)
            except LLMProviderError:
                parsed = parse_command(body.text, items)
                warning = "LLM nie zwrócił poprawnej propozycji — użyto parsera offline."
        else:
            parsed = parse_command(body.text, items)
            if requested == "llm":
                warning = "Brak LLM_API_KEY — użyto parsera offline."
            elif requested == "mock":
                warning = "Tryb mock używa na razie parsera offline."

        response = await dispatch_command(body, parsed)
        if warning:
            response["warning"] = warning
        return response

    async def dispatch_command(body: CommandIn, parsed: ParsedCommand | None) -> dict:
        if parsed is None:
            # nieznana komenda → prośba o doprecyzowanie, nigdy ciche zgadywanie
            return {"type": "unknown", "text": body.text, "hints": HINTS}

        if parsed.missing_item and parsed.tool == "update_stock":
            # brak przedmiotu w bazie → propozycja DODANIA (karta zmiany)
            name = parsed.missing_item[0].upper() + parsed.missing_item[1:]
            proposal = _proposal(
                tool="add_item",
                text=body.text,
                args={"name": name, "quantity": 0, "unit": "szt"},
                summary=f"Nowa pozycja: {name} (0 szt)",
                item_name=name,
            )
            return {"type": "proposal", "proposal": proposal}

        if parsed.missing_item:
            return {
                "type": "clarify",
                "text": body.text,
                "message": (
                    f"Nie znam pozycji «{parsed.missing_item}» — nie ma jej w bazie. "
                    "Dodaj ją w sekcji Stany albo zaimportuj Excel."
                ),
            }

        if parsed.tool in READ_TOOLS:
            data = call_tool(path, parsed.tool, **parsed.args)
            return _answer(path, body.text, parsed, data)

        if parsed.tool in {"add_item", "draft_order"}:
            if parsed.tool == "add_item":
                summary = f"Nowa pozycja: {parsed.args['name']} ({parsed.args.get('quantity', 0)} {parsed.args.get('unit', 'szt')})"
            else:
                summary = f"Szkic zamówienia: {parsed.item_name} — {parsed.args['quantity']}"
            proposal = _proposal(tool=parsed.tool, text=body.text, args=parsed.args, summary=summary)
            return {"type": "proposal", "proposal": proposal}

        if parsed.tool == "add_zone":
            proposal = _proposal(
                tool="add_zone",
                text=body.text,
                args=parsed.args,
                summary=f"Nowa strefa: {parsed.args['name']}",
            )
            return {"type": "proposal", "proposal": proposal}

        if parsed.tool == "remember_procedure":
            proposal = _proposal(
                tool="remember_procedure",
                text=body.text,
                args=parsed.args,
                summary=f"Zapamiętaj procedurę: {parsed.args['topic']}",
            )
            return {"type": "proposal", "proposal": proposal}

        if parsed.tool == "update_stock":
            item = db.get_item(path, parsed.item_id)
            if item is None:
                return {"type": "unknown", "text": body.text, "hints": HINTS}
            before = item["quantity"]
            after = before + parsed.delta
            proposal = _proposal(
                tool="update_stock",
                text=body.text,
                args=parsed.args,
                summary=f"{item['name']} {before}→{after}",
                item_id=item["id"],
                item_name=item["name"],
                unit=item["unit"],
                delta=parsed.delta,
                before=before,
                after=after,
            )
            return {"type": "proposal", "proposal": proposal}

        return {"type": "unknown", "text": body.text, "hints": HINTS}

    @app.post("/api/proposals/{proposal_id}/confirm")
    async def confirm(proposal_id: str) -> dict:
        proposal = PROPOSALS.pop(proposal_id, None)
        if proposal is None:
            raise HTTPException(status_code=404, detail="Nie ma takiej propozycji (lub została już rozpatrzona)")
        tool = proposal["tool"]

        # zapis WYŁĄCZNIE przez rejestr narzędzi (confirm-before-write) —
        # /confirm nie zna logiki bazodanowej, tylko wykona narzędzie z karty
        try:
            if tool == "update_stock":
                result = call_tool(path, tool, **proposal["args"], text=proposal["text"])
            else:
                result = call_tool(path, tool, **proposal["args"])
        except KeyError as exc:
            raise HTTPException(status_code=400, detail=f"Nieznane narzędzie: {tool}") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if tool == "update_stock":
            payload: dict[str, Any] = {"applied": True, **result}
        elif tool == "draft_order":
            # create_reorder_draft already records the creation in the same transaction.
            payload = {"applied": True, "tool": tool, "reorder_draft": result, **result}
        else:
            # audyt zmian innych niż stany — wartości spójne z kartą 08
            # (reorder_draft_created dla szkicu zamówień, zarówno proaktywnych,
            # jak i tych z narzędzia draft_order)
            event_type = {
                "add_zone": "zone_added",
                "add_item": "item_added",
                "remember_procedure": "procedure_saved",
                "draft_order": "reorder_draft_created",
            }[tool]
            label = result.get("name") or result.get("item_name") or result.get("topic") or ""
            audit = db.log_event(path, event_type=event_type, text=proposal["text"], label=label)
            payload = {"applied": True, "tool": tool, **result, **audit}

        await broadcast({"event": "updated"})
        return payload

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


def _proposal(**fields: Any) -> dict:
    proposal = {"id": uuid.uuid4().hex, **fields}
    PROPOSALS[proposal["id"]] = proposal
    return proposal


def _answer(path: str, text: str, parsed: Any, data: dict) -> dict:
    """Odpowiedź na pytanie (read) — samo odczytanie bazy, nic nie zapisuje."""
    if parsed.tool == "check_reorder":
        if not data:
            return {"type": "clarify", "text": text, "message": "Nie znaleziono pozycji."}
        status = "poniżej minimum" if data["below_minimum"] else "minimum zachowane"
        return {
            "type": "answer", "tool": parsed.tool, "data": data,
            "text": f"{data['item_name']}: {data['quantity']} (minimum {data['minimum']}) — {status}.",
        }
    if parsed.tool == "get_stock":
        item = data.get("item")
        if item is not None:
            loc = item["location"] or "brak lokalizacji"
            body = f"{item['name']}: {item['quantity']} {item['unit']} (minimum {item['minimum']}) — {loc}."
        else:
            items = data.get("items", [])
            body = "Na stanie: " + ", ".join(f"{i['name']} {i['quantity']} {i['unit']}" for i in items) + "."
        return {"type": "answer", "tool": "get_stock", "text": body, "data": data}

    if parsed.tool == "get_location":
        if not data:
            return {"type": "unknown", "text": text, "hints": HINTS}
        loc = data["location"] or "brak lokalizacji"
        return {
            "type": "answer",
            "tool": "get_location",
            "text": f"{data['item_name']} leży w: {loc}.",
            "data": data,
        }

    if parsed.tool == "recall_procedure":
        procs = data.get("procedures", [])
        if not procs:
            # brak procedury → proponujemy zapamiętanie, NIE zmyślamy (karta 10)
            return {
                "type": "clarify",
                "text": text,
                "message": (
                    f"Nie mam zapisanej procedury dla «{parsed.args['topic']}». "
                    f"Zapamiętaj ją mówiąc: „zapamiętaj: {parsed.args['topic']} pakujemy w…”"
                ),
            }
        best = procs[0]
        return {
            "type": "answer",
            "tool": "recall_procedure",
            "text": f"Procedura „{best['topic']}”: {best['text']}",
            "data": data,
        }

    return {"type": "unknown", "text": text, "hints": HINTS}


# Propozycje niezatwierdzone — in-memory; nigdy nie dotykają bazy.
PROPOSALS: dict[str, dict[str, Any]] = {}

app = create_app()
