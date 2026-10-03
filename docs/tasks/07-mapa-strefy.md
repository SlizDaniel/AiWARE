# 07: Mapa schematyczna 2D + strefy dodawane głosem/tapem

**What to build:** Schematyczny rzut magazynu jako SVG (ściany/regały jako prostokąty — lay­out z pliku konfiguracyjnego lub rysowany raz na sztywno dla dema). Komenda „strefa: kartony" (głosem lub tekstem) tworzy strefę na mapie z etykietą; klik w strefę pokazuje panel szczegółów (co leży w strefie, ile). Mapa rośnie „na oczach jury" podczas spaceru demo. Live śledzenie ścieżki z IMU/AR = POZA tą kartą (stretch nocny).

**Blocked by:** 01 (UI + narzędzie add_zone z karty 02 działają)

**Estimate:** 1.5 / 3

**Owner:** D

**TDD:** seam mapy: fixtura `add_zone(kartony, pozycja)` → poprawny SVG element + spójność z bazą (strefa zapisana, klik zwraca szczegóły); test kolizji nazw („strefa: kartony" drugi raz → doprecyzowanie, nie duplikat).

**Demo check:** wpisz „strefa: kartony" → strefa pojawia się na mapie → klik → panel z asortymentem strefy; powtórz dla 3 stref — mapa wygląda jak magazyn, nie jak schowek.

**Status:** in progress — frontend renderuje strefy z `/api/zones` na schematycznym SVG, odświeża je po zatwierdzeniu komendy i pokazuje pozycje z `/api/stock` po wybraniu strefy. Tapnięcie następnego wolnego miejsca otwiera formularz z kartą potwierdzenia. Lokalizacja ma pierwszeństwo przed nazwą produktu; jedna pozycja trafia tylko do jednej widocznej strefy. „Gdzie leży X?” otwiera mapę i wybiera pasującą strefę, a odpowiedź o stanie pojedynczej pozycji ma przycisk „Pokaż na mapie”. Brak pasującej strefy jest jawny i pozwala przygotować jej dodanie. Globalny panel komend sprawdza duplikat przed pokazaniem karty zatwierdzenia i pyta o inną nazwę lub otwarcie istniejącej strefy; backend nadal chroni przed powtórnym zapisem przy wyścigu.

**Integracja z B (karta 10):** `CommandPanel.onShowLocation({ name, location })` przełącza widok na mapę. Callback może obsłużyć też lokalizację odczytaną z procedury; rozpoznawanie procedur pozostaje w zakresie B. Wspólna logika `zoneForItem` dopasowuje najdokładniejszą strefę po lokalizacji, a następnie po nazwie.

**Ograniczenia / następny krok:** układ pozostaje schematyczny, backend nie przechowuje współrzędnych. Do zamknięcia karty potrzebny jest GUI-check (tekst/głos → dodanie 3 stref → klik → szczegóły → zapytanie o lokalizację) na ekranie demo i telefonie. Dostęp automatyzacji do `localhost:5173` jest blokowany przez zapisane uprawnienie witryny; nie potwierdzono jeszcze wyglądu ani interakcji w przeglądarce.

**Weryfikacja ostatniego kroku:** 8 testów dopasowania stref i kontraktu odpowiedzi API, frontend build, lint (jedno wcześniejsze ostrzeżenie `react(set-state-in-effect)` w App), 119 testów backendu. Kontenery zbudowane i uruchomione. Przy otwieraniu wyniku mapa pobiera świeże strefy i asortyment; błąd sprawdzania listy stref jest jawny i zachowuje kartę propozycji, a ponowną nazwę chroni idempotencja backendu.

- [ ] strefy dodane głosem/tekstem pojawiają się na mapie bez przeładowania
- [ ] klik w strefę = szczegóły (asortyment + stany)
- [ ] duplikat nazwy strefy → pytanie o doprecyzowanie
- [ ] layout wygląda przekonująco na ekranie demo (projekt „prawdziwego" magazynu: brama, regały, strefy)
