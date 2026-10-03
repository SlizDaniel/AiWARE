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

Przy aktywnym trybie `llm` mapowanie korzysta ze wspólnego providera: wysyła nagłówki oraz pierwsze 5 wierszy do skonfigurowanego API. UI pokazuje źródło sugestii i szacowaną pewność; zawsze możesz poprawić kolumny. Błędna odpowiedź, timeout lub brak klucza uruchamiają jawny fallback po nazwach kolumn. Tryby offline/mock oraz DEMO_MODE nie wysyłają plików do AI. Formuły Excela nie są obliczane. Integrację AI zweryfikowano kontrolowanymi odpowiedziami HTTP; próba z usługą wymaga `LLM_API_KEY`.

Aktualne stany, minima, lokalizacje i jednostki pobierzesz z sekcji **Stany** przyciskami **Eksportuj CSV** lub **Eksportuj XLSX**. Oba formaty można ponownie zaimportować bez utraty danych ani tworzenia duplikatów.

W **Ustawieniach** zmienisz prefix agenta, tryb LLM/offline/mock, źródło danych, domyślne minimum i tryb mikrofonu. Zapis obowiązuje od następnej komendy i przetrwa restart (tabela `app_settings` w tej samej bazie SQLite). Komendy bez prefixu nadal działają; zastąpione prefixy są odrzucane. Domyślne minimum dotyczy nowych pozycji bez własnego progu; nie zmienia istniejących minimów ani jawnego zera w pliku. Import XLSX/CSV zapisuje dane w bazie i nie synchronizuje automatycznie pliku Excel. Sekcja zawiera wersję aplikacji oraz tekst o użyciu AI do skopiowania do zgłoszenia, bez ujawniania kluczy API.

`LLM_MODE` ustawia tryb przy pierwszym uruchomieniu bazy; później obowiązuje zapisany wybór z UI. `DEMO_MODE=1` zawsze wymusza tryb mock i wyłącza zewnętrzne API. Tryb głosu „tylko tekst” blokuje również endpoint STT. Konfigurację odczytasz przez `GET /api/settings`, a zmienisz przez `PATCH /api/settings`; dotychczasowy `PUT /api/agent-mode` również zapisuje wybór trwale.

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
zmiana stanu nadal wymaga zatwierdzenia karty. Selektor `mock` używa parsera offline;
pełne demo z osobną bazą włącza `DEMO_MODE=1` przy starcie backendu.

Całe oczekiwanie na odpowiedź LLM ma budżet 15 sekund; po jego przekroczeniu
komenda przechodzi do parsera offline. Odpowiedź HTTP większa niż 1 MiB jest
odrzucana przed dekodowaniem JSON. Timeout przerywa oczekiwanie aplikacji;
standardowy wątek HTTP kończy się osobno (nie jest siłowo zatrzymywany).
W jednym procesie mogą trwać najwyżej dwa wywołania LLM. Zajęte oba miejsca
oznaczają natychmiastowy fallback offline; miejsce zwalnia się dopiero po
rzeczywistym zakończeniu żądania HTTP.
JSON odpowiedzi i argumentów funkcji z powtórzonymi kluczami jest odrzucany
(agent nie wybiera po cichu ostatniej wartości). Nadmierne zagnieżdżenie JSON
również uruchamia fallback offline zamiast błędu serwera.

### Próba z rzeczywistym LLM (karta 03)

Ustaw `LLM_API_KEY` lokalnie w `.env` (nie w commicie ani na czacie),
opcjonalnie `LLM_BASE_URL`/`LLM_MODEL`. Wyłącz `DEMO_MODE` i uruchom z repo:

```powershell
.\backend\.venv\Scripts\python.exe .\scripts\check-live-llm.py
```

Skrypt wysyła **trzy rzeczywiste zapytania API**, używając wyłącznie syntetycznych
stanów magazynowych. Sprawdza schematy wszystkich narzędzi, poprawność ID
i oczekiwane narzędzie, towar oraz ilość dla każdego z trzech zdań,
ale nie wykonuje narzędzi ani nie otwiera SQLite. Używa tego samego providera,
walidatora i limitów co aplikacja. Klucz i treść odpowiedzi nie są wypisywane.
Zmienne środowiskowe mają pierwszeństwo przed `.env`; inny plik wskaż przez
`--env-file`. Brak klucza albo włączone demo zwracają kod 2, błąd providera — 1.
Kod 1 oznacza także poprawny składniowo JSON z błędnym narzędziem, towarem
lub ilością. Kod 0 oznacza dopasowane wywołania lub pytania zwrotne zgodnie z
kartą 03; podsumowanie rozróżnia te wyniki. Pytania i cały przepływ karty/confirm
nadal trzeba sprawdzić w GUI. Próba nie ocenia innych zdań poza trzema fixturami.
Przy lokalnym uruchomieniu backendu załaduj ten sam plik jawnie
(z katalogu `backend`): `uv run uvicorn app.main:app --env-file ../.env --reload --port 8000`.
Docker Compose ładuje zmienne z głównego `.env` przy uruchomieniu kontenerów.

Parser offline i LLM korzystają z tego samego rejestru narzędzi z karty 02.
LLM otrzymuje schematy z rejestru; odczyty zwracają odpowiedź, a zapisy tworzą
kartę wymagającą zatwierdzenia. Oryginalną komendę do audytu dostarcza serwer.
Tryb offline nie wymaga zewnętrznych API. Integracja chmurowa została sprawdzona
na kontrolowanych odpowiedziach API; próba z rzeczywistym modelem wymaga klucza.

## Demo offline (karta 13)

### Automatyczne sprawdzenie przed próbą

Z katalogu repo, po przygotowaniu zależności backendu i frontendu:

```powershell
.\backend\.venv\Scripts\python.exe .\scripts\check-demo.py
# Dodatkowo sprawdź konfigurację Compose i działający daemon:
.\backend\.venv\Scripts\python.exe .\scripts\check-demo.py --docker
```

Skrypt uruchamia istniejące testy backendu (w tym demo i import/eksport), build
i typecheck frontendu oraz testy przypisania pozycji do mapy. Kończy się kodem 1,
jeśli któryś krok się nie powiedzie. Nie instaluje zależności, nie resetuje bazy
działającej aplikacji i usuwa klucze API z otoczenia procesów sprawdzających.
Wynik nie zastępuje ręcznej próby GUI, próby prawdziwego LLM/STT ani uruchomienia
przygotowanych obrazów Dockera bez internetu. Samo `--docker` nie uruchamia kontenerów.

### Jedna komenda na laptopie prezentacyjnym

PowerShell, z katalogu repo (Docker Desktop musi działać):

```powershell
# Przygotowanie obrazów, jeszcze z internetem:
.\scripts\start-demo.ps1 -Build
# Kolejne uruchomienie bez pobierania i budowania:
.\scripts\start-demo.ps1
# Nowa próba: zatrzymanie backendu, reset wyłącznie danych demo, start:
.\scripts\start-demo.ps1 -Reset
```

Skrypt używa `docker-compose.demo.yml`, wymusza `DEMO_MODE=1` niezależnie od `.env`,
przeznacza osobny wolumen **`demo-data`** na dane i udostępnia plik importu pod
http://localhost:5173/demo-offline.xlsx. Pobierz go lokalnie i wybierz w importerze.
Uruchomienie bez `-Build` używa `--no-build --pull never`; brak obrazu powoduje
błąd, zamiast próbować pobierać go podczas prezentacji. Skrypt resetuje bazę dopiero
po zatrzymaniu backendu. Nie wykonuje `down -v`.

Odpowiednik bez skryptu:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --no-build --pull never
```

### Jedna komenda bez Dockera

Po przygotowaniu `.venv` backendu i `node_modules` frontendu zgodnie z instrukcją
deweloperską uruchom z katalogu repo:

```powershell
.\backend\.venv\Scripts\python.exe .\scripts\start-demo-local.py
# Po zatrzymaniu poprzedniej próby przez Ctrl+C:
.\backend\.venv\Scripts\python.exe .\scripts\start-demo-local.py --reset
```

Demo otwórz pod http://127.0.0.1:5174. Backend pracuje na porcie 8001;
konfiguracja proxy dla tego uruchomienia jest w `frontend/vite.demo.config.ts`.
Importuj lokalny `demo-offline.xlsx` z głównego katalogu repo. Wpisuj komendy
tekstowo — ten tryb blokuje chmurowe LLM i STT, także gdy masz klucze w otoczeniu.
Skrypt nie pobiera zależności i korzysta z osobnej bazy `backend/magazyn-demo-local.db`.
Zajęty port powoduje błąd przed resetem danych. Ctrl+C zatrzymuje oba serwery demo;
restart bez `--reset` zachowuje wynik poprzedniej próby.
Do próby z gotową wersją interfejsu zbuduj frontend, a potem użyj `--built`:

```powershell
Push-Location frontend
npm run build
Pop-Location
.\backend\.venv\Scripts\python.exe .\scripts\start-demo-local.py --built
# Nowa próba z gotowym buildem:
.\backend\.venv\Scripts\python.exe .\scripts\start-demo-local.py --built --reset
```

`--built` używa lokalnego Vite preview, bez hot reload i kompilacji podczas startu.
Brak `frontend/dist/index.html` przerywa uruchomienie przed resetem bazy.
Po zmianach w frontendzie ponów build, aby próba pokazywała aktualną wersję.
Pełny scenariusz prezentacyjny nadal wymaga undo z karty 06 i próby Dockera offline.

### Włączenie demo przez zmienną środowiskową

W `.env` ustaw **`DEMO_MODE=1`**, następnie uruchom `docker compose up -d`.
Przed odłączeniem internetu przygotuj obrazy przez `docker compose build` — pierwszy
build pobiera zależności. Zbudowana aplikacja działa lokalnie bez kluczy LLM/STT.
Demo wymusza parser offline, nawet z ustawionym kluczem LLM, i blokuje zmianę trybu
przez API oraz selektor. Wpisuj komendy w istniejące pole tekstowe (fallback STT).

W PowerShell bez Dockera (z katalogu `backend`, przy zainstalowanych zależnościach):

```powershell
$env:DEMO_MODE = '1'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Demo używa `backend/magazyn-demo.db` (Docker: `/data/magazyn-demo.db`),
nie zwykłego `magazyn.db`. Opcjonalny `DEMO_DB` wskazuje osobny plik lokalny.
Nowa baza zawiera Kartony 13/minimum 12, Szkło 20/8, Folię 15/6 i procedurę
pakowania szkła. Strefy, historia i kolejka są początkowo puste. Restart zachowuje
zmiany; reset jest jawny i odmawia wyczyszczenia zwykłej, nieoznaczonej bazy.

**Nowa próba — zatrzymaj backend przed resetem:**

```powershell
# Lokalnie, z backend (ten sam DEMO_DB co przy uruchomieniu):
.\.venv\Scripts\python.exe -m app.demo --reset
```

```bash
# Docker używający wyłącznie bazowego docker-compose.yml, z katalogu repo:
docker compose stop backend
docker compose run --rm --no-deps backend python -m app.demo --reset
docker compose up -d
```

Scenariusz próby:

1. Importuj **`demo-offline.xlsx`** z repo, sprawdź mapowanie i zatwierdź.
   Ten wariant ma Kartony 13; oryginalny `demo-magazyn.xlsx` zachowuje 54,
   więc jedna paleta z niego nie przekroczy minimum 12.
2. Wpisz `strefa: kartony`, `strefa: szkło`, `strefa: folia stretch`; zatwierdź każdą kartę.
   Pełna nazwa „folia stretch” pozwala mapie przypisać towar do tej strefy.
3. `wzięliśmy paletę kartonów` → karta 13→11 → zatwierdź → audyt i szkic 50 szt.
4. Otwórz Kolejkę i zatwierdź szkic; to nie wysyła zamówienia do ERP.
5. `ile mamy szkła?`, `gdzie leży szkło?`, `Magu, jak pakujemy szkło?` → odpowiedzi.
6. Możesz dopisać wiedzę: `zapamiętaj: szkło pakujemy z przekładkami` → zatwierdź.

Test `backend/tests/test_demo.py` sprawdza HTTP: import, strefy, stan, audyt,
reorder, lokalizację, procedurę, restart i bezpieczny reset. Blokuje HTTP do sieci
i połączenia socket poza loopback (loopback jest potrzebny pętli asyncio na Windows).
Pełny wizualny scenariusz z mapą, jej podświetleniem i undo wymaga jeszcze
próby GUI i domknięcia undo z karty 06; tryb demo nie zastępuje tych funkcji.

## Sekcje UI

Dostępne: **Stany**, **Historia**, **Kolejka zatwierdzeń**, **Mapa stref**, **Procedury** (+ panel komend z kartą zmiany:
zapis, odpowiedź, doprecyzowanie). Placeholder: Ustawienia (karta 12). Undo w historii — karta 06. STT (głos) — karta 04.

Sekcja **Procedury** pokazuje zapisaną wiedzę i wyszukuje fragmenty tematu lub treści
bez rozróżniania wielkości liter. Komenda `zapamiętaj: szkło pakujemy w kartony Y, strefa C2`
pokazuje treść na karcie przed zatwierdzeniem. Następnie `jak pakujemy szkło?` zwraca
procedurę z przyciskiem **Pokaż na mapie**, jeśli powiązana strefa istnieje i jest jednoznaczna.
Przycisk otwiera Mapę i zaznacza strefę. Do tego przykładu najpierw dodaj `strefa: C2`
i zatwierdź kartę. Nieznana lokalizacja nie podświetla innej strefy. Brak procedury
wywołuje prośbę o jej zapamiętanie. Próba GUI karty 10 przeszła w lokalnym Firefoksie
na osobnej testowej bazie, w tym przejście z odpowiedzi o lokalizacji do strefy procedury.
