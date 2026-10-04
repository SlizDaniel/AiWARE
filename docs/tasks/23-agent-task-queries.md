# 23 — Pytania agenta o zadania

Agent odpowiada na „jakie zadanie ma Michał”, „jakiego taska ma Kuba” i pytania o własne zadania. Odczytuje otwarte zadania z bazy, pokazuje tytuł, opis i pilny priorytet. Kierownik widzi zespół, pracownik tylko siebie. Niejednoznaczne imię wymaga pełnej nazwy; brak zadań i brak dostępnej osoby mają jawne odpowiedzi. Wspólny kontrakt narzędzia dla Gemini i parsera offline.

Weryfikacja: testy parsera i pipeline z PGlite (dane, uprawnienia, niejednoznaczność, brak zapisów), typecheck oraz GUI-check.
