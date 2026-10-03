# 08: Progi + reorder + Kolejka zatwierdzeń

**What to build:** Po każdej zatwierdzonej zmianie stanu agent sprawdza próg minimum pozycji; jeśli spadł poniżej — sam składa propozycję zamówienia (ile, na kiedy — prosta reguła z progów) i wrzuca ją do sekcji **Kolejka zatwierdzeń** jako kartę do decyzji. Zatwierdzenie szkica = status „zatwierdzone" (wysyłka do ERP = atrapa z komunikatem „kontrakt webhooka — poza zakresem demo"). Odrzucenie zapisuje się w historii. Nigdy nie ma auto-wysyłki.

**Blocked by:** 01 (pętla po zatwierdzeniu istnieje)

**Estimate:** 1.25 / 2.5

**Owner:** A

**TDD:** seam agenta: fixtury progów (stan=13, min=12 → brak propozycji; stan=10, min=12 → propozycja „50 szt na wtorek"); test, że propozycja JEST kartą w kolejce a nie zapisem zamówienia; test odrzucenia.

**Demo check:** zatwierdź zmianę „wzięliśmy paletę kartonów" (54→52 nie przekracza progu) → potem komenda obniżającą poniżej minimum → Kolejka pokazuje szkic zamówienia → Zatwierdź → status zmieniony, Historia pokazuje decyzję.

**Status:** done — 23 backend tests passed, frontend production build passed, and the browser demo check confirmed the below-minimum flow, queue card, approval, and no-ERP-send state. Verified with local dev servers (Docker unavailable).

**Demo rule implemented:** order quantity is at least 50 units, or the full shortfall to the minimum if that exceeds 50; delivery is proposed for the next Tuesday. The 50-unit fixture in this card remains unchanged.

- [x] propozycja zamówienia powstaje automatycznie po zejściu poniżej progu
- [x] szkic czeka w Kolejce; zatwierdzenie/odrzucenie działa i jest w historii
- [x] nigdy nie ma automatycznej wysyłki (atrapa ERP z czytelnym komunikatem)
- [x] pozycje powyżej progu nie generują szumów

Kolejka domyślnie pokazuje szkice oczekujące na decyzję. Filtry Oczekujące,
Rozpatrzone i Wszystkie mają liczniki; zatwierdzone i odrzucone szkice pozostają
dostępne w Rozpatrzonych. Filtrowanie działa po stronie UI na dotychczasowym
kontrakcie API; decyzje nadal zapisują się w audycie i nie wysyłają zamówień.

Równoczesne decyzje dla jednego szkica: wygrywa wyłącznie pierwsza zmiana statusu
`pending`. Druga nie dopisuje audytu i otrzymuje dotychczasowy HTTP 404 „szkic
nie istnieje albo został już rozpatrzony”. Testy wymuszają równoczesny odczyt
tego samego pending przed aktualizacją, także dla dwóch identycznych decyzji.

Równoczesne `draft_order` dla tego samego towaru zwracają jeden istniejący
szkic zamiast błędu unikalności SQLite. Tylko pierwszy zapis tworzy szkic i audyt;
drugi ma `created=false`, ten sam ID i ilość zwycięskiego szkica, bez nadpisania.
