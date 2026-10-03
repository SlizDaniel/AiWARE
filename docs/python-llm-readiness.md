# Sprawdzanie Gemini w Pythonie — Agent A, karta 03

`scripts/check-gemini.py` ocenia 23 syntetyczne komendy: pobranie, przyjęcie,
palety, stan, lokalizacja, progi, szkic zamówienia, odczyt/zapis procedury,
strefa, błąd transkrypcji, brak ilości i nieznany towar. Rozszerzenie obejmuje
zwrot, liczbę w nazwie stanowiska, negację, plan, kilka towarów, nieznany
przelicznik, ustawienie stanu, przeniesienie, brak odwołania i podobny nieznany towar.

## Uruchomienie

Wymagania: Python 3.10+, Node.js zgodny z projektem i zależności po `npm ci`.
Nie są potrzebne dodatkowe biblioteki Pythona ani uruchomiony serwer/baza.

```powershell
# Bez sieci i bez czytania plików env:
python scripts/check-gemini.py --list

# Prawdziwe zapytania do Gemini na danych syntetycznych:
python scripts/check-gemini.py --case withdrawal --case receipt
python scripts/check-gemini.py --case negated-withdrawal --case unknown-similar-item
python scripts/check-gemini.py --report data/llm-readiness.json

# Opcjonalnie inny lokalny plik konfiguracji:
python scripts/check-gemini.py --env-file .env.local --case speech-error

# Testy narzędzia, bez chmury:
python -m unittest discover -s scripts -p "test_check_gemini.py"
npm test -- tests/gemini-readiness.test.ts
```

Skrypt domyślnie czyta `.env.local`, potem `.env` w katalogu repo, wyłącznie
zmienne Gemini oraz `DEMO_MODE`. Wartości systemowe mają pierwszeństwo.
Ustaw lokalnie `GEMINI_API_KEY` i wyłącz `DEMO_MODE`; model bierze produkcyjny
provider z `GEMINI_MODEL` albo domyślnej konfiguracji aplikacji.
Parser pliku env obsługuje proste `NAZWA=wartość` i wartości w cudzysłowach;
nie interpretuje podstawiania zmiennych ani komentarzy na końcu wartości.

Każdy wybrany scenariusz wysyła rzeczywiste zapytanie do Gemini, zużywające limit
API; provider może powtórzyć chwilowo nieudane żądanie zgodnie z regułami aplikacji.
Na początku wystarczą 2–3 scenariusze. Po błędzie providera skrypt przerywa
pozostałe próby i raportuje liczbę niewykonanych; błędna intencja nie przerywa serii.
Nie uruchamiamy go automatycznie w CI ani podczas `npm test`.

## Jak czytać wynik

- `PASS`: nazwa narzędzia i argumenty zgodne z konkretną oczekiwaną intencją.
- `FAIL`: poprawny kontrakt, lecz inne narzędzie/argumenty lub zgadywanie operacji
  dla przypadku wymagającego pytania.
- `REVIEW`: model zadał pytanie. Oceń odpowiedź na tym samym zdaniu w GUI;
  skrypt nie zapisuje tekstu pytania i nie uznaje go automatycznie za sukces.
- `ERROR`: provider, transport, adapter lub walidacja kontraktu zawiodły.
  Diagnostyka nie drukuje surowych odpowiedzi, stderr procesu ani wyjątków.

Kody wyjścia: **0** same zgodne intencje, **1** FAIL/ERROR, **2** konfiguracja lub
zapis raportu, **3** konieczna ręczna ocena pytań bez FAIL/ERROR. Dziesięć niejednoznacznych
scenariusze pełnego zestawu powinny prowadzić do REVIEW, więc poprawne zachowanie
całego zestawu może kończyć się kodem 3. Raport JSON: `selected`, `completed`,
`not_run`, `counts` oraz wyniki z ID, oczekiwanym narzędziem i czasem całej próby
(obejmuje start adaptera, nie sam czas odpowiedzi Gemini).

Tekstowe argumenty porównujemy po trim i bez rozróżnienia wielkości liter;
reszta pól ma odpowiadać dokładnie. Parafraza zapisanej procedury może dać FAIL,
który wymaga ręcznej interpretacji; ten zestaw nie mierzy całej jakości językowej.

## Dlaczego adapter TypeScript

Python przechowuje scenariusze (`CASES`), ocenia wyniki (`assess`), steruje
wywołaniami (`run_bridge`) i zapisuje raport (`main`). Mały
`scripts/gemini-readiness-bridge.ts` wywołuje istniejący `providerFromEnv`,
`toolSchemas` i `normalizeCall`. Nie powielamy w Pythonie protokołu Gemini ani
walidatora narzędzi, więc próba dotyczy kodu używanego przez aplikację.

Adapter otrzymuje syntetyczne ID 1–3 z Pythona i waliduje ten sam fixture.
Nie korzysta z `getDb`, nie wykonuje `callTool`, nie tworzy propozycji i niczego
nie zatwierdza. Klucz przekazywany jest w środowisku procesu, nie w argumentach.
Proces adaptera otrzymuje wyłącznie konfigurację Gemini i podstawowe zmienne
systemowe, bez sekretów bazy i Supabase. Raport zawiera nasze stałe opisy wyników, bez kluczy, treści modelu i faktycznych
argumentów zwróconych przez model. Istniejące `npm run check:gemini` pozostaje
dostępne jako krótka próba trzech komend.

Ten check nie zamyka samodzielnie taska 03: potrzebne jest rzeczywiste sprawdzenie
komenda → karta → confirm → audyt w GUI oraz współpraca z B przy STT.
Task 13 nadal wymaga próby z fizycznie odłączonym internetem.

Weryfikacja implementacji: 11 nowych testów Pythona (16 razem z launcherem),
17 testów adaptera; pełna aplikacja 627 passed, 1 skipped, build/typecheck/lint
passed. CLI `--list` i istniejący panel GUI sprawdzone lokalnie. Nie wykonano
rzeczywistych zapytań do Gemini w tej sesji.
