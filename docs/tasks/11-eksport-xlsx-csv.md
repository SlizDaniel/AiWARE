# 11: Eksport XLSX/CSV — „wasiat Excela zostaje"

**What to build:** Z sekcji Stany/Ustawienia przycisk „Eksportuj" pobiera aktualny stan magazynu jako XLSX i CSV (nagłówki po polsku, zgodne z konwencją importu — plik eksportu da się z powrotem zaimportować przez kartę 05). Eksport obejmuje stany, progi i lokalizacje.

**Blocked by:** 05 (struktura danych po imporcie stabilna)

**Estimate:** 0.5 / 1

**Owner:** C

**TDD:** seam `InventoryAdapter` (eksport): fixtura bazy → wygenerowany plik → odczyt z powrotem adapterem importu → identyczne dane (round-trip).

**Demo check:** po imporcie i 2 zmianach głosowych klik Eksportuj → plik otwiera się w Excelu z aktualnymi wartościami; zaimportowanie eksportu z powrotem nie zmienia danych.

**Status:** done — CSV/XLSX downloads are available in Stany; both formats pass the import round-trip without data loss or duplicates. UI links were verified in the browser; backend suite: 112 passed; frontend typecheck and production build pass.

- [x] XLSX i CSV do pobrania z poprawnymi polskimi nagłówkami
- [x] round-trip import→eksport→import nie gubi ani nie duplikuje danych
- [x] eksport zawiera stany, progi i lokalizacje
