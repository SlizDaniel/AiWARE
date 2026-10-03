# 09: Sekcja Stany z progami i wizualnymi strefami

**What to build:** Sekcja Stany jako czytelna lista asortymentu: nazwa, ilość, minimum, lokalizacja, pasek poziomu z trzema strefami wizualnymi (zielony OK / żółty „ostatnia szansa" / czerwony poniżej minimum). Wyszukiwarka/filtr po nazwie. Dane bierze z bazy (po imporcie z karty 05 i po zatwierdzeniach z karty 01). To jest ekran, który jury widzi najdłużej — musi wyglądać jak produkt, nie jak tabelka admina.

**Blocked by:** 01 (dane płyną); pełnia wartości po 05

**Estimate:** 0.75 / 1.5

**Owner:** D

**TDD:** seam kontraktu API: fixtura bazy z 3 pozycjami (ok/żółty/czerwony) → poprawny JSON z przypisanymi strefami wizualnymi; test brzegowy (ilość równa dokładnie minimum).

**Demo check:** po imporcie pliku demo Stany pokazuje pozycje we wszystkich 3 kolorach stref; wpisanie w szukajkę filtruje listę bez przeładowania.

**Status:** ready

- [ ] 3 strefy wizualne progów działają zgodnie z fixturą
- [ ] wyszukiwarka filtruje na żywo
- [ ] pasek poziomu czytelny z 3 metrów od ekranu (wielkość projekcji)
- [ ] spójny design z resztą sekcji (design system z karty 01)
