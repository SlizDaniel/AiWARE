# 12: Sekcja Ustawienia

**What to build:** Ustawienia dla właściciela: prefix wywołania agenta (domyślnie „Magu"), tryb agenta (llm/offline/mock — czyta z karty 03/13), wybór adaptera danych (wbudowana baza / import z pliku), domyślne progi, info o wersji i użyciu AI (które modele/API — gotowiec do sekcji „ujawnienie AI" zgłoszenia). Zmiany zapisują się i obowiązują bez restartu.

**Blocked by:** 01 (szkielet sekcji istnieje)

**Estimate:** 0.75 / 1.5

**Owner:** C

**TDD:** seam konfiguracji: zmiana prefixu → komenda z nowym prefixem działa, ze starym nie wywołuje narzędzi; zmiana trybu agenta obowiązująca od następnej komendy.

**Demo check:** zmień prefix na „Gosiu" → „Gosiu, ile mamy kartonów?" działa; sekcja pokazuje listę używanych modeli AI (do wklejenia w zgłoszenie).

**Status:** ready

- [ ] prefix konfigurowalny i działa natychmiast
- [ ] tryb agenta przełączalny z UI (nie tylko .env)
- [ ] sekcja „użycie AI" gotowa do skopiowania do zgłoszenia
- [ ] ustawienia przetrwają restart (zapis w bazie/pliku)
