# 15: [NICE] TTS — agent odpowiada głosem

**What to build:** Po zatwierdzeniu i przy odpowiedziach na pytania agent czyta krótkie odpowiedzi głosem (TTS API, polski). Wyłączalne w Ustawieniach (tryb „ekran-first" to domyślny). Nigdy nie czyta długich tekstów — maks. 1-2 zdania.

**Blocked by:** 04 (pipeline audio działa)

**Estimate:** 0.75 / 1.5

**Owner:** B (dopiero po zamknięciu wszystkich Must)

**TDD:** seam TTS: fixtura odpowiedzi agenta → oczekiwany krótki tekst do syntezy (test obcinania do 2 zdań); błąd API TTS → cisza, UI żyje.

**Demo check:** zatwierdź zmianę → agent potwierdza głosem „Zapisane. Kartony: 52. Propozycję zamówienia masz w kolejce." — w trybie offline TTS milczy bez błędu.

**Status:** implemented — Next.js, TTS przez istniejący Web Speech API przeglądarki, bez nowego zewnętrznego API ani zależności. Odpowiedzi i potwierdzenia zmian są czytane po włączeniu i zapisaniu `tts_enabled` (domyślnie `false`). Limit: 2 zdania i 220 znaków plus ewentualny wielokropek; granice zdań obsługują również małe litery i typowe skróty. Wyłączenie TTS, przejście do demo offline lub odmontowanie aplikacji przerywa wypowiedź. Brak polskiego głosu i błędy silnika oznaczają ciszę; demo offline wyłącza także próbkę w Ustawieniach.

- [x] odczyt odpowiedzi i zatwierdzeń podpięty do polskiego głosu przeglądarki
- [x] wyłączalny w Ustawieniach, domyślnie ekran-first
- [x] błąd TTS nie psuje niczego
- [ ] GUI-check i odsłuch na docelowej przeglądarce z polskim głosem

Walidacja 2026-10-03: smoke checks przez Node i `node:assert` potwierdziły obcinanie zdań (także z małą literą), skróty, liczby dziesiętne, listy, wybór polskiego głosu, ciszę przy braku głosu, anulowanie, błędy silnika oraz brak `window` (SSR). Vitest pominięty na polecenie użytkownika. Typecheck i GUI-check zablokowane przez brak zainstalowanych zależności (`tsc` niedostępne, serwer Next.js nieuruchomiony). Mock silnika nie potwierdza rzeczywistego odsłuchu ani dostępności głosu w systemie.
