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
między kartami, użytkownikami lub odświeżeniami strony. Klient mobilny nie
przekazuje tego kontekstu. Parser offline nadal wymaga pełnego polecenia.
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
