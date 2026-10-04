# 19: Hybrydowe decyzje Mercury Decide + Gemini

Zatwierdzony zakres: Mercury Decide wybiera intencję i towar; lokalny parser odczytuje ilość;
Gemini obsługuje pozostałe komendy, doprecyzowania, treści, STT i Excel.
Branch: `pivot/jev-decisions`.

Kontrakt API: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
— POST https://openrouter.ai/api/alpha/decisions, Bearer, pytania Choice
(intencja, towar) i Noul (jednoznaczność). Model: `inception/mercury-decide:free`.
`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL` (oficjalny origin).
Jeden request, limit 2 s, maks. odpowiedź 64 KiB, brak przekierowań i ujawniania
treści błędów. Maks. 40 towarów z istniejącego kontekstu komendy.

Kryteria akceptacji:

- Proste wydanie/przyjęcie, stan i lokalizacja przez Mercury Decide bez wywołania Gemini.
- Ilość dodatnia, całkowita i jawna; pojedyncza paleta = istniejące demo 2 szt.
- Pewność Choice i prawdopodobieństwo wybranej opcji >= 0.9; Noul >= 0.95.
  To progi aplikacji, wymagające oceny na rzeczywistych komendach.
- Niepewność, niezrozumiana ilość, konflikt intencji, dodatkowe operacje lub
  kontekst doprecyzowań kierują do Gemini. Bez Gemini dopytanie.
- Błąd Mercury Decide kieruje do Gemini; bez Gemini dotychczasowy fallback offline.
- Schemat narzędzia walidowany przed użyciem; zapis wyłącznie po confirm, z audytem.
- Ustawienia i health pokazują Mercury Decide; ujawnienie AI wymienia obie integracje.
- Brak kluczy Mercury Decide zachowuje ścieżkę Gemini. Offline/mock/demo bez Mercury Decide.

Granice: Mercury Decide nie generuje dowolnych argumentów ani tekstów. Zmiany ilości mają
wąską lokalną gramatykę. Model nadal może podjąć błędną semantycznie decyzję;
progi pewności jej nie gwarantują. Brak obietnicy poprawy czasu przed pomiarem live.
STT, import, persistence, auth, klient mobilny i format API pozostają kompatybilne.

## Weryfikacja (2026-10-04, po integracji origin/main)

- Pełna suita: 848 passed, 2 skipped; build (z TypeScript), typecheck i lint passed.
- Testy: wybór intencji/towaru, lokalne ilości, confidence, safety, błędy API,
  timeout, limit odpowiedzi, routing Gemini, endpoint i ochrona klucza,
  propozycja bez zapisu, confirm i audyt, ujawnienie integracji w ustawieniach.
- Live OpenRouter: trzy komendy na syntetycznej bazie PGlite w pamięci,
  bez fallbacku: wydanie palety kartonów 516 ms, stan 344 ms, lokalizacja 322 ms.
  Przed confirm stan 54; po confirm 52 i jeden wpis audytu.
  W poprzedniej próbie wydanie przekroczyło limit 2 s; parser offline zachował
  poprawną propozycję. Mała próbka nie gwarantuje jakości ani stałego czasu.
- Gemini zwracał HTTP 429; porównanie szybkości obu modeli nie jest miarodajne.
- Integracja zachowuje rolę użytkownika w route handlerze komend z origin/main.
  Stare testy procedur dostosowano do jego nowych reguł pakowania:
  produkt, opakowanie, ilość, preview i zatwierdzenie przez kierownika.
- GUI-check niewykonany: Browser nie udostępnił żadnej przeglądarki.
- Lokalne scalenie; bez push i deployu ze względu na limit Vercel.
  Sekrety pozostają w ignorowanym .env.local.
