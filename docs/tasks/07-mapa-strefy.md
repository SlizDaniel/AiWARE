# 07: Mapa schematyczna 2D + strefy dodawane głosem/tapem

**What to build:** Schematyczny rzut magazynu jako SVG (ściany/regały jako prostokąty — lay­out z pliku konfiguracyjnego lub rysowany raz na sztywno dla dema). Komenda „strefa: kartony" (głosem lub tekstem) tworzy strefę na mapie z etykietą; klik w strefę pokazuje panel szczegółów (co leży w strefie, ile). Mapa rośnie „na oczach jury" podczas spaceru demo. Live śledzenie ścieżki z IMU/AR = POZA tą kartą (stretch nocny).

**Blocked by:** 01 (UI + narzędzie add_zone z karty 02 działają)

**Estimate:** 1.5 / 3

**Owner:** D

**TDD:** seam mapy: fixtura `add_zone(kartony, pozycja)` → poprawny SVG element + spójność z bazą (strefa zapisana, klik zwraca szczegóły); test kolizji nazw („strefa: kartony" drugi raz → doprecyzowanie, nie duplikat).

**Demo check:** wpisz „strefa: kartony" → strefa pojawia się na mapie → klik → panel z asortymentem strefy; powtórz dla 3 stref — mapa wygląda jak magazyn, nie jak schowek.

**Status:** ready

- [ ] strefy dodane głosem/tekstem pojawiają się na mapie bez przeładowania
- [ ] klik w strefę = szczegóły (asortyment + stany)
- [ ] duplikat nazwy strefy → pytanie o doprecyzowanie
- [ ] layout wygląda przekonująco na ekranie demo (projekt „prawdziwego" magazynu: brama, regały, strefy)
