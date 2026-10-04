# Bufor doprecyzowania komendy

## Zlecenie użytkownika

Po „dodaj folię stretch” asystent pyta o ilość. Odpowiedź „10” ma uzupełnić
poprzednie polecenie bez konieczności wpisywania go od nowa. Praca na nowym
branchu po pobraniu aktualnego maina.

## Kryteria i działanie

- Web przechowuje oczekujące polecenie, pytania AI i kolejne odpowiedzi
  w pamięci komponentu, osobno dla każdej karty przeglądarki.
- Każde kolejne żądanie `/api/command` przekazuje opcjonalne `conversation`.
  Backend waliduje kształt i limity przed przekazaniem danych do Gemini.
- AI otrzymuje oryginalny towar, kierunek operacji i pytanie wraz z nową
  odpowiedzią; dobór towarów do kontekstu uwzględnia pierwotną komendę.
- Po doprecyzowaniu pojawia się karta zmiany. Zapis nadal wymaga osobnego
  zatwierdzenia; odpowiedź „tak” w rozmowie nie zatwierdza karty.
- Propozycja i audyt zachowują tekst polecenia wraz z odpowiedziami.
- Wynik lub karta zmiany czyści bufor. Przycisk „Nowa komenda” resetuje go
  ręcznie. Odświeżenie strony również usuwa pamięć.
- Maksymalnie cztery doprecyzowania, pięć minut od ostatniego pytania.
  Po osiągnięciu limitu użytkownik otrzymuje prośbę o pełne nowe polecenie.
- Prompt nadaje pierwszeństwo pełnemu nowemu poleceniu oraz zabrania
  wykonywania anulowanego polecenia. Reguły promptu nie są gwarancją jakości
  interpretacji modelu; karta zmiany pozwala sprawdzić wynik.

## Zakres i ograniczenia

Bufor obsługuje panel komend strony, zarówno wejście tekstowe, jak i głosowe
przechodzące przez ten panel. Nie jest pełną historią czatu ani pamięcią
między kartami, użytkownikami lub odświeżeniami strony. Klient mobilny przekazuje ten sam kontekst z panelu Magu dla tekstu i transkrypcji. Parser offline nadal wymaga pełnego polecenia.
Po wygaśnięciu pamięci sama liczba nie powinna powodować zmiany stanu.

Testy z kontrolowanym providerem i odpowiedziami HTTP Gemini sprawdzają
przekazywany kontekst oraz brak zapisu przed zatwierdzeniem na PGlite i
przez postgres.js. Nie zastępują próby z rzeczywistym modelem.

## Weryfikacja lokalna

716 testów passed, 2 skipped; dodatkowo zestaw testów klienta mobilnego
pominięty przez istniejącą konfigurację z powodu braku zależności mobile.
Typecheck, build Next.js i kontrola whitespace przeszły.
Podgląd aktualnego builda uruchamia się na 127.0.0.1:3000, ale wysłanie
komendy w GUI blokuje brak lokalnych kluczy Supabase. Nie zmieniano
konfiguracji logowania. Weryfikacja z rzeczywistym Gemini pozostaje otwarta.

## Klient mobilny — rozszerzenie 2026-10-04

Panel Magu korzysta ze wspólnego bufora `src/lib/commandConversation.ts`.
Po pytaniu agenta czyści pole wpisywania i pokazuje pierwotne polecenie;
kolejna odpowiedź przekazuje `conversation` przez istniejące API.
Kolejne pytania zachowują pełny ciąg doprecyzowań. Wynik lub karta czyści bufor,
błąd sieci zachowuje go do ponowienia. „Nowa komenda” czyści bufor i panel.
Obowiązują te same limity: cztery pytania i pięć minut od ostatniego pytania.
Przełączanie sekcji zachowuje bufor; wylogowanie lub restart klienta usuwa go.
W nasłuchu odpowiedź nadal wymaga prefixu, np. „Magu, 10”. Parser offline
wymaga pełnej komendy; doprecyzowania interpretuje provider LLM.

Weryfikacja rozszerzenia mobilnego: 224 testy (transport mobilny, bufor,
komendy, Gemini i Decisions), typecheck obu klientów, eksport Expo web
oraz `git diff --check` przeszły. Firefox z viewportem 390 px i atrapą
odpowiedzi agenta sprawdził dwa doprecyzowania, zachowanie kontekstu przy
zmianie sekcji, osobne zatwierdzenie, czyszczenie po wyniku i ręczny reset.
Nie sprawdzono rzeczywistego modelu ani nagrania na fizycznym telefonie.
