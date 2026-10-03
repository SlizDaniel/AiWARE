# 13: Tryb demo offline — deterministyczna ścieżka przez cały happy path

**What to build:** Jeden przełącznik (env/config) włącza tryb demo: baza seedowana stanem „magazyn przed demo", offline-parser obsługuje wszystkie komendy demo, LLM nie jest potrzebny, STT może paść — i POMIMO to cały 3-beatowy demo script z PRD przechodzi klik po klika. To jest polisa ubezpieczeniowa dema: przed próbą generalną (07:00) tryb musi być domyślny na laptopie prezentacyjnym.

**Blocked by:** 03, 08 (wszystkie elementy happy path istnieją)

**Estimate:** 0.5 / 1.5

**Owner:** A

**TDD:** smoke test happy path w trybie offline: sekwencja komend demo przez API daje oczekiwane stany bazy po każdym beacie (bez żadnego wywołania zewnętrznego API — test gwarantuje to mockiem sieci).

**Demo check:** wyłącz wifi na laptopie → `docker compose up` w trybie demo → cały scenariusz z PRD przechodzi: import (z lokalnego pliku), strefy, zmiana głosem/tekstem, reorder, procedura, mapa.

**Status:** implemented — infrastruktura i scenariusz API; pełna próba GUI offline po integracji kart 06/07/10

- [ ] całe demo działa z wyłączonym internetem
- [x] seed „stanu przed demo" jednym przełącznikiem
- [x] brak jakichkolwiek wywołań zewnętrznych w obecnym scenariuszu API demo (zweryfikowane testem)
- [x] przełącznik trybu demo opisany w README

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
