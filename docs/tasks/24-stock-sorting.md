# 24: Sortowanie i filtrowanie stanów

Owner: A. Branch: `feat/stock-sorting`.

Na prośbę użytkownika rozszerzamy webowy widok Stany. Bez zmian API i bazy.

## Kryteria

- Wybór sortowania: nazwa A–Z (domyślnie), braki najpierw, stan rosnąco,
  stan malejąco, lokalizacja A–Z (naturalny porządek B-2 przed B-10).
- Braki najpierw: zerowe stany (także bez minimum), poniżej minimum,
  blisko minimum, OK. W grupie porównanie stanu do minimum; remisy nazwa i ID.
- Filtry: wszystkie, braki i poniżej minimum, zerowy stan. Łączą się z wyszukiwaniem.
- Licznik wyświetlanych pozycji i możliwość wyczyszczenia pustego filtra.
- Kolejność opiera się na zapisanym stanie; karta oczekująca nie zmienia porządku.
  Po aktualizacji danych sortowanie i filtrowanie przeliczają się automatycznie.
- Nie mutujemy danych wejściowych ani nie zmieniamy edycji, importu, eksportu.
- Testy logiki, typy, lint, pełna regresja oraz GUI-check przed merge/push.
