# 08: Progi + reorder + Kolejka zatwierdzeń

**What to build:** Po każdej zatwierdzonej zmianie stanu agent sprawdza próg minimum pozycji; jeśli spadł poniżej — sam składa propozycję zamówienia (ile, na kiedy — prosta reguła z progów) i wrzuca ją do sekcji **Kolejka zatwierdzeń** jako kartę do decyzji. Zatwierdzenie szkica = status „zatwierdzone" (wysyłka do ERP = atrapa z komunikatem „kontrakt webhooka — poza zakresem demo"). Odrzucenie zapisuje się w historii. Nigdy nie ma auto-wysyłki.

**Blocked by:** 01 (pętla po zatwierdzeniu istnieje)

**Estimate:** 1.25 / 2.5

**Owner:** A

**TDD:** seam agenta: fixtury progów (stan=13, min=12 → brak propozycji; stan=10, min=12 → propozycja „50 szt na wtorek"); test, że propozycja JEST kartą w kolejce a nie zapisem zamówienia; test odrzucenia.

**Demo check:** zatwierdź zmianę „wzięliśmy paletę kartonów" (54→52 nie przekracza progu) → potem komenda obniżającą poniżej minimum → Kolejka pokazuje szkic zamówienia → Zatwierdź → status zmieniony, Historia pokazuje decyzję.

**Status:** ready

- [ ] propozycja zamówienia powstaje automatycznie po zejściu poniżej progu
- [ ] szkic czeka w Kolejce; zatwierdzenie/odrzucenie działa i jest w historii
- [ ] nigdy nie ma automatycznej wysyłki (atrapa ERP z czytelnym komunikatem)
- [ ] pozycje powyżej progu nie generują szumów
