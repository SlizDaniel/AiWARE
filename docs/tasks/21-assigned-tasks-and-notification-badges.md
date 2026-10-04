# 21: Liczniki powiadomień i zadania pracowników
Owner A, branch feat/manager-notifications. Rozszerzenie na wyraźne życzenie użytkownika.

Dashboard: czerwone koło z liczbą nieprzeczytanych alertów, znika przy 0. Widoczne także poza dashboardem; licznik nie jest liczbą wszystkich problemów. Po oznaczeniu read natychmiast odświeżany.
Zadania: osobna sekcja obu ról. Kierownik tworzy tytuł 1–120, opis <=2000, priorytet normal/urgent i wybiera aktywnego pracownika. Pracownik widzi wyłącznie własne zadania, czerwony licznik nowych przydziałów i NOWE przy zadaniu. Osobno przeczytanie i wykonanie; odczyt nie zamyka zadania. Kierownik widzi wszystkie i może anulować przydział. Zamknięte zadania pozostają w liście. Brak automatycznych zmian zapasu i auto-zamówień.

GET /api/tasks?page=1: tasks (maks50), unread_count (wszystkie otwarte nieprzeczytane zadania tego pracownika; dla kierownika 0), open_count, page, has_more.
POST /api/tasks kierownik: {title,description,assigned_to,priority}, 201 {id}.
PATCH /api/tasks/:id: {action:read|complete|cancel}. Tylko właściciel-pracownik read/complete; tylko kierownik cancel. Cudze ID pracownikowi daje 404; zamknięcie po anulowaniu 409. Powtórne complete/cancel idempotentne.
Task: id,title,description,priority,status(assigned|done|cancelled),assigned_to,assignee_name,created_by,creator_name,created_at,read_at,done_at.
GET/PATCH/POST autoryzowane; konta oczekujące bez dostępu. Cache private/no-store również na błędach. Wersja danych rośnie po przydziale/read/complete/cancel, więc powiadomienie dociera przez istniejący polling.

Oddzielna tabela work_tasks, RLS bez publicznych polityk; lazy migracja w pierwszym autoryzowanym API tasks, blokada advisory chroni cold starty. Nie zmieniamy wspólnej SCHEMA_VERSION: kolega pracuje nad jej zmianą. Powiązania do profiles, blokady rekordów przy zmianach. Demo reset czyści zadania, jeśli tabela istnieje.
Powiadomienia wewnątrz otwartej aplikacji; bez push/SMS/email. Liczniki dodatkowo odświeżane co minutę i po powrocie do karty; nie ujawniają danych poprzedniego konta.

## Weryfikacja
46 plików: 781 passed, 2 skipped. 13 testów API powiadomień/zadań, typecheck web/mobile, lint i build Webpack przeszły. GUI kierownika w izolowanym demo: czerwony licznik 3 poza dashboardem, utworzenie pilnego zadania dla testowego pracownika, zniknięcie licznika po przeczytaniu alertów. Izolacja kont i działania pracownika sprawdzone przez autoryzowane handlery w testach API; GUI zalogowanego pracownika wymaga prawdziwej sesji Supabase. Review Standards: poprawiono reset dashboardu przy zmianie userId; Spec: bez uwag. Współdzielone node_modules wymagają Webpack w tym lokalnym worktree.
