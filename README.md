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

## Import stanów z Excela lub CSV

W sekcji **Stany** wybierz **Importuj plik**, wskaż plik `.xlsx` albo `.csv`, sprawdź podgląd i przypisanie kolumn, popraw je w razie potrzeby i kliknij **Zatwierdź import**. Samo wczytanie pliku niczego nie zapisuje. Powtórny import aktualizuje pozycje o tej samej nazwie zamiast tworzyć duplikaty.

Aktualne stany, minima, lokalizacje i jednostki pobierzesz z sekcji **Stany** przyciskami **Eksportuj CSV** lub **Eksportuj XLSX**. Oba formaty można ponownie zaimportować bez utraty danych ani tworzenia duplikatów.

Mapowanie kolumn działa offline na podstawie polskich i angielskich nagłówków; propozycje LLM wymagają podłączenia providera z karty 03.

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

Parser offline i LLM korzystają z tego samego rejestru narzędzi z karty 02.
LLM otrzymuje schematy z rejestru; odczyty zwracają odpowiedź, a zapisy tworzą
kartę wymagającą zatwierdzenia. Oryginalną komendę do audytu dostarcza serwer.
Tryb offline nie wymaga zewnętrznych API. Integracja chmurowa została sprawdzona
na kontrolowanych odpowiedziach API; próba z rzeczywistym modelem wymaga klucza.

## Sekcje UI

Działają: **Stany**, **Historia**, **Kolejka zatwierdzeń** (+ panel komend z kartą zmiany:
zapis, odpowiedź, doprecyzowanie). Placeholdery: Mapa (karta 07), Procedury (karta 10),
Ustawienia (karta 12). Undo w historii — karta 06. STT (głos) — karta 04.
