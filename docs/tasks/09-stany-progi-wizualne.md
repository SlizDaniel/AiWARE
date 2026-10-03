# 09: Sekcja Stany z progami i wizualnymi strefami

**What to build:** Sekcja Stany jako czytelna lista asortymentu: nazwa, ilość, minimum, lokalizacja, pasek poziomu z trzema strefami wizualnymi (zielony OK / żółty „ostatnia szansa" / czerwony poniżej minimum). Wyszukiwarka/filtr po nazwie. Dane bierze z bazy (po imporcie z karty 05 i po zatwierdzeniach z karty 01). To jest ekran, który jury widzi najdłużej — musi wyglądać jak produkt, nie jak tabelka admina.

**Blocked by:** 01 (dane płyną); pełnia wartości po 05

**Estimate:** 0.75 / 1.5

**Owner:** D

**TDD:** seam kontraktu API: fixtura bazy z 3 pozycjami (ok/żółty/czerwony) → poprawny JSON z przypisanymi strefami wizualnymi; test brzegowy (ilość równa dokładnie minimum).

**Demo check:** po imporcie pliku demo Stany pokazuje pozycje we wszystkich 3 kolorach stref; wpisanie w szukajkę filtruje listę bez przeładowania.

**Status:** ready — GUI-check 2026-10-04 (demo offline, port 3002): wszystkie 3 strefy zaobserwowane na żywo (Folia 15/6 „OK", Kartony 13/12 „Ostatnia szansa", Kartony 11/12 „Poniżej minimum"), szukajka filtruje bez przeładowania („kart" → „1 z 3 pozycji"), legenda 3 kolorów, słupki czytelne na 1440×900. Dowody: `gui-test-screenshots/t10*, t20`.

- [x] 3 strefy wizualne progów działają zgodnie z fixturą
- [x] wyszukiwarka filtruje na żywo
- [x] pasek poziomu czytelny z 3 metrów od ekranu (wielkość projekcji)
- [x] spójny design z resztą sekcji (design system z karty 01)
