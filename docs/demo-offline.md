# Próba demo offline — Agent A, karta 13

## Przygotowanie

1. Z internetem wykonaj `npm ci`, potem `python scripts/start-demo.py --build --reset`.
2. Otwórz http://127.0.0.1:3002. Sprawdź komunikat o osobnej bazie demo i trybie offline.
3. Zatrzymaj serwer przez Ctrl+C. Odłącz internet i uruchom `python scripts/start-demo.py --reset`.
4. Nie uruchamiaj `npm run dev` podczas prezentacji z tego samego checkoutu — zmienia katalog `.next`.

## Scenariusz w przeglądarce

- **Stany → Importuj plik:** wybierz lokalny `public/demo-offline.xlsx`, obejrzyj mapowanie,
  popraw je w razie potrzeby i zatwierdź. W offline sugestia pochodzi z reguł,
  nie z LLM. Kartony powinny mieć 13 sztuk i minimum 12.
- Wyślij `strefa: Strefa A-1`, zatwierdź kartę. Powtórz z `Strefa B-2`
  i `Strefa C-1`. Nazwy zgodne z lokalizacjami z Excela i procedury zapewniają
  jednoznaczne powiązanie mapy; samo `szkło` nie jest nazwą `Strefa B-2`.
- Wyślij `wzięliśmy paletę kartonów`. Przed zatwierdzeniem stan nadal wynosi 13;
  po zatwierdzeniu 11. Paleta w scenariuszu oznacza 2 jednostki.
- **Historia:** obejrzyj zmianę i wykonaj undo. Stan wraca do 13, cofnięcie ma własny
  wpis w historii. Ponów komendę i zatwierdź, żeby wrócić do 11.
- **Kolejka zatwierdzeń:** szkic Kartonów ma 50 sztuk. Zatwierdź szkic i sprawdź
  filtr Rozpatrzone oraz wpis w Historii. Zamówienie nie jest wysyłane do ERP.
- Wyślij `gdzie leży szkło?`: mapa otwiera odpowiednią strefę. `ile mamy szkła?`
  odpowiada stanem i pozwala przejść na mapę.
- Wyślij `Magu, jak pakujemy szkło?`: pokaże się zapisana procedura.
- **Stany:** pobierz CSV lub XLSX, sprawdź plik. Odśwież stronę — stan zostaje.

Mikrofon korzystający z chmurowego STT jest w demo wyłączony; wszystkie komendy
wpisujemy w to samo pole, które w normalnej pracy przyjmuje transkrypcję.
Prawdziwe LLM/STT weryfikujemy oddzielnie na konfiguracji kolegi (karta 03/04).

## Status weryfikacji

Testy automatyczne nie zastępują próby z fizycznie wyłączonym internetem i nagrania
wideo na laptopie prezentacyjnym. Po zmianie kodu przygotuj build ponownie online.
Przed startem nowej próby zatrzymaj poprzedni proces; reset dotyczy tylko bazy demo.

Lokalny GUI-check produkcji (2026-10-03): import XLSX i ręczne zatwierdzenie,
strefy, zmiana 13→11, audyt z undo 11→13, ponowna zmiana i szkic 50 szt,
zatwierdzenie bez ERP, lokalizacja na mapie oraz procedura z przyciskiem do
`Strefa B-2`. Internet nie był fizycznie odłączony w tej próbie.
