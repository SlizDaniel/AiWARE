# Zakończenie nasłuchu po komendzie

Branch: `codex/fix-voice-command-end`.

Problem: w trybie wake_word rozpoznawanie mogło pozostawać na wyniku pośrednim
bez końca sesji, a dodatkowe nagranie PCM działało także podczas wykonania zadania.

Kryteria:
- Po 1500 ms bez zmian podglądu poproś Web Speech o końcowy wynik przez `stop()`.
- Identyczne powtórzenia podglądu nie przedłużają nasłuchu.
- Końcowe segmenty nadal łączą się przez pauzę 1000 ms; sama niekompletna
  transkrypcja pośrednia nie wykonuje operacji.
- Gdy przeglądarka nie kończy sesji po `stop()`, po kolejnych 2000 ms zwolnij
  sesję i pokaż wskazówkę ponowienia komendy lub wysłania tekstu.
- Zatrzymaj rozpoznawanie przy przekazaniu komendy; PCM zatrzymaj po pobraniu
  ogona nagrania, przed wywołaniem STT. Podczas pracy agenta/TTS zwolnij mikrofon.
- Wznów nasłuch i ewentualne PCM, gdy agent ponownie czeka na użytkownika.

Weryfikacja: 52 testy speech, speechCommandBuffer i pcmRecorder przeszły,
TypeScript oraz kontrola diff przeszły. Dwa nowe testy obejmują identyczne
wyniki pośrednie, dalsze słowa i usunięcie timera przy wyłączeniu nasłuchu.
Próba GUI na istniejącym localhost:3000 została zablokowana timeoutem odczytu
przeglądarki. Nie wykonano próby fizycznym mikrofonem.

## Rozszerzenie: limit i sprawdzanie tekstu (2026-10-04)

- Wake_word sprawdza bufor tekstu co 500 ms, bez osobnych wywołań chmury.
- Po 10 s komendy wymusza koniec rozpoznawania; po kolejnych 2 s bez
  zakończenia sesji działa abort.
- Usuwa oznaczenia szumu i wypełniacze yyy/eee/hmm/uh/um, zachowując
  ilości, nazwy i negacje.
- Karta w trybie głosowym czeka maksymalnie 15 s. Zgoda wymaga słowa
  akceptacji. Negacja, wahanie, nowa komenda, odpowiedź bez zgody oraz
  brak odpowiedzi odrzucają kartę.
- Wake_word buforuje decyzję przez pauzę, aby segment „ale nie teraz”
  mógł odrzucić wcześniejsze „tak”. Podpowiedzi UI opisują limity.
- 56 testów seams głosu i TypeScript przeszły. Ponowna próba GUI:
  timeout przeglądarki; fizyczny mikrofon pozostaje niezweryfikowany.

## Odcinanie rozmów i szybkie pytania o towar

- PCM w wake_word startuje dopiero po wykryciu prefiksu. Zniknął zapas
  audio sprzed prefiksu oraz start nagrywania przy wejściu na stronę.
- Z kumulowanego wyniku Web Speech zostaje tylko fragment po ostatnim
  prefiksie. Wyniki wcześniejszych segmentów i rewizje bez prefiksu pod
  tym samym indeksem są pomijane; zakończona rozmowa tła resetuje sesję.
- Wołacz `Jakubie` jest rozpoznawany przy ustawionym prefiksie `Jakub`.
- Kompletny odczyt stanu/lokalizacji/procedury ze znanym jednoznacznym
  towarem może wyjść na następnym sprawdzeniu co 500 ms również z wyniku
  pośredniego. Przykład: `ile mamy kartnów kartonów szum` → `ile mamy Kartony`.
- Powtórzenia, drobne literówki i końcówka po nazwie nie blokują takiego
  pytania. Rodzina z kilkoma wariantami wymaga pełnej nazwy. Ścieżka
  zmian stanu oraz zgoda na zapis nadal wymagają końcowej transkrypcji.
- 66 testów czterech seams głosu, TypeScript i diff check przeszły.
- GUI na localhost:3000: tekst `Rozmowa o obiedzie. Jakubie ile mamy
  kartnów kartonów tutaj jakiś syf szum` został przetworzony jako
  `ile mamy Kartony`; odpowiedź: `Kartony: 13 szt (minimum 12) — Strefa A-1.`
  Rozpoznawanie mowy w przeglądarce zgłosiło brak połączenia z usługą;
  prawdziwej transkrypcji mikrofonu nie sprawdzono. Osobna pozycja `Kartony`
  może być wybrana także przy istnieniu pozycji `Kartony duże`/`Kartony małe`.

## Zastępująca korekta: jedna sesja do 3 s

Poprzednie limity 10 s, oczekiwanie na sam prefiks 8 s i dodatkowe 2 s na
`onend` okazały się nieskuteczne w próbie użytkownika. Zastępuje je jeden
deadline 3000 ms od wykrycia początku mowy (gdy brak `speechstart`, od
pierwszego wyniku; sam prefiks również go uruchamia). Działa też przy
nierozpoznanym prefiksie i pustej komendzie.
Kolejne wyniki i powtórzenia prefiksu nie mogą przedłużyć tej sesji.

- Na deadline najpierw abort rozpoznawania i stop PCM; żadnego ogona nagrania
  ani oczekiwania na callback usługi. Potem tekst trafia do interpretacji.
- Odczyt znanego towaru może zakończyć się wcześniej, na sprawdzeniu co 500 ms.
- Brak tekstu kończy sesję komunikatem ponowienia. Nieznana komenda,
  doprecyzowanie lub błąd wykonania wstrzymują wake_word do ponownej próby.
- Wynik pośredni może tworzyć propozycję komendy, nadal wymagającą karty
  i osobnego confirm. Nieukończone „tak” nie zatwierdza karty.
- „Mów” również nagrywa maksymalnie 3 s i automatycznie wysyła rozpoznaną
  komendę po stopie. Nie wymaga dodatkowego kliknięcia „Wyślij”.
- Pierwszy błąd sieci Web Speech zatrzymuje tę usługę; przycisk „Mów” używa
  wtedy PCM i serwerowego STT, bez kolejnych automatycznych restartów.
- Limit 3 s dotyczy wejścia głosowego; STT/wykonanie komendy odbywają się
  po zwolnieniu mikrofonu. Okno decyzji o karcie nadal ma 15 s.
- 71 testów pięciu seams głosu i TypeScript przeszły. Nowe testy sprawdzają
  dokładnie 3000 ms, brak wyników, brak przedłużenia po nowym prefiksie,
  koniec sesji bez final oraz brak zgody na podstawie pośredniego „tak”.

## Wzbudzanie prefiksem po szumie (2026-10-04)

- Okno 3 s startuje wyłącznie przy faktycznym łapaniu komendy (wynik z
  prefiksem, uzbrojenie po samym prefiksie, trwający zapis decyzji o karcie).
  `onspeechstart` i zwykłe wyniki bez prefiksu nie otwierają deadline'u —
  rozmowa tła przestaje zabijać nasłuch.
- Wygaśnięcie okna z pustym buforem wraca do słuchania zamiast trwałego błędu
  „Nie rozpoznałem komendy w ciągu 3 s”; twardy `fail` zostaje dla braku
  mikrofonu i błędów sieci.
- Porzucona sesja tła czyści też aktywne okno deadline'u.
- Po doprecyzowaniu i po nieznanej komendzie nasłuch zostaje żywy
  (`resetForReply`): odpowiedź głosem z prefiksem („Magu, duże”) domyka
  oczekującą komendę, bez klikania „Spróbuj ponownie”.
- Weryfikacja: 958 testów + TypeScript; GUI: „Magu, ile mamy kartonów?”
  odpowiada stanem magazynu. Nasłuch fizycznym mikrofonem do potwierdzenia
  w Chrome/Edge.
