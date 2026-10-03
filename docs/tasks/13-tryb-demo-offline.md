# 13: Tryb demo offline — deterministyczna ścieżka przez cały happy path

**What to build:** Jeden przełącznik (env/config) włącza tryb demo: baza seedowana stanem „magazyn przed demo", offline-parser obsługuje wszystkie komendy demo, LLM nie jest potrzebny, STT może paść — i POMIMO to cały 3-beatowy demo script z PRD przechodzi klik po klika. To jest polisa ubezpieczeniowa dema: przed próbą generalną (07:00) tryb musi być domyślny na laptopie prezentacyjnym.

**Blocked by:** 03, 08 (wszystkie elementy happy path istnieją)

**Estimate:** 0.5 / 1.5

**Owner:** A

**TDD:** smoke test happy path w trybie offline: sekwencja komend demo przez API daje oczekiwane stany bazy po każdym beacie (bez żadnego wywołania zewnętrznego API — test gwarantuje to mockiem sieci).

**Demo check:** wyłącz wifi na laptopie → `docker compose up` w trybie demo → cały scenariusz z PRD przechodzi: import (z lokalnego pliku), strefy, zmiana głosem/tekstem, reorder, procedura, mapa.

**Status:** implemented — po migracji Next.js/PGlite: launcher produkcyjny w Pythonie i instrukcja próby. Pełny happy path przeszedł 2026-10-04 na launcherze offline (port 3002, `PGlite`, zmienne chmurowe wyzerowane przez launcher, parser offline, auth wyłączone): import/seed → strefy ×3 → zmiana 13→11 → reorder w kolejce → undo → procedura → lokalizacja z podświetleniem mapy (dowody `gui-test-screenshots/t10–t20`). Fizyczne odcięcie wifi na laptopie prezentacyjnym — 2 minuty przed próbą generalną 07:00 (aplikacja nie ma ścieżki sieciowej: assety lokalne, brak CDN).

- [x] całe demo działa z wyłączonym internetem — pełna ścieżka GUI-check 2026-10-04 na launcherze offline; przed próbą 07:00 powtórzyć z wifi wyłączonym fizycznie
- [x] seed „stanu przed demo" jednym przełącznikiem
- [x] brak jakichkolwiek wywołań zewnętrznych w obecnym scenariuszu API demo (zweryfikowane testem)
- [x] przełącznik trybu demo opisany w README

## Aktualne uruchomienie po migracji Next.js

`python scripts/start-demo.py --build --reset` przygotowuje build i bazę demo online.
Kolejne próby: `python scripts/start-demo.py --reset`, port 3002, bez kompilacji
i instalowania zależności. Osobna lokalna baza `data/pglite-demo`, chmurowe
LLM/STT wyłączone, tekstowy fallback, brak logowania na laptopie.
Brak buildu i zajęty port są wykrywane przed resetem; zwykła baza nie jest resetowana.
Testy launchera: `python -m unittest discover -s scripts -p test_start_demo.py`.
Pełna instrukcja: `docs/demo-offline.md`.

## Historia implementacji legacy (nie dotyczy nowego launchera)

`DEMO_MODE=1` wybiera izolowaną bazę i blokuje LLM także z ustawionym kluczem.
`python -m app.demo --reset` resetuje oznaczoną bazę demo po zatrzymaniu backendu.
`demo-offline.xlsx` ma Kartony 13/minimum 12, dzięki czemu pierwsza paleta tworzy reorder.
Oryginalny plik Excela zespołu pozostaje bez zmian. Tekst jest fallbackiem STT;
nowe integracje STT/LLM muszą respektować flagę demo przed wywołaniem API.

Uruchomienie prezentacyjne: `scripts/start-demo.ps1` (wcześniej `-Build`, nowa próba `-Reset`).
Konfiguracja `docker-compose.demo.yml` wymusza offline, osobny wolumen `demo-data`
i lokalny download Excela. Bez `-Build` skrypt nie buduje ani nie pobiera obrazów.
Mapa z karty 07 została zintegrowana z origin/main na branchu demo.
GUI-check: komenda `strefa: kartony` → confirm → strefa widoczna na mapie;
kliknięcie pokazuje Kartony 11 szt. Uruchomienie Dockera jest niezweryfikowane
w tej sesji (brak CLI); składnia PowerShell i kolejność komend sprawdzone atrapą Docker.

Lokalny launcher bez Dockera: `scripts/start-demo-local.py` uruchamia backend 8001
i frontend 5174 z osobną bazą `backend/magazyn-demo-local.db`; `--reset` rozpoczyna
nową próbę, Ctrl+C zatrzymuje serwery. Wymaga wcześniej przygotowanych zależności,
nie pobiera niczego i wymusza brak chmurowego LLM/STT. Nie zastępuje próby Dockera
ani brakujących funkcji kolegów z kart 06/07/10.

Opcja `--built` w lokalnym launcherze serwuje wcześniej przygotowany
`frontend/dist` przez Vite preview z tym samym proxy API/WS i portami.
Nie kompiluje i nie pobiera zależności przy starcie; brak buildu jest wykrywany
przed resetem. Po zmianach UI trzeba ponowić `npm run build`.
