# 11: Eksport XLSX/CSV — „wasiat Excela zostaje"

**What to build:** Z sekcji Stany/Ustawienia przycisk „Eksportuj" pobiera aktualny stan magazynu jako XLSX i CSV (nagłówki po polsku, zgodne z konwencją importu — plik eksportu da się z powrotem zaimportować przez kartę 05). Eksport obejmuje stany, progi i lokalizacje.

**Blocked by:** 05 (struktura danych po imporcie stabilna)

**Estimate:** 0.5 / 1

**Owner:** C

**TDD:** seam `InventoryAdapter` (eksport): fixtura bazy → wygenerowany plik → odczyt z powrotem adapterem importu → identyczne dane (round-trip).

**Demo check:** po imporcie i 2 zmianach głosowych klik Eksportuj → plik otwiera się w Excelu z aktualnymi wartościami; zaimportowanie eksportu z powrotem nie zmienia danych.

**Status:** ready

- [ ] XLSX i CSV do pobrania z poprawnymi polskimi nagłówkami
- [ ] round-trip import→eksport→import nie gubi ani nie duplikuje danych
- [ ] eksport zawiera stany, progi i lokalizacje
