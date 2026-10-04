# 20: Automatyczne powiadomienia kierownika
Owner A. Branch feat/manager-notifications. Rozszerzenie dashboardu na życzenie użytkownika.

Reguły: stan <=0 critical (także minimum=0); dodatni stan poniżej minimum warning; zatwierdzony ubytek >=50% dodatniego stanu w ostatnich 24 h warning; pending order >=24 h warning, >=48 h critical. Cofnięte operacje i undo nie generują alertu dużego wydania.

GET /api/notifications: generated_at, notifications, unread_count, critical_count, truncated.
Notification: id, kind, priority, title, message, item_id, item_name, occurred_at (null dla bieżącego stanu), target (stany/historia/kolejka), read.
PATCH /api/notifications: {ids: string[]} (1–100 aktualnych identyfikatorów). Nieaktualny identyfikator 409, błędne dane 422.
Obie metody session(kierownik), private/no-store. GET spójny snapshot.

Alerty deterministyczne z istniejących danych: bez AI, crona, migracji i zapisów do zapasu/audytu. Dashboard odświeża po data_version oraz co 60 sekund, gdy widoczny. Bez SMS/email/push ani działania przy zamkniętej aplikacji.
Przeczytanie trwale zapisane per kierownik w istniejących settings, key manager_notifications_read:<user_id>, maksymalnie 500 potwierdzeń. Blokada rekordu chroni równoległe zapisy. Cudzy user_id nie jest parametrem API.
Aktualizacja ilości/minimum lub zdarzenie magazynowe zmienia identyfikator alertu stanu. Rozwiązany problem znika; przeczytanie nie usuwa problemu ani nie zatwierdza zamówienia. Import, edycja i undo aktualizują alerty przez bieżący stan.
Najpierw critical; maksymalnie 100 alertów, przy większej liczbie truncated=true. Liczniki dotyczą zwróconej listy. To nie archiwum: pełny ślad pozostaje w Historii.

Kryteria: role, osobne read receipts, progi i 24/48 h, znikanie po undo/odbudowie zapasu; UI liczniki, filtr, oznaczanie, przejścia do sekcji; demo offline.

## Weryfikacja
770 testów zaliczonych, 2 pominięte (44 pliki); 8 testów nowego API. Typecheck i lint przeszły. Build produkcyjny Webpack przeszedł; Turbopack w tym worktree odrzuca junction do współdzielonych node_modules (ograniczenie lokalnego układu zależności). GUI w izolowanym demo: 4 alerty, 2 pilne; przeczytanie jednego zmniejszyło licznik do 3 i przetrwało reload. Review Standards/Spec: poprawiono odświeżenie po 409 i no-store również dla błędów; brak pozostałych uwag.
