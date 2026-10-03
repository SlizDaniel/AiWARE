# 10: Pamięć proceduralna — „jak pakujemy X"

**What to build:** Sekcja Procedury: lista zapisanych procedur + wyszukiwarka. Komenda „zapamiętaj: szkło pakujemy w kartony Y, strefa C2" (tekstem/głosem) tworzy procedurę; „jak pakujemy szkło?" odszukuje ją i pokazuje na karcie z linkiem „pokaż na mapie" (podświetlenie strefy z karty 07). Procedury dodane przez agenta przechodzą przez zatwierdzenie jak każda zmiana.

**Blocked by:** 02 (narzędzia remember/recall istnieją), 07 (mapa do podświetlenia)

**Estimate:** 1 / 2

**Owner:** B

**TDD:** seam pamięci: fixtura zapisu procedury → recall po słowie kluczowym zwraca właściwą; test kolizji („jak pakujemy X?" bez zapisanej procedury → agent proponuje zapamiętanie, nie zmyśla); test wyszukiwania po fragmencie.

**Demo check:** „zapamiętaj: szkło pakujemy w kartony Y, strefa C2" → zatwierdź → „jak pakujemy szkło?" → procedura na karcie → „pokaż na mapie" → strefa C2 podświetlona.

**Status:** implemented — lista i wyszukiwarka Procedur, podgląd treści przed zatwierdzeniem oraz „Pokaż na mapie” z karty odpowiedzi i listy. Istniejący backend zachowuje confirm-before-write, recall i audyt. Backend 120/120, frontend typecheck/build i testy 9/9 przeszły. GUI-check pozostaje otwarty: narzędzie przeglądarki zwraca „No browser is available”.

- [x] zapis procedury przez potwierdzoną kartę (spójnie z resztą)
- [x] recall po pytaniu zwraca procedurę + lokalizację na mapie
- [x] brak procedury → agent proponuje zapamiętanie zamiast zmyślać
- [x] wyszukiwarka w sekcji Procedury działa po fragmencie tekstu
- [ ] GUI-check: zapis → confirm → recall → „Pokaż na mapie” → C2 podświetlona; wyszukiwanie po fragmencie i stan bez wyników

Powiązanie mapy wymaga istniejącej strefy. Jawna nieznana lub sprzeczna lokalizacja nie wybiera innej strefy; bez lokalizacji link jest dostępny tylko dla jednoznacznego powiązania tematu z nazwą strefy/towaru. Lista odświeża się po potwierdzeniu i zdarzeniu WebSocket.
