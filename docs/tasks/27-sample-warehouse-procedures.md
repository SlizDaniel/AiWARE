# 27: Przykładowe procedury magazynu

Owner A. Branch `feat/sample-warehouse-procedures`.

- Trzy reguły dla istniejących produktów z instrukcjami przy brakach i uszkodzeniu.
- Sześć scenariuszy: pakowanie, brak opakowania/towaru, uszkodzenie, rozbieżność, ostatnia rolka.
- Importer Python do lokalnego izolowanego demo, karty + confirm + audyt.
- Nie zmienia zapasu ani własnych reguł; bez duplikatów przy ponowieniu.
- Widoczne w Procedurach i źródłach pomocy. Jawnie fikcyjne przykłady.

## Weryfikacja

25 testów Python (7 nowych) i 919 testów aplikacji przeszło, 2 pominięte.
W działającym demo dodano 3 reguły przez proposal + confirm; ponowienie: 0 nowych,
3 bez zmian. GUI pokazuje trzy reguły, wyszukuje „brak”, a „jak pakujemy szkło?”
zwraca pełną instrukcję z przypadkami wyjątkowymi. Nie zmieniano stanów.
