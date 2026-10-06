# Porządkowanie materiałów portfolio

## Pierwszy porządek

Wycofano ze śledzenia 60 plików (około 10,27 MiB zawartości):

- 41 renderów stron i 6 arkuszy kontaktowych w `tmp/presentation/render/`;
- 10 renderów slajdów w `tmp/presentation/render10/`;
- 2 podglądy PNG w `output/pdf/`;
- nieużywany duplikat maskotki `graphics/RkP3prMCRoIqeMD6M3ZuQ_9s62DIot.jpg`.

Użyto `git rm --cached`: pliki pozostają lokalnie, a ich dotychczasowe wersje pozostają w historii Git. Renderowane strony zostały następnie przeniesione lokalnie do `presentation/render/` i `presentation/render10/`, objętych `.gitignore`. Po scaleniu nowy klon nie pobierze ich jako bieżących plików. Historia i rozmiar pobierania starszych obiektów nie zostały zmniejszone.

Maskotka jest nadal dostępna w `public/brand/mascot.jpg` i w zasobach frontendowego legacy. Wszystkie trzy kopie przed porządkiem miały identyczny SHA256. Nie znaleziono odwołań do wycofywanej ścieżki `graphics/` w przeszukanych plikach roboczych projektu.

`.gitignore` blokuje ponowne przypadkowe dodanie tych podglądów i kopii. Poprawiono też wyjątki dla obu `.env.example`, które wcześniej były przesłaniane późniejszą regułą `.env*`.

## Zachowane materiały

- [Prezentacja 10 slajdów](../output/pdf/MAGAZYNIER-prezentacja-10-slajdow.pdf).
- [Przewodnik web/mobile](../output/pdf/MAGAZYNIER-przewodnik-web-mobile.pdf).
- Wszystkie screenshoty w `gui-test-screenshots/` oraz [presentation/assets/](../presentation/assets/).
- Źródła i pomocnicze pliki prezentacji w [presentation/](../presentation/README.md).
- Cała implementacja i testy `legacy/`, dokumentacja zadań, kod aplikacji oraz dane przykładowe.
- Wszystkie regulaminy wydarzenia w [archive/hackyeah-2026/rules/](../archive/hackyeah-2026/rules/).

## Przeniesienie źródeł i archiwum

Przeniesiono źródła oraz screenshoty z `tmp/presentation/` do `presentation/`. Poprawiono katalog główny generatorów, ścieżki assetów, JSON-ów i renderów oraz importy skryptu seedującego. Baza prezentacyjna ma teraz ścieżkę wyznaczaną względem skryptu. Proxy nadal korzysta z tych samych lokalnych portów.

Cały katalog regulaminów przeniesiono do `archive/hackyeah-2026/rules/`. Zachowano wszystkie kategorie i zadania partnerskie; żadnego dokumentu regulaminowego nie usunięto. Instrukcje znajdują się w [presentation/README.md](../presentation/README.md) i [README archiwum](../archive/hackyeah-2026/README.md).

Weryfikacja po przeniesieniu: porównano SHA256 wszystkich przenoszonych plików, uruchomiono oba generatory PDF i renderer z innego katalogu roboczego, sprawdzono 41/10 stron oraz identyczny tekst i zawartość JSON. Po próbie przywrócono oryginalne bajty finalnych PDF-ów i JSON-ów. Seed przeszedł na osobnej bazie prezentacyjnej. Proxy przeszło lokalną próbę startu, fikcyjnej tożsamości, przekazywania API i OPTIONS; procesy testowe zatrzymano. Skan Gitleaks nowego `presentation/` nie zgłosił znalezisk.

## Kandydat do następnej zmiany

| Materiał | Proponowana zmiana | Warunek |
|---|---|---|
| Screenshoty GUI | Dodanie indeksu scenariuszy i wybranej galerii | Zachowanie dowodów pracy i odwołań z kart zadań |

Generatory nadal wymagają zależności Python i fontów Segoe z Windows; nie są częścią podstawowego CI aplikacji.

To porządek materiałów repozytorium, nie zmiana wersji aplikacji zaprezentowanej podczas hackathonu.
