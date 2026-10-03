# 06: Historia zmian (audyt) + undo

**What to build:** Sekcja Historia pokazuje wszystkie zatwierdzone zmiany (co, kiedy, skąd: głos/tekst/import) w odwrotnej chronologii. Każdy wpis ma przycisk **Undo** — cofa zmianę do wartości poprzedniej i zapisuje się jako nowy wpis „cofnięto" (nic nie znika z dziennika). Zmiany niezatwierdzone (odrzucone karty) mają osobny, przygaszony widok.

**Blocked by:** 01 (wpisy w audycie powstają)

**Estimate:** 0.75 / 1.5

**Owner:** D

**TDD:** seam audytu: sekwencja zapis→undo→zapis daje spójną historię (undo jest wpisem, nie kasowaniem); test niepoprawnego undo (stan zmienił się po wpisie → undo odrzucone z czytelnym komunikatem).

**Demo check:** zatwierdź zmianę → Historia pokazuje wpis → klik Undo → Stany wraca do poprzedniej wartości, Historia ma wpis „cofnięto" na górze.

**Status:** ready — GUI-check 2026-10-04 (demo offline, port 3002): wpis z co/kiedy/źródło (audyt #4 „Kartony 13→11 · «wzięliśmy paletę kartonów»"), undo z inline potwierdzeniem („Kartony wróci z 11 do 13"), wpis „↺ cofnięcie · cofa wpis #4" na górze, oryginał oznaczony „cofnięte" (nic nie znika). Dowody: `gui-test-screenshots/t15–t17`. Nieweryfikowane w GUI: przygaszone odrzucone karty (brak śladu odrzucenia w Historii — do dodania) i ostrzeżenie undo przy późniejszych zmianach (logika pokryta testami API `tests/stale-stock-proposals`, `src/server/undo.test.ts`).

- [x] lista wpisów: co/kiedy/źródło (głos/tekst/import)
- [x] Undo jednym kliknięciem działa i zostawia ślad w dzienniku
- [ ] odrzucone propozycje widoczne jako przygaszone — GUI-check 2026-10-04: odrzucenie karty nie zostawia żadnego wpisu w Historii; jedyny brak na ścieżce dema
- [ ] undo nie pozwala nadpisać późniejszych zmian bez ostrzeżenia — logika chroniona testami API (stale undo), GUI-check nierobiony
