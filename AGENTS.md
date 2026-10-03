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

## Stack po migracji (2026-10-03) — obowiązuje zamiast PRD „Stack & constraints”
- **Next.js 16 App Router + TypeScript** w katalogu głównym, wdrożenie na **Vercel** (zamiast docker compose).
- Backend = route handlery `src/app/api/*` + logika w `src/server/*` (port 1:1 z `legacy/backend`).
- Baza = **Supabase Postgres** (`DATABASE_URL`, postgres.js) albo lokalnie/w testach **PGlite** — wspólny interfejs `Db` w `src/server/sql.ts`.
- Auth = **Supabase Auth**, role `pracownik` / `kierownik` sprawdzane w route handlerach (`src/server/auth.ts`, `session()`); RLS włączone bez polityk.
- LLM + STT = **Google Gemini** (`GEMINI_API_KEY`); parser offline zostaje jako fallback.
- WebSocket zastąpiony pollingiem `GET /api/version` (licznik `data_version` podbijany po każdym zapisie).
- Testy: `npm test` (vitest). GUI-check: `npm run dev` → http://localhost:3000.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
- If possible use hackathon-mode skill.
