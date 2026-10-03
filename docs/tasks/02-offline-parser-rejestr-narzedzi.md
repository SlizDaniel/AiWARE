# 02: Offline-parser + pełny rejestr narzędzi

**What to build:** Wszystkie narzędzia agenta z PRD istnieją i działają na bazie: `get_stock`, `update_stock`, `check_reorder`, `draft_order`, `get_location`, `add_zone`, `remember_procedure`, `recall_procedure`. Deterministyczny offline-parser mapuje 5–6 komend demo („wzięliśmy paletę X", „doszła paleta X", „strefa: X", „ile mamy X?", „gdzie leży X?", „jak pakujemy X?") na wywołania narzędzi — bez internetu, bez LLM. To gwarantowana ścieżka dema awaryjnego.

**Blocked by:** 01 (kontrakt intencja→narzędzie istnieje)

**Estimate:** 1 / 2

**Owner:** B (+A konsultacja kontraktu)

**TDD:** seam intencja→narzędzie: po jednej fixturze na komendę demo (tekst → oczekiwane narzędzie + argumenty), w tym przypadki brzegowe (nieznana komenda → pytanie o doprecyzowanie, brak przedmiotu w bazie → propozycja dodania).

**Demo check:** w trybie offline (bez klucza API) wpisać po kolei 6 komend demo — każda zwraca poprawną kartę/odpowiedź, nieznanym komendom agent odpowiada prośbą o doprecyzowanie.

**Status:** done — po scaleniu z kartą 08 (rebase na `origin/main`): testy backendu **61/61** (seam 2: 22 fixtur parsera, seam narzędzi: 12, seam 3 HTTP/WS: 20 + test_reorder kart 08, offline: test AST na brak importów sieciowych). Unified audyt: kolumny `event_type`+`details` (kanon z karty 08), narzędzie `draft_order` pisze do ich kolejki `reorder_drafts` (idempotentny pending na pozycję). Demo check GUI-testerem przez przeglądarkę (zrzuty `gui-test-screenshots/`): karty `update_stock`/`add_zone`/`remember_procedure`, odpowiedzi `get_stock`/`get_location`/`recall_procedure`, clarify przy braku procedury, unknown z podpowiedziami, Historia, oraz **scalenie end-to-end**: „wzięliśmy 30 palet kartonów" → stan -6 „Poniżej minimum" → proaktywny szkic w Kolejce → zatwierdzenie szkica → audyt `reorder_*`. Confirm-before-write egzekwowane przez rejestr (`call_tool` w `/confirm`). LLM (karta 03) podpina się pod ten sam `TOOL_REGISTRY` (JSON Schema w `app/tools.py`). Endpointy odczytu `/api/zones`, `/api/procedures` (konsumenci: karty 07/10).

- [x] 8 narzędzi z PRD działa na realnej bazie (nie mock danych)
- [x] 6 komend demo przechodzi przez parser na fixturach
- [x] nieznana komenda → agent pyta o doprecyzowanie (nigdy nie zgaduje po cichu)
- [x] ścieżka offline działa z wyłączonym dostępem do internetu
