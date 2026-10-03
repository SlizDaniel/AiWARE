# 05: Import Excel + mapowanie kolumn przez LLM

**What to build:** Właściciel wgrywa XLSX/CSV (np. „Excel firmy" z brzydkimi nagłówkami typu „Stan [szt]", „Nazwa asortymentu"). Aplikacja czyta nagłówki i pierwsze wiersze, LLM proponuje mapowanie kolumn na pola domenowe (nazwa/ilość/minimum/lokalizacja) z pewnością %, człowiek widzi to na JEDNYM ekranie (podgląd tabeli + przypisane pola) i zatwierdza lub poprawia przez dropdowny → import tworzy stany w bazie, Stany się wypełniają. Czytamy wyłącznie kolumny z wartościami progów — nie parsujemy formuł Excela (roadmapa).

**Blocked by:** 01 (sekcja Stany istnieje); C przygotował `demo-magazyn.xlsx` w ramach przygotowania do 01

**Estimate:** 1.5 / 3

**Owner:** C

**TDD:** seam `InventoryAdapter`: (a) parsowanie `demo-magazyn.xlsx` + 2 wariantów nagłówków → te same obiekty domenowe; (b) propozycja mapowania: fixtura nagłówków → oczekiwane przypisania (LLM i deterministyczny fallback po nazwach: nazwa/ilość/min/lokalizacja); (c) zatwierdzone mapowanie → poprawny seed bazy.

**Demo check:** upload `demo-magazyn.xlsx` na ekranie importu → ekran mapowania pokazuje propozycje → Zatwierdź → sekcja Stany wypełniona danymi z pliku → ponowny import tego samego pliku nie duplikuje pozycji.

**Status:** ready

- [ ] XLSX i CSV wchodzą tym samym ekranem
- [ ] propozycja mapowania LLM + ręczna korekta dropdownem; nic nie zapisuje się przed zatwierdzeniem
- [ ] brak dopasowania kolumny = wyraźne ostrzeżenie, nie cicha zguba danych
- [ ] re-import aktualizuje zamiast duplikować
- [ ] działa na pliku demo z brzydkimi nagłówkami i polskimi znakami
