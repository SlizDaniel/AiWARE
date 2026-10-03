# MAGAZYNIER

Głosowy agent magazynowy: powiedz mu na hali, co robisz — on proponuje zmianę na karcie,
ty ją zatwierdzasz jednym kliknięciem, a strona pokazuje całą wiedzę o magazynie.
HackYeah 2026, Open Task ARTIFICIAL INTELLIGENCE.

> **Tracer bullet (karta 01):** pole tekstowe → backend rozumie intencję → karta zmiany
> („Kartony 54→52") → **Zatwierdź** → zapis w SQLite + wpis w audycie → sekcje Stany i Historia.

## Szybki start (jedna komenda)

```bash
docker compose up --build
```

- Aplikacja: **http://localhost:5173**
- API backendu: http://localhost:8000/docs (FastAPI)

## Demo check (ścieżka weryfikacyjna karty 01)

1. Otwórz http://localhost:5173
2. W panelu „Powiedz Magazynierowi, co robisz" wpisz: **„wzięliśmy paletę kartonów"**
3. Pojawi się **karta zmiany**: `Kartony 54→52` (−2 szt) — nic jeszcze nie jest zapisane
4. Kliknij **Zatwierdź**
5. Sekcja **Stany**: Kartony = 52 · sekcja **Historia**: nowy wpis audytu (co/kiedy)

Parser tracerowy jest deterministyczny (offline): rozpoznaje **6 komend demo**
(wzięliśmy paletę X / doszła paleta X / strefa: X / ile mamy X? / gdzie leży X? / jak pakujemy X?)
plus **„zapamiętaj: X …”** (zapis procedury), i mapuje je na rejestr 8 narzędzi z PRD
(`get_stock`, `update_stock`, `check_reorder`, `draft_order`, `get_location`, `add_zone`,
`remember_procedure`, `recall_procedure`).
Komendy zapisu („paleta”, „strefa”) tworzą **kartę zmiany** i dotykają bazy dopiero po
zatwierdzeniu; pytania dostają odpowiedź bez zapisu; nieznane komendy dostają prośbę
o doprecyzowanie z podpowiedziami — agent nigdy nie zgaduje po cichu. Gdy towaru nie ma
w bazie, agent proponuje jego dodanie (karta zmiany `add_item`).

## Uruchomienie deweloperskie (bez Dockera)

Backend (Python 3.12 + [uv](https://docs.astral.sh/uv/)):

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest        # testy (seam intencja→narzędzie + kontrakt HTTP/WS)
```

Frontend (React + Vite + Tailwind, TypeScript):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxy /api i /ws → :8000)
npm run build        # build produkcyjny
```

Baza SQLite: `backend/magazyn.db` (seedowana przy starcie, jeśli pusta); w Dockerze w wolumenie `backend-data`.

## Struktura

```
backend/    FastAPI + SQLite + WebSocket (parser offline, karta zmiany, audyt)
frontend/   React + Vite + Tailwind (6 sekcji: Mapa, Stany, Kolejka, Historia, Procedury, Ustawienia)
docs/       PRD i karty tasków (single source of truth)
```

## Konfiguracja

`.env.example` — placeholder `LLM_API_KEY` (parser LLM z function calling dołączy w karcie 03,
pod ten sam rejestr narzędzi co offline-parser). Aplikacja działa w 100% offline — żadna
zewnętrzna zależność nie jest potrzebna do dema.

## Sekcje UI

Działają: **Stany**, **Historia**, **Kolejka zatwierdzeń** (+ panel komend z kartą zmiany:
zapis, odpowiedź, doprecyzowanie). Placeholdery: Mapa (karta 07), Procedury (karta 10),
Ustawienia (karta 12). Undo w historii — karta 06. STT (głos) — karta 04.
