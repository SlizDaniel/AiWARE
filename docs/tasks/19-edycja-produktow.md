# 19: Edycja produktów na stronie

**Owner:** full-stack.

**Cel:** kierownik może edytować istniejący produkt bezpośrednio w sekcji Stany: nazwę,
ilość, minimum, jednostkę i lokalizację. Zapis ma walidację, wpis w audycie i synchronizuje
szkic zamówienia. Pracownik widzi stany, ale nie dostaje opcji edycji.

**Zakres:** `PATCH /api/stock/[id]`, walidacja ról i danych na serwerze, formularz edycji
w tabeli stanów, widoczny wpis historii oraz polling wersji danych.

**Weryfikacja:** typecheck oraz GUI-check jako kierownik i pracownik.

**Postęp:** endpoint, formularz i audyt wdrożone; typecheck przechodzi. GUI-check
zablokowany, bo lokalny serwer zwraca `auth_mode=misconfigured` pomimo uruchomienia
z `AUTH_DISABLED=1`, więc nie udostępnia stanów.
