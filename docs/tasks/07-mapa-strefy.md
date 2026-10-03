# 07: Mapa schematyczna 2D + strefy dodawane głosem/tapem

**What to build:** Schematyczny rzut magazynu jako SVG (ściany/regały jako prostokąty — lay­out z pliku konfiguracyjnego lub rysowany raz na sztywno dla dema). Komenda „strefa: kartony" (głosem lub tekstem) tworzy strefę na mapie z etykietą; klik w strefę pokazuje panel szczegółów (co leży w strefie, ile). Mapa rośnie „na oczach jury" podczas spaceru demo. Live śledzenie ścieżki z IMU/AR = POZA tą kartą (stretch nocny).

**Blocked by:** 01 (UI + narzędzie add_zone z karty 02 działają)

**Estimate:** 1.5 / 3

**Owner:** D

**TDD:** seam mapy: fixtura `add_zone(kartony, pozycja)` → poprawny SVG element + spójność z bazą (strefa zapisana, klik zwraca szczegóły); test kolizji nazw („strefa: kartony" drugi raz → doprecyzowanie, nie duplikat).

**Demo check:** wpisz „strefa: kartony" → strefa pojawia się na mapie → klik → panel z asortymentem strefy; powtórz dla 3 stref — mapa wygląda jak magazyn, nie jak schowek.

**Status:** in progress — frontend renderuje strefy z `/api/zones` na schematycznym SVG, odświeża je po zatwierdzeniu komendy i pokazuje pozycje z `/api/stock` po wybraniu strefy. Tapnięcie następnego wolnego miejsca otwiera formularz z kartą potwierdzenia. Lokalizacja ma pierwszeństwo przed nazwą produktu; jedna pozycja trafia tylko do jednej widocznej strefy. „Gdzie leży X?” otwiera mapę i wybiera pasującą strefę, a odpowiedź o stanie pojedynczej pozycji ma przycisk „Pokaż na mapie”. Brak pasującej strefy jest jawny i pozwala przygotować jej dodanie. Globalny panel komend sprawdza duplikat przed pokazaniem karty zatwierdzenia i pyta o inną nazwę lub otwarcie istniejącej strefy; backend nadal chroni przed powtórnym zapisem przy wyścigu.

**Integracja z B (karta 10):** `CommandPanel.onShowLocation({ name, location })` przełącza widok na mapę. Callback może obsłużyć też lokalizację odczytaną z procedury; rozpoznawanie procedur pozostaje w zakresie B. Wspólna logika `zoneForItem` dopasowuje najdokładniejszą strefę po lokalizacji, a następnie po nazwie.

**Ograniczenia / następny krok:** układ pozycji schematyczny, backend nie przechowuje współrzędnych. GUI-check na ekranie demo zaliczony 2026-10-04 (demo offline, port 3002, dowody `gui-test-screenshots/t11–t14`, `t19`); weryfikacja na telefonie pozostaje w karcie 14.

**Weryfikacja ostatniego kroku:** 8 testów dopasowania stref i kontraktu odpowiedzi API, frontend build, lint (jedno wcześniejsze ostrzeżenie `react(set-state-in-effect)` w App), 119 testów backendu. Kontenery zbudowane i uruchomione. Przy otwieraniu wyniku mapa pobiera świeże strefy i asortyment; błąd sprawdzania listy stref jest jawny i zachowuje kartę propozycji, a ponowną nazwę chroni idempotencja backendu.

**GUI-check 2026-10-04 (Next.js, offline):** „strefa: kartony" → karta `add_zone` → zatwierdzenie → mapa „1 STREF" bez przeładowania (toast „Zapisano w bazie…"), klik strefy → panel „WYBRANA STREFA" z asortymentem (Kartony 13 szt, Strefa A-1), duplikat → karta „Doprecyzujmy" z „Otwórz istniejącą strefę", 3 strefy na rzucie (brama, regały A/B, ciąg komunikacyjny). „Gdzie leży szkło?" → odpowiedź `get_location` + „Pokaż na mapie" + podświetlenie strefy. Nit: strefa „folia" pokazuje 0 pozycji (pozycja „Folia stretch" leży w „Strefie C-1" — dopasowanie po nazwie nie łapie; na demo nazywać strefy jak nazwy pozycji).

- [x] strefy dodane głosem/tekstem pojawiają się na mapie bez przeładowania
- [x] klik w strefę = szczegóły (asortyment + stany)
- [x] duplikat nazwy strefy → pytanie o doprecyzowanie
- [x] layout wygląda przekonująco na ekranie demo (projekt „prawdziwego" magazynu: brama, regały, strefy)
