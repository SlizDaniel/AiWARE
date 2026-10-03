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

Parser tracerowy jest deterministyczny (offline): rozpoznaje wyłącznie
„wzięliśmy paletę X" (−2 szt/paletę) i „doszła paleta X" (+2 szt/paletę) na seedowanych
pozycjach (Kartony 54/min 12, Szkło 20/min 8, Folia stretch 15/min 6).

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

## Tryb agenta

Skopiuj `.env.example` do `.env`. Ustaw `LLM_API_KEY`, aby włączyć chmurowe function calling;
`LLM_BASE_URL` i `LLM_MODEL` pozwalają wskazać zgodny endpoint i model. Bez klucza aplikacja
automatycznie używa parsera offline i pokazuje ostrzeżenie. Tryb można zmienić bez restartu
przez selektor w panelu komend albo API: `GET /api/agent-mode` i `PUT /api/agent-mode`
z JSON-em `{"mode":"llm"}`, `{"mode":"offline"}` lub `{"mode":"mock"}`.

Warstwa providerów przyjmuje standardowe schematy funkcji OpenAI i waliduje odpowiedź przed
przekazaniem wywołania dalej. Błędna odpowiedź lub błąd sieci wraca do parsera offline;
zmiana stanu nadal wymaga zatwierdzenia karty. Tryb `mock` używa obecnie parsera offline;
pełny seedowany scenariusz demo należy do karty 13.

## Sekcje UI

Działają: **Stany**, **Historia** (+ panel komend z kartą zmiany). Placeholdery: Mapa (karta 03),
Kolejka zatwierdzeń (karta 07), Procedury (karta 08), Ustawienia (karta 09).
Undo w historii — karta 06. STT (głos) — karta 02.
