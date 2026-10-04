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
