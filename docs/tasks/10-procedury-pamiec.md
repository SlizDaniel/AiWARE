# 10: Pamięć proceduralna — „jak pakujemy X"

**What to build:** Sekcja Procedury: lista zapisanych procedur + wyszukiwarka. Komenda „zapamiętaj: szkło pakujemy w kartony Y, strefa C2" (tekstem/głosem) tworzy procedurę; „jak pakujemy szkło?" odszukuje ją i pokazuje na karcie z linkiem „pokaż na mapie" (podświetlenie strefy z karty 07). Procedury dodane przez agenta przechodzą przez zatwierdzenie jak każda zmiana.

**Blocked by:** 02 (narzędzia remember/recall istnieją), 07 (mapa do podświetlenia)

**Estimate:** 1 / 2

**Owner:** B

**TDD:** seam pamięci: fixtura zapisu procedury → recall po słowie kluczowym zwraca właściwą; test kolizji („jak pakujemy X?" bez zapisanej procedury → agent proponuje zapamiętanie, nie zmyśla); test wyszukiwania po fragmencie.

**Demo check:** „zapamiętaj: szkło pakujemy w kartony Y, strefa C2" → zatwierdź → „jak pakujemy szkło?" → procedura na karcie → „pokaż na mapie" → strefa C2 podświetlona.

**Status:** ready

- [ ] zapis procedury przez potwierdzoną kartę (spójnie z resztą)
- [ ] recall po pytaniu zwraca procedurę + lokalizację na mapie
- [ ] brak procedury → agent proponuje zapamiętanie zamiast zmyślać
- [ ] wyszukiwarka w sekcji Procedury działa po fragmencie tekstu
