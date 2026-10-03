# 18: Czytelna interpretacja komend i diagnostyka Gemini

**Owner:** A. Rozwinięcie karty 03, seam intencja → narzędzie oraz kontrakt komenda → odpowiedź.

## Problem i zakres

Dotychczasowy prompt zachęcał do dopasowania do najbliższego towaru, bez
szczegółowych reguł ilości, negacji i nieobsługiwanych operacji. Wszystkie błędy
providera miały jeden komunikat, utrudniając odróżnienie złej interpretacji od
przejścia na parser offline po awarii API.

- Kontekst zapasów jako JSON z ID, nazwą, ilością, jednostką, minimum i lokalizacją.
- Przelicznik palety z tej samej stałej co parser offline; nadal demonstracyjne 2.
- Prompt: wydanie ujemne, przyjęcie/zwrot dodatnie; delta ≠ stan końcowy.
- Dopytanie zamiast zgadywania ilości, nieznanego towaru, jednostek i odwołań do rozmowy.
- Jedna operacja; bez częściowego wykonania wieloelementowego polecenia.
- Przenoszenie i ustawianie stanu bez dostępnego narzędzia prowadzą do wyjaśnienia.
- Reguły doboru narzędzi odczytu, zapisu procedur, stref i szkiców zamówień.
- Stałe komunikaty dla timeoutu, sieci, limitu 429, klucza/uprawnień,
  niedostępnego modelu 404 i awarii 5xx. Bez surowych komunikatów API i sekretów.
- Nadal istnieją walidacja schematu, fallback offline, karta i confirm-before-write.
- Python: 23 syntetyczne scenariusze, w tym negacja, plan, dwa towary, nieznany
  przelicznik, stan absolutny, przeniesienie i podobna nazwa innego towaru.

## Kryteria

- [x] Provider otrzymuje spójny kontekst JSON i szczegółowe reguły.
- [x] Transportowy błąd Gemini pozwala użyć parsera offline i podaje przyczynę.
- [x] Testy nie ujawniają treści błędów providera.
- [x] Python ocenia również odmowę zgadywania; pytanie nadal oznacza REVIEW.
- [ ] Rzeczywiste wyniki Gemini przed/po na zgłoszonych przez użytkownika komendach.

## Ograniczenia

Reguły promptu nie są twardą walidacją znaczenia wypowiedzi. Testy transportu
korzystają z kontrolowanych odpowiedzi i sprawdzają wysyłane instrukcje; nie
dowodzą, że Gemini zawsze je zastosuje. Do pomiaru jakości trzeba uruchomić
Pythonowy check z kluczem oraz ocenić pytania w GUI. W tej sesji lokalny check
zatrzymał się na braku klucza, bez wysyłania zapytań do chmury.

Pierwotny zakres tej karty nie obejmował historii rozmowy. Na późniejsze
polecenie użytkownika dodano bufor doprecyzowań opisany w
`command-clarification-context.md`. Fallback pozostaje istniejącym parserem
z jego ograniczonym zakresem i wymaga pełnej komendy.

Frontend korzysta z istniejącego pola `warning`; API i komponenty kolegi nie
wymagają zmian. Nowe poprawki powstają na `fix/llm-command-interpretation`.

## Weryfikacja lokalna

670 testów aplikacji passed, 2 skipped; 18 testów Pythona passed.
Build, typecheck, lint i kontrola whitespace przeszły. Pierwsza próba pełnej
suity trafiła na port testowej bazy odrzucony przez Windows (EACCES); ponowne
uruchomienie przeszło, bez zmiany zakresu testów.
GUI: karta zmiany → confirm → szkic zamówienia i dashboard sprawdzone przy
integracji poprzednich branchy; na nowym buildzie odczyt lokalizacji i mapa
w mock działają. Nie jest to kontrola prawdziwego LLM.
Standards: brak usterek. Spec: pozostała wyżej wymieniona weryfikacja live.
