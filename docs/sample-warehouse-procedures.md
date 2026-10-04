# Przykładowe procedury i scenariusze magazynu

To fikcyjne dane do demonstracji. Kierownik dobiera rzeczywiste opakowania
oraz procedury do produktów swojego magazynu.

## Wczytanie

Lokalne demo ładuje te reguły automatycznie przy starcie do swojej odizolowanej
bazy. Restart istniejącego demo uzupełni brakujące reguły i zaktualizuje starą
fabryczną regułę szkła; reguły zmienione przez kierownika pozostają bez zmian.

Jeśli demo już działa i nie chcesz go restartować, możesz użyć importera:

```powershell
python scripts/load-sample-procedures.py --url http://127.0.0.1:3002
```

Importer wymaga lokalnego trybu demo bez logowania, korzysta z kart zatwierdzenia
i audytu. Nie zmienia zapasu ani własnych reguł kierownika. Ponowienie nie tworzy
duplikatów.

## Reguły widoczne w Procedurach

| Produkt | Opakowanie | Ilość na opakowanie | Przypadki w instrukcji |
|---|---|---:|---|
| Szkło | Duży karton | 1 szt | Folia, przekładki, oznaczenie; uszkodzenie; brak opakowania/towaru; rozbieżność |
| Kartony | Folia stretch | 10 szt | Suchy pakiet; uszkodzenie; brak kartonów/folii; przegląd szkicu zamówienia |
| Folia stretch | Mały karton | 1 rolka | Ochrona końców; brak kartonu; ostatnia rolka; rozbieżność zapasu |

Instrukcje zawierają jawne kroki dla sytuacji wyjątkowych. Procedura jest
informacją dla pracownika: nie wykonuje automatycznie korekt ani zamówień.

## Przygotowanie sytuacji wyjątkowych

Same opisy zadań są hipotetyczne, dopóki nie przygotujesz danych demo.
Importer zmienia tylko reguły. Przed ćwiczeniem sprawdź bieżące ilości,
bo poprzednie próby mogły już zmienić stan.

- **Brak kartonów:** „Ile mamy kartonów?” → odczytaj N. Jeżeli N > 0,
  wpisz „Wzięliśmy N sztuk kartonów” z rzeczywistą liczbą zamiast N,
  sprawdź kartę (stan po zmianie 0) i zatwierdź. Dla 11 sztuk: „wzięliśmy
  11 sztuk kartonów”. Jeżeli stan już wynosi 0, nie odejmuj ponownie.
- **Ostatnia rolka:** „Ile mamy folii stretch?” → odczytaj N. Jeśli N > 1,
  wpisz „Pobrałem M rolek folii stretch”, gdzie M = N − 1. Dla 15 rolek
  wpisz „pobrałem 14 rolek folii stretch”, sprawdź kartę 15 → 1 i zatwierdź.
  Przy stanie 1 jest gotowe; przy stanie 0 najpierw zasymuluj przyjęcie jednej
  rolki przez „doszła 1 rolka folii stretch” i zatwierdź właściwą kartę.
- **Brak opakowania / uszkodzenie / rozbieżność:** są opisem zdarzenia w zadaniu.
  Obecne opakowania demo nie mają powiązanego zapasu, więc aplikacja nie
  wykryje automatycznie ich fizycznego braku. Nie wpisuj fikcyjnych korekt
  tylko po to, by dopasować dane do opisu; to ćwiczenie odpowiedzi z procedury.
- Po ćwiczeniu zapasu możesz użyć **Historia → Cofnij** dla swojej zmiany.
  Odrzucone szkice nie stają się rzeczywistym zamówieniem.

## Sześć scenariuszy do próby

1. **Normalne pakowanie:** „Jak pakujemy szkło?” → reguła 1 szt / duży karton,
   folia i przekładki. Zadanie: „Zapakuj szkło do wysyłki”; klik „Jak wykonać?”.
2. **Brak opakowań:** zadanie „Brak dużego kartonu do szkła — sprawdź procedurę”.
   Pomoc wskazuje wstrzymanie pakowania i decyzję kierownika o zamienniku.
3. **Uszkodzenie:** zadanie „Uszkodzone szkło podczas kompletacji”.
   Nie pakować uszkodzonej sztuki, oznaczyć i zgłosić; żadnego cichego odjęcia.
4. **Brak towaru:** zadanie „Brak kartonów w Strefie A-1”. Sprawdzić zapas,
   wstrzymać kompletację, przejrzeć szkic. Szkic nie wysyła zamówienia dostawcy.
5. **Rozbieżność:** zadanie „Folia stretch: na półce mniej rolek niż w aplikacji”.
   Przeliczyć, zgłosić i przygotować właściwą korektę do zatwierdzenia.
6. **Ostatnia rolka:** zadanie „Ostatnia rolka folii stretch — ustal priorytety”.
   Kierownik wybiera kolejność zadań; pracownik nie wpisuje fikcyjnego przyjęcia.

W trybie offline „Jak wykonać?” pokazuje dopasowane pełne źródła bez wywołania AI.
Pytania o pakowanie działają offline. Ogólne pytanie „co zrobić przy braku?”
nie ma osobnej intencji parsera — do tego scenariusza użyj zadania i pomocy.
Zużycie opakowania nie jest automatycznie odejmowane po przeczytaniu reguły.
