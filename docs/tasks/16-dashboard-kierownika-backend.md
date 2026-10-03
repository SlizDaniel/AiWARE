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

## Rozszerzenie v2 zamówione przez użytkownika

- [x] CSV filtrowanego dziennika z limitami i ochroną przed formułami w arkuszu.
- [x] Podsumowanie zmiany (domyślnie 8 h), autorzy, procedury, aktualne braki.
- [x] Trend zapasu towaru z importami/undo, wykrywaniem luk i ograniczeniem punktów.
- [x] Odznaki szkiców: 24 h warning/overdue, 48 h critical.
- [x] Kontrakt v2 i typy dla frontendu, 56 testów dashboardu na obu adapterach.
- [x] Pełny zestaw: 583 passed, 1 skipped; build/typecheck/lint passed.
  Standards i Spec review bez uwag; produkcyjne lokalne HTTP 200 dla nowych
  endpointów, dotychczasowy panel GUI ładuje stany i łączy się z backendem.
  Pierwszy pełny przebieg trafił na zablokowany losowy port Windows w istniejącym
  teście API; ponowiony pełny przebieg przeszedł bez zmian kodu testu.
- [x] Po integracji najnowszego main `6304205` na branchu funkcjonalności:
  607 passed, 1 skipped (26 plików); build/typecheck/lint passed, brak konfliktów.
- [x] Przed mergem do main zintegrowano `4cfe35e` bez konfliktów:
  610 passed, 1 skipped; build/typecheck/lint passed. Wszystkie pięć endpointów
  dashboardu zwraca HTTP 200 lokalnie, istniejący panel GUI ładuje stany.

Poza zakresem tej karty: komponent dashboardu, logowanie odczytów/kliknięć,
ocena pracowników, AI opisujące statystyki.
