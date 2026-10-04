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

## Weryfikacja

- Pełna suita: 806 passed, 2 skipped; build (z TypeScript) i lint passed.
- Testy: wybór intencji/towaru, lokalne ilości, confidence, safety, błędy API,
  timeout, limit odpowiedzi, routing Gemini, endpoint i ochrona klucza,
  propozycja bez zapisu, confirm i audyt, ujawnienie integracji w ustawieniach.
- Live OpenRouter: HTTP 401 dla aktualnej konfiguracji. Porównanie Mercury/Gemini
  nie uzyskało poprawnych odpowiedzi; brak potwierdzenia jakości i przyspieszenia.
- GUI-check niewykonany: Browser nie udostępnił żadnej przeglądarki.
- Bez commita, merge i push; użytkownik utrzymuje lokalne sekrety w .env.local.
