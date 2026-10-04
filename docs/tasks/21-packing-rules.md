# 21 — Zatwierdzone reguły pakowania

## Cel
Zastąpić dowolne wpisywanie procedur regułami powiązanymi z produktem i katalogiem opakowań.

## Zakres
- Jedna reguła na istniejący produkt: Koperta / Mały karton / Duży karton / Folia stretch, dodatnia całkowita ilość produktu na opakowanie i opcjonalne uwagi do 500 znaków.
- Kierownik tworzy i edytuje reguły na stronie lub przez agenta; każde zapisanie wymaga podglądu i potwierdzenia.
- Pracownik odczytuje zatwierdzone reguły. Serwer sprawdza uprawnienia przy propozycji i potwierdzeniu.
- Nieznane opakowania/produkty, brak ilości, luźna notatka lub niejednoznaczny produkt wymagają doprecyzowania.
- Wersjonowanie i audyt z poprzednią oraz nową regułą. Karta przygotowana przed zmianą reguły, nazwy/jednostki produktu lub powiązania opakowania nie nadpisuje aktualnych danych.
- Kierownik może powiązać typ opakowania z pozycją magazynową; reguła i odpowiedź agenta pokazują jej aktualny stan.
- Reguły nie zużywają zapasów. Dodatkowe uwagi zatwierdza kierownik.
- Migracja schematu v3 pozostawia wcześniejsze notatki w tabeli `procedures`; nie są publikowane jako zatwierdzone reguły. Wzorcowa baza demo dostaje znaną regułę pakowania szkła.

## Kryteria odbioru
1. Kierownik wybiera produkt, typ opakowania i ilość, widzi podgląd i zatwierdza regułę.
2. Ponowny wybór produktu wczytuje regułę do edycji; zapis zwiększa wersję i dodaje wpis historii.
3. `zapamiętaj: Szkło pakujemy po 2 w Duży karton` tworzy kartę; `jak pakujemy szkło?` odczytuje regułę.
4. `zapamiętaj: Daniel pakuje baterie w aluminium` nie tworzy reguły.
5. Pracownik nie tworzy ani nie zatwierdza reguł, także bezpośrednio przez API.
6. Konflikt wersji zwraca 409; błędne ID, ilość zero i nieznane opakowanie nie zapisują danych.
7. Formularz i katalog są sprawdzone w przeglądarce; typy przechodzą kontrolę TypeScript.

## Wykonane sprawdzenia
- TypeScript `tsc --noEmit` i lint zmienionej logiki/formularza: bez błędów.
- Przeglądarka, osobna lokalna baza demo: edycja istniejącej reguły w formularzu, podgląd, zatwierdzenie, zwiększenie wersji; reguła utworzona komendą offline i zatwierdzona kartą; odczyt reguły z aktualnym stanem opakowań.
- Luźny wpis `zapamiętaj: Daniel pakuje baterie w aluminium` wymaga doprecyzowania i nie tworzy karty.
- Starsza karta po równoległej zmianie reguły została odrzucona komunikatem o konflikcie; nowsza wersja została zachowana.
- Gemini oraz sesja rzeczywistego pracownika nie były sprawdzane w tym przebiegu. Pełnej istniejącej suite testów nie uruchamiano.
