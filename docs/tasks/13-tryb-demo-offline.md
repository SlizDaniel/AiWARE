# 13: Tryb demo offline — deterministyczna ścieżka przez cały happy path

**What to build:** Jeden przełącznik (env/config) włącza tryb demo: baza seedowana stanem „magazyn przed demo", offline-parser obsługuje wszystkie komendy demo, LLM nie jest potrzebny, STT może paść — i POMIMO to cały 3-beatowy demo script z PRD przechodzi klik po klika. To jest polisa ubezpieczeniowa dema: przed próbą generalną (07:00) tryb musi być domyślny na laptopie prezentacyjnym.

**Blocked by:** 03, 08 (wszystkie elementy happy path istnieją)

**Estimate:** 0.5 / 1.5

**Owner:** A

**TDD:** smoke test happy path w trybie offline: sekwencja komend demo przez API daje oczekiwane stany bazy po każdym beacie (bez żadnego wywołania zewnętrznego API — test gwarantuje to mockiem sieci).

**Demo check:** wyłącz wifi na laptopie → `docker compose up` w trybie demo → cały scenariusz z PRD przechodzi: import (z lokalnego pliku), strefy, zmiana głosem/tekstem, reorder, procedura, mapa.

**Status:** ready

- [ ] całe demo działa z wyłączonym internetem
- [ ] seed „stanu przed demo" jednym przełącznikiem
- [ ] brak jakichkolwiek wywołań zewnętrznych w trybie offline (zweryfikowane testem)
- [ ] przełącznik trybu demo opisany w README
