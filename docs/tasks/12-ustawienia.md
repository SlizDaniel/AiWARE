# 12: Sekcja Ustawienia

**What to build:** Ustawienia dla właściciela: prefix wywołania agenta (domyślnie „Magu"), tryb agenta (llm/offline/mock — czyta z karty 03/13), wybór adaptera danych (wbudowana baza / import z pliku), domyślne progi, info o wersji i użyciu AI (które modele/API — gotowiec do sekcji „ujawnienie AI" zgłoszenia). Zmiany zapisują się i obowiązują bez restartu.

**Blocked by:** 01 (szkielet sekcji istnieje)

**Estimate:** 0.75 / 1.5

**Owner:** C

**TDD:** seam konfiguracji: zmiana prefixu → komenda z nowym prefixem działa, ze starym nie wywołuje narzędzi; zmiana trybu agenta obowiązująca od następnej komendy.

**Demo check:** zmień prefix na „Gosiu" → „Gosiu, ile mamy kartonów?" działa; sekcja pokazuje listę używanych modeli AI (do wklejenia w zgłoszenie).

**Status:** done — persisted SQLite settings, immediate prefix/mode changes, data-source preference, default minimum and voice mode. Backend: 134 tests passed; frontend typecheck/build passed. Browser demo check: Gosiu query works, Magu rejected, text mode disables microphone, import shortcut opens file panel, AI disclosure copies, reload preserves settings. Code review: no remaining Standards/Spec findings; corrected STT blank-environment disclosure and minimum visibility on LLM item confirmation cards.

- [x] prefix konfigurowalny i działa natychmiast
- [x] tryb agenta przełączalny z UI (nie tylko .env)
- [x] sekcja „użycie AI" gotowa do skopiowania do zgłoszenia
- [x] ustawienia przetrwają restart (zapis w bazie/pliku)
