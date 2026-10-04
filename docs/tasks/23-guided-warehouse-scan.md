# 23 — Schemat alejek ze spaceru w Expo Go

Zakres zatwierdzony: mapowanie 2D z kroków, wskazywanych skrzyżowań i skrętów.
Dodawanie grup produktów do alejek pozostaje na później.

## Przebieg

Wybierz punkt początkowy, kierunek na planie i długość kroku → spacer prosto →
Skrzyżowanie / W lewo / W prawo / Zawróć → fizyczny powrót do znanego punktu →
potwierdzenie powrotu i korekta nowych odcinków → zapis → następne przejście ze
znanego skrzyżowania na tym samym planie.

## Kryteria

- [x] Kompas nie zmienia kierunku alejki; tylko ręczne skręty 90°/180°.
- [x] Skrzyżowania są ponownie dostępne po zapisie przez obecne API, bez migracji bazy.
- [x] Powrót domyka pętlę i zachowuje prostopadłe odcinki oraz wcześniejsze kotwice.
- [x] Niepasująca kotwica odrzuca korektę bez częściowych zmian.
- [x] Bez czujników można sprawdzić całą ścieżkę przyciskiem + Krok.
- [x] Kolejne przejście zaczyna się we współrzędnych wybranego zapisanego skrzyżowania.
- [x] GUI: pętla → korekta → zapis → odgałęzienie → ponowne wczytanie miniatury.
- [ ] Fizyczny iPhone: sprawdzenie detekcji kroków i prostokątnego spaceru.

## Granice

Schemat zakłada prostopadłe alejki i szacuje dystans z kalibrowanej długości kroku.
Nie rozpoznaje sam miejsc, ścian, regałów ani powrotów. Nie poprawia starych ścieżek
z kompasu. `GuidedScan` odpowiada za geometrię, `createStepTracker` za próbki ruchu,
`MapScreen` za decyzje użytkownika; `/api/map-paths` zachowuje dotychczasowy kontrakt.

Testy: `tests/mobile-guided-scan.test.ts`, `tests/mobile-imu.test.ts`,
`tests/mobile-mapping.test.ts`, istniejące testy PDR i API ścieżek.

Walidacja: `npm test -- mobile map-path pdr` — 77/77; typecheck mobilny;
eksport Expo web/iOS. GUI w Firefoxie, viewport 390 px, kroki ręczne i mock logowania
Supabase, rzeczywiste API na izolowanej kopii i bazie PGlite: pętla z 38 kroków
(10/10/9/9), korekta START, zapis, odgałęzienie z S1, reload mapy — PASS.
Próba z fizycznymi czujnikami iPhone'a pozostaje niewykonana.

Naprawa istniejącej bazy: logi i odczyt Supabase wykazały wersję 4 bez
`map_sectors`/`map_sector_items`. Wersja 5 tworzy te tabele i RLS, pomijając
niepotrzebne ALTER na `profiles`, które blokowały żywe odczyty. Zachowany przez
HMR uchwyt bazy jest ponownie sprawdzany. Zatwierdzone `npm run db:setup` zakończyło
się sukcesem (16/16 tabel z RLS); odczyty ścieżek/sektorów w tej bazie przeszły.
Pełna walidacja po poprawce: 908 testów zaliczonych, 2 pominięte, typecheck webowy.
