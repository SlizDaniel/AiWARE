# 02: Offline-parser + pełny rejestr narzędzi

**What to build:** Wszystkie narzędzia agenta z PRD istnieją i działają na bazie: `get_stock`, `update_stock`, `check_reorder`, `draft_order`, `get_location`, `add_zone`, `remember_procedure`, `recall_procedure`. Deterministyczny offline-parser mapuje 5–6 komend demo („wzięliśmy paletę X", „doszła paleta X", „strefa: X", „ile mamy X?", „gdzie leży X?", „jak pakujemy X?") na wywołania narzędzi — bez internetu, bez LLM. To gwarantowana ścieżka dema awaryjnego.

**Blocked by:** 01 (kontrakt intencja→narzędzie istnieje)

**Estimate:** 1 / 2

**Owner:** B (+A konsultacja kontraktu)

**TDD:** seam intencja→narzędzie: po jednej fixturze na komendę demo (tekst → oczekiwane narzędzie + argumenty), w tym przypadki brzegowe (nieznana komenda → pytanie o doprecyzowanie, brak przedmiotu w bazie → propozycja dodania).

**Demo check:** w trybie offline (bez klucza API) wpisać po kolei 6 komend demo — każda zwraca poprawną kartę/odpowiedź, nieznanym komendom agent odpowiada prośbą o doprecyzowanie.

**Status:** ready

- [ ] 8 narzędzi z PRD działa na realnej bazie (nie mock danych)
- [ ] 6 komend demo przechodzi przez parser na fixturach
- [ ] nieznana komenda → agent pyta o doprecyzowanie (nigdy nie zgaduje po cichu)
- [ ] ścieżka offline działa z wyłączonym dostępem do internetu
