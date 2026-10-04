# Przykładowe procedury i scenariusze magazynu

To fikcyjne dane do demonstracji. Kierownik dobiera rzeczywiste opakowania
oraz procedury do produktów swojego magazynu.

## Wczytanie

Uruchom lokalne demo bez resetu danych. Następnie:

```powershell
python scripts/load-sample-procedures.py --url http://127.0.0.1:3002
```

Importer wymaga lokalnego trybu demo bez logowania, korzysta z kart zatwierdzenia
i audytu. Nie zmienia zapasu ani własnych reguł kierownika. Aktualizuje jedynie
niezmienioną, fabryczną regułę szkła. Ponowienie nie tworzy duplikatów.

## Reguły widoczne w Procedurach

| Produkt | Opakowanie | Ilość na opakowanie | Przypadki w instrukcji |
|---|---|---:|---|
| Szkło | Duży karton | 1 szt | Folia, przekładki, oznaczenie; uszkodzenie; brak opakowania/towaru; rozbieżność |
| Kartony | Folia stretch | 10 szt | Suchy pakiet; uszkodzenie; brak kartonów/folii; przegląd szkicu zamówienia |
| Folia stretch | Mały karton | 1 rolka | Ochrona końców; brak kartonu; ostatnia rolka; rozbieżność zapasu |

Instrukcje zawierają jawne kroki dla sytuacji wyjątkowych. Procedura jest
informacją dla pracownika: nie wykonuje automatycznie korekt ani zamówień.

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
