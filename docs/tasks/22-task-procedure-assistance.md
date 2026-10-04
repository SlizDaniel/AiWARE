# 22 — Pomoc przy zadaniu na podstawie procedur
Owner: Agent A. Branch: feat/manager-notifications.

## Zakres
Pracownik otrzymuje powiadomienie o przydziale (task 21), następnie przy otwartym zadaniu klika „Jak wykonać? — procedury i AI”. Kierownik może podglądać pomoc. Pracownik ma dostęp wyłącznie do własnych zadań.
POST /api/tasks/:id/help zwraca task_id, mode (llm/procedures/missing), steps (text, procedure_id, procedure_topic), sources (id,topic,text), warning. Cache-Control private,no-store. 10 żądań/min na użytkownika. Zamknięte zadanie: 409; cudze: 404.

## AI i źródła
Użytkownik zatwierdził wysyłanie treści zadania i pasujących procedur do Google Gemini wyłącznie po kliknięciu pomocy. Integracja korzysta z istniejącego klucza i modelu. Nie wymaga nowej usługi. Wyszukiwanie pobiera do 100 dopasowanych procedur o treści do 24000 znaków i temacie do 1000 znaków, po rankingu SQL. Dłuższe dokumenty nie są analizowane; komunikat braku źródeł nie oznacza braku dokumentu poza zakresem. Normalizacja polskich znaków i prefiksów słów wybiera do 20 procedur; jest to wyszukiwanie heurystyczne, nie semantyczne. LLM wybiera do 8 dosłownych fragmentów zapisanych źródeł, serwer odrzuca nieznane źródła i tekst nieobecny w procedurze. To pomoc do sprawdzenia, nie gwarancja kompletności: pełne procedury i warunki bezpieczeństwa są dostępne pod krokami.
Cały kontekst procedur do 24000 znaków; przy przekroczeniu pokazujemy źródła lokalnie. Timeout 12 s. Offline/mock/demo/brak klucza/błąd dostawcy/nieprawidłowa odpowiedź: procedury lokalne, bez planu AI. Brak źródeł: komunikat o konieczności instrukcji od kierownika.
Kliknięcie nie zmienia zapasu, audytu, statusu zadania ani odczytania powiadomienia. Brak automatycznych wywołań modelu podczas odświeżania listy.

## Sprawdzenie
Testy w tests/work-tasks.test.ts obejmują uprawnienia, read-only, offline, cytaty, błędy Gemini, limity, zamknięte zadania i polskie znaki. Odpowiedzi Gemini są mockowane; prawdziwe API wymaga skonfigurowanego klucza i osobnego sprawdzenia integracji.

Weryfikacja końcowa: 46 plików, 786 testów passed, 2 skipped; typecheck, lint oraz build --webpack zaliczone. GUI demo: pomoc pokazuje pełną procedurę do zadania. Przegląd Standards i Spec: bez nierozwiązanych uwag.
