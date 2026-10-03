# 06: Historia zmian (audyt) + undo

**What to build:** Sekcja Historia pokazuje wszystkie zatwierdzone zmiany (co, kiedy, skąd: głos/tekst/import) w odwrotnej chronologii. Każdy wpis ma przycisk **Undo** — cofa zmianę do wartości poprzedniej i zapisuje się jako nowy wpis „cofnięto" (nic nie znika z dziennika). Zmiany niezatwierdzone (odrzucone karty) mają osobny, przygaszony widok.

**Blocked by:** 01 (wpisy w audycie powstają)

**Estimate:** 0.75 / 1.5

**Owner:** D

**TDD:** seam audytu: sekwencja zapis→undo→zapis daje spójną historię (undo jest wpisem, nie kasowaniem); test niepoprawnego undo (stan zmienił się po wpisie → undo odrzucone z czytelnym komunikatem).

**Demo check:** zatwierdź zmianę → Historia pokazuje wpis → klik Undo → Stany wraca do poprzedniej wartości, Historia ma wpis „cofnięto" na górze.

**Status:** ready

- [ ] lista wpisów: co/kiedy/źródło (głos/tekst/import)
- [ ] Undo jednym kliknięciem działa i zostawia ślad w dzienniku
- [ ] odrzucone propozycje widoczne jako przygaszone
- [ ] undo nie pozwala nadpisać późniejszych zmian bez ostrzeżenia
