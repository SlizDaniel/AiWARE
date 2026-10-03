# 16: Backend dashboardu kierownika

Rozszerzenie zamówione przez użytkownika po wdrożeniu podstawowego MVP.

**Owner:** A (backend); frontend — D, według `docs/manager-dashboard-api.md`.

**What to build:** API podsumowania magazynu, uwag wymagających decyzji, dziennych
liczników i dziennika z filtrami. Wyłącznie kierownik; wspólna baza Supabase/PGlite.
Nie zmieniamy komponentów frontendu ani istniejących ścieżek zapisu.

**Testing seam:** realne HTTP route handlery + oba adaptery Postgres, definicje metryk,
walidacja dat, paginacja i role. GUI-check backendu przez endpointy lokalnej aplikacji.

**Status:** backend ready — oba endpointy dostępne, kontrakt i typy przygotowane
dla frontendu. 42 testy dashboardu (PGlite + postgres.js), pełny zestaw po integracji
`6760174`: 569 passed,
1 skipped; typecheck/lint/build passed. Standards/Spec review bez uwag.
Lokalne HTTP 200 sprawdzone z produkcyjnego buildu; dotychczasowy panel GUI działa.
Przeglądarka blokuje bezpośrednie otwarcie JSON, więc API sprawdzono przez HTTP.
Widok dashboardu i jego GUI-check pozostają do wykonania przez frontend.

- [x] Podsumowanie i listy attention, aktualne stany niezależne od zakresu dat.
- [x] Serie danych do wykresów dziennych; importy i undo nie zawyżają pobrań/dostaw.
- [x] Filtrowany i stronicowany dziennik z UUID autora i powiązaniami undo.
- [x] Kierownik 200, pracownik 403, brak sesji 401.
- [x] Kontrakt i typy dostępne dla frontendu; brak nowych zależności i migracji.
- [x] Testy, build i review; lokalne sprawdzenie endpointów.

Poza zakresem tej karty: komponent dashboardu, logowanie odczytów/kliknięć,
ocena pracowników, AI opisujące statystyki, eksport nowych raportów.
