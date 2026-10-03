# AGENTS.md — MAGAZYNIER (HackYeah 2026)

**Każda nowa sesja agenta zaczyna od przeczytania `docs/PRD.md`** (grounding context). Decyzje produktowe są tam zamknięte — nie renegocjuj scope'u w sesjach roboczych; nowe pomysły trafiaj do backlogu prezentacji.

## Kluczowe dokumenty
- `docs/PRD.md` — single source of truth (scope, demo script, stack, seams testowe).
- `docs/CONCEPT.md` — pełny koncept + ryzyka/fallbacki.
- `docs/tasks/` — karty tasków (tracer bullets); każda sesja agenta = jedna karta.

## Demo path (jedyna definicja „działa")
Import Excela → mapowanie kolumn (LLM) → zatwierdzenie → stany na stronie → głos „wzięliśmy paletę kartonów" → karta zmiany → confirm → audyt z undo → proaktywny szkic zamówienia → „gdzie leży X?" → podświetlenie na mapie → „jak pakujemy szkło?" → procedura.

## Żelazne zasady
- Happy path zawsze zielony; po każdym sliceGUI-check przez przeglądarkę.
- Brakująca zależność = mock (MockAgent, tekstowy fallback STT, seed SQLite, `demo-magazyn.xlsx`).
- Milestones: **16:00 tracer bullet** (głos→narzędzie→baza→audyt na ekranie), 19:00 mapa+stany, 22:00 import Excela+reorder, **24:00 feature freeze**, 07:00 próba generalna, 09:00 prezentacja PDF, **10:30 submit** (deadline 11:00).
- Ujawnienie użycia AI (LLM + STT) w zgłoszeniu — wymóg regulaminu.
