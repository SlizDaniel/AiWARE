# 25: Czyszczenie oczekujących szkiców

Owner A. Branch `feat/reorder-queue-clearing`.

Użytkownik chce usunąć oczekujące szkice pojedynczo lub zbiorczo.
Zgodnie z PRD zachowujemy audyt: usunięcie z kolejki oznacza odrzucenie,
a nie skasowanie historii.

- Kierownik ma przycisk Usuń z kolejki przy pojedynczym szkicu.
- Usuń wszystkie oczekujące wymaga potwierdzenia liczby; anulowanie nic nie zapisuje.
- Potwierdzamy snapshot ID: nowe szkice nie są odrzucane; rozpatrzone pomijamy.
- API kierownika waliduje ID, odrzuca w transakcji, audytuje każdą decyzję,
  zwiększa data_version raz. Powtórzenie jest bezpiecznym no-op.
- Stany magazynowe nie zmieniają się. Rozpatrzone i historia zachowują decyzje.
- Blokada przycisków podczas operacji i czytelny błąd/retry. Pracownik nie ma prawa odrzucać.
- Dla kolejki ponad 1000 szkiców czyszczenie po 1000 z jawną etykietą.

## Weryfikacja

13 nowych testów: audyt, snapshot, idempotencja, atomowy rollback, walidacja ID,
API kierownika oraz 403/401 dla pracownika i bez sesji.
Pełna regresja: 52 pliki przeszły; test API na postgres.js nie wystartował przez
losowy zablokowany port Windows. Ponowienie całego tego pliku: 11 przeszło,
1 pominięty. Łącznie 915 testów przeszło, 2 pominięte.
Web/mobile typecheck, lint i produkcyjny build webpack: OK.
GUI: anulowanie potwierdzenia, odrzucenie dwóch szkiców naraz, licznik 0,
Rozpatrzone z zachowanymi decyzjami i pojedyncze usunięcie: OK.
Review Standards i Spec: bez blockerów; doprecyzowano komunikat retry.
