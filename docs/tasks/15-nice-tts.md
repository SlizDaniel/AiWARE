# 15: [NICE] TTS — agent odpowiada głosem

**What to build:** Po zatwierdzeniu i przy odpowiedziach na pytania agent czyta krótkie odpowiedzi głosem (TTS API, polski). Wyłączalne w Ustawieniach (tryb „ekran-first" to domyślny). Nigdy nie czyta długich tekstów — maks. 1-2 zdania.

**Blocked by:** 04 (pipeline audio działa)

**Estimate:** 0.75 / 1.5

**Owner:** B (dopiero po zamknięciu wszystkich Must)

**TDD:** seam TTS: fixtura odpowiedzi agenta → oczekiwany krótki tekst do syntezy (test obcinania do 2 zdań); błąd API TTS → cisza, UI żyje.

**Demo check:** zatwierdź zmianę → agent potwierdza głosem „Zapisane. Kartony: 52. Propozycję zamówienia masz w kolejce." — w trybie offline TTS milczy bez błędu.

**Status:** ready

- [ ] polski TTS działa po zatwierdzeniu i przy odpowiedziach
- [ ] wyłączalny w Ustawieniach, domyślnie ekran-first
- [ ] błąd TTS nie psuje niczego
