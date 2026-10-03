# 19: Prefiks głosowy i dopasowanie nazw magazynu

**Owner:** A, poprawa ścieżki STT → intencja w kartach 03/04; współpraca z B przy głosie.
**Branch:** `fix/warehouse-speech-recognition`, baza `1813768`.

## Ustalenia i problem

Serwerowe STT już otrzymuje nazwy z bazy, ale `stt_refine=false` pozostawia
tekst Web Speech jako ostateczny. Poprawa ma działać również w tej szybkiej
ścieżce, bez zmiany ustawienia kierownika i bez dodatkowego zapytania LLM.
Użytkownik zgłasza np. bułki rozpoznawane jako półki.

## Rozwiązanie

- Web Speech prosi o maksymalnie 3 alternatywy zamiast jednej. Alternatywa może
  naprawić prefiks tylko przy zachowaniu pełnego tekstu komendy; nie zmienia
  decyzji „tak”/„nie”. Przeglądarka może zwrócić mniej alternatyw.
- Prefiks rozdzielony na dwa słowa („Mag u”, „Ma gu”) i brak spacji po przecinku
  są rozpoznawane bez dodania fragmentu prefiksu do komendy.
- Rozpoznany prefiks w wyniku pośrednim uzbraja nasłuch na kolejną frazę.
- Wyniki dzielące jedną komendę są łączone do pauzy 1000 ms po wynikach końcowych.
  Bufor kolegi identyfikuje fragmenty po indeksie: aktualizacja zastępuje fragment,
  a wynik pośredni blokuje wysłanie do czasu wyniku końcowego. Początek nagrania
  pozostaje przy pierwszym fragmencie. Wyłączenie/zmiana prefiksu lub STT/TTS
  anuluje bufor. Zachowano jego sygnał gotowości mikrofonu, pauzę podczas pracy
  agenta i rozdzielenie nowych komend od decyzji o oczekującej karcie.
  Nowy prefiks w kolejnym indeksie zastępuje poprzednią, jeszcze niewysłaną
  komendę; nie skleja dwóch poleceń i nie wykonuje poprzedniego w tle.
- Korekta tylko nazwy towaru na końcu prostego pytania lub komendy przyjęcia/
  wydania. Liczby, jednostki i czasowniki pozostają takie same.
- Normalizacja polskich znaków + odległość Levenshteina (1–2 edycje, najwyżej
  40% długości, przewaga nad drugim kandydatem). To heurystyka pisowni, nie
  pełny model fonetyczny. Dokładna nazwa istniejąca w bazie zawsze pozostaje.
- Zbliżone wyniki bez przewagi, nieznane dalekie nazwy, nowe towary, strefy,
  procedury, negacje, plany i opisy z przyimkami nie są przepisywane.
- Web pokazuje „Dopasowano … → …”; użytkownik sprawdza kartę i zatwierdza zapis.
- `/api/stt` zachowuje `text`, a przy korekcie dodaje `original_text` i
  `corrections: [{heard, name}]`. Bez korekty odpowiedź pozostaje `{text}`.
  Serwer używa aktualnych nazw z bazy; klient mobilny również dostaje ten tekst.
  Szybka ścieżka Web Speech używa nazw z aktualnego widoku webowego.

## Kryteria

- [x] Półki → Bułki przy jedynym wyraźnie bliskim kandydacie w prostym poleceniu.
- [x] Bułki + Półki w bazie: nazwa Półki pozostaje bez korekty.
- [x] Liczby/akcje nie zmieniają się przy korekcie; STT nie zapisuje zapasu/audytu.
- [x] Rozdzielony prefiks i końcowe fragmenty komendy mają testy deterministyczne.
- [x] Oryginał i korekta są dostępne w kontrakcie HTTP, a web pokazuje korektę.
- [ ] Próba z fizycznym mikrofonem i przykładowymi nagraniami użytkownika.

## Granice

Korekta może być błędna przy nowym, podobnie brzmiącym produkcie, którego nie
ma jeszcze w bazie. Dlatego karta potwierdzenia i informacja o korekcie pozostają
obowiązkowe. Nie przerabiamy ręcznie wpisywanych komend. Przy niepewności tekst
pozostaje oryginalny — LLM może dopytać, a użytkownik może edytować transkrypcję.
Pauza dłuższa niż 1000 ms po końcowym wyniku kończy bieżącą komendę; to nie ciągłe dyktowanie.
Decyzje o kartach zachowują dotychczasową obsługę. Web Speech zależy od
przeglądarki/usługi rozpoznawania; prawdziwa jakość wymaga próby w warunkach demo.
Nie zmieniono mobilnego mechanizmu nasłuchu prefiksu ani dostawców/modeli STT.

## Weryfikacja

Po integracji z poprawkami głosu kolegi: 43 pliki testowe, 762 passed, 2 skipped. Build webowy, typecheck web/mobile,
lint i diff check przeszły. Testy używają syntetycznych wyników Web Speech i
kontrolowanych odpowiedzi STT; nie wysyłają nagrań do usług chmurowych.
GUI w izolowanym demo: komenda tekstowa nadal tworzy kartę 13→11, bez zapisu
przed potwierdzeniem. To kontrola regresji GUI, nie próba jakości mikrofonu.
Review Standards: brak uwag. Review Spec: poprawiono termin bufora po interim;
próba mikrofonem pozostaje pending.
