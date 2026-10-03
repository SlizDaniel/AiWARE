# MAGAZYNIER

Głosowy agent magazynowy: powiedz mu na hali, co robisz — on proponuje zmianę na karcie,
ty ją zatwierdzasz jednym kliknięciem, a strona pokazuje całą wiedzę o magazynie.
HackYeah 2026, Open Task ARTIFICIAL INTELLIGENCE.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres + Auth) · Google Gemini
(function calling, transkrypcja mowy, mapowanie kolumn importu) · Tailwind v4 · wdrożenie na **Vercel**.
Poprzednia wersja (FastAPI + SQLite + Vite + Docker) leży w [`legacy/`](legacy/) jako punkt odniesienia.

## Szybki start lokalnie (bez kont i bez Dockera)

```bash
npm install
npm run dev
```

Otwórz http://localhost:3000. Bez konfiguracji aplikacja:

- trzyma dane w lokalnym Postgresie **PGlite** (`./data/pglite`, seed przy pierwszym starcie),
- działa **bez logowania** — jesteś lokalnym kierownikiem,
- rozumie komendy **parserem offline** (6 komend demo + „zapamiętaj: …”).

Aby włączyć Gemini, skopiuj `.env.example` do `.env.local` i ustaw `GEMINI_API_KEY`
(klucz: https://aistudio.google.com/apikey). Restart `npm run dev`.

## Wdrożenie na Vercel

1. **Supabase:** utwórz projekt na https://supabase.com (albo z poziomu Vercel →
   Storage → Supabase, integracja sama doda zmienne `POSTGRES_URL`, `NEXT_PUBLIC_SUPABASE_URL`, …).
2. **Zmienne środowiskowe** w Vercel → Project → Settings → Environment Variables:

   | Zmienna | Skąd |
   |---|---|
   | `GEMINI_API_KEY` | Google AI Studio |
   | `DATABASE_URL` | Supabase → Connect → **Transaction pooler** (port 6543); pomiń, jeśli integracja ustawiła `POSTGRES_URL` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys (publishable / anon) |

3. **Supabase Auth:** Authentication → URL Configuration → *Site URL* = adres z Vercela,
   *Redirect URLs* += `https://<twoja-domena>/auth/callback`. Metoda logowania: e-mail + hasło.
4. Import repo w Vercelu (framework wykrywa się sam: Next.js) → **Deploy**.
   Albo z terminala: `npx vercel` i `npx vercel --prod`.

Schemat bazy tworzy się sam przy pierwszym żądaniu (idempotentnie). Wszystkie tabele mają
włączone RLS bez polityk: publiczny klucz Supabase nie odczyta danych przez PostgREST,
a serwer łączy się jako właściciel tabel i sprawdza role w route handlerach.

`/api/health` pokazuje, czego używa wdrożenie (`storage`: `supabase` / `pglite` / `ephemeral`,
`auth_mode`, model Gemini). `ephemeral` = brak `DATABASE_URL` na Vercelu — dane znikną; UI to sygnalizuje.

## Konta i role

- Pierwsze konto, które się zaloguje, zostaje **kierownikiem**; kolejne — **pracownikami**.
- Kierownik zmienia role w **Ustawienia → Użytkownicy**.

| Akcja | Pracownik | Kierownik |
|---|:-:|:-:|
| Komendy głosem/tekstem, zatwierdzanie kart zmian | ✓ | ✓ |
| Podgląd stanów, mapy, historii, procedur, eksport CSV/XLSX | ✓ | ✓ |
| Import Excela/CSV, decyzje o szkicach zamówień | — | ✓ |
| Cofanie zmian w historii (undo), ustawienia, role użytkowników | — | ✓ |

Audyt zapisuje autora każdej zmiany.

## Demo check (ścieżka weryfikacyjna)

1. **Stany → Importuj plik** → `public/demo-offline.xlsx` (do pobrania pod `/demo-offline.xlsx`) →
   Gemini proponuje mapowanie kolumn → **Zatwierdź import**.
2. `strefa: kartony`, `strefa: szkło`, `strefa: folia stretch` → zatwierdź każdą kartę → strefy na **Mapie**.
3. „wzięliśmy paletę kartonów” (przycisk **Mów** albo tekst) → karta `Kartony 13→11` → **Zatwierdź** →
   wpis w **Historii** (z „Cofnij”) i szkic zamówienia w **Kolejce**.
4. `ile mamy szkła?`, `gdzie leży szkło?` (→ podświetlenie na mapie), `Magu, jak pakujemy szkło?`.
5. `zapamiętaj: szkło pakujemy z przekładkami` → zatwierdź → sekcja **Procedury**.

Komendy zapisu tworzą **kartę zmiany** i dotykają bazy dopiero po zatwierdzeniu; pytania dostają
odpowiedź bez zapisu; nieznane komendy — prośbę o doprecyzowanie. Agent nigdy nie zgaduje po cichu.

## Tryb agenta i Gemini

- `llm` (domyślny): Gemini z function calling na rejestrze 8 narzędzi (`get_stock`, `update_stock`,
  `check_reorder`, `draft_order`, `get_location`, `add_zone`, `remember_procedure`, `recall_procedure`)
  + `add_item`. Odpowiedź modelu przechodzi walidację schematu; błąd, timeout (15 s) albo
  niejednoznaczny JSON → parser offline + ostrzeżenie. Zapis i tak wymaga zatwierdzenia karty.
- `offline` / `mock`: deterministyczny parser, bez zewnętrznych API (import też nie wysyła pliku do LLM).
- Tryb zmienia kierownik w panelu komend albo w Ustawieniach (zapis w bazie, bez restartu).
- **STT:** nagranie z przycisku **Mów** → Gemini (audio) → transkrypcja w edytowalnym polu przed wysłaniem.
  Opcjonalnie `STT_API_KEY` przełącza na API zgodne z Whisper (np. Groq).
- Sprawdzenie kontraktu z prawdziwym modelem: `npm run check:gemini` (3 zapytania, syntetyczne dane).

## Ustawienia (karta 12)

Sekcja **Ustawienia** (zapis: kierownik, odczyt: wszyscy) — zmiany obowiązują od następnej komendy, bez restartu,
i są zapisane w bazie (`GET` / `PATCH /api/settings`):

- **Prefix agenta** (domyślnie „Magu”): jedno słowo, 2–30 liter. Komendy bez prefixu też działają;
  poprzedni prefix zostaje wyłączony — „Magu, …” po zmianie na „Gosiu” dostaje prośbę o doprecyzowanie, a nie wykonanie.
- **Tryb agenta** `llm` / `offline` / `mock` — ten sam przełącznik co w panelu komend.
- **Źródło danych:** wbudowana baza albo import z pliku (otwiera panel importu w Stanach).
- **Domyślne minimum** nowych pozycji (import bez kolumny minimum, karta „Nowa pozycja”); istniejące progi zostają.
- **Tryb głosu:** mikrofon po naciśnięciu albo tylko tekst (wtedy `/api/stt` zwraca 503, a mikrofon jest wyłączony).
- **Odczyt głosem** (TTS przeglądarki) i **domyślna ilość** w szkicu zamówienia.
- **Użycie AI:** gotowy tekst do sekcji „ujawnienie AI” w zgłoszeniu (modele i dostawcy z konfiguracji serwera).

## Demo offline

`DEMO_MODE=1` wymusza parser offline, wyłącza STT i używa osobnej bazy demo
(Kartony 13/min 12, Szkło 20/8, Folia 15/6 + procedura pakowania szkła).
Lokalnie: `./data/pglite-demo`; na Vercelu ustaw `DEMO_DATABASE_URL` (inna baza niż `DATABASE_URL`).
Reset próby: `npm run demo:reset` (zatrzymaj wcześniej `npm run dev`) albo `POST /api/demo/reset` (kierownik).

## Skrypty

```bash
npm run dev          # serwer deweloperski
npm run db:setup     # tworzy tabele w Supabase (DATABASE_URL), seed, sprawdza połączenie i RLS
npm run build        # build produkcyjny (to samo robi Vercel)
npm test             # vitest: parser, narzędzia, reorder, import/eksport, Gemini (mock), auth, API
npm run typecheck
npm run lint
```

## Struktura

```
src/app/            strony (/, /login) i route handlery /api/*
src/components/     UI: Mapa, Stany, Kolejka, Historia, Procedury, Ustawienia, panel komend
src/lib/            klient API, polling zmian (/api/version), TTS, klienci Supabase
src/server/         logika: db (SQL), parser offline, rejestr narzędzi, Gemini, STT, import, auth
public/             demo-magazyn.xlsx, demo-offline.xlsx, grafiki
docs/               PRD, koncept, karty tasków
legacy/             poprzednia wersja (FastAPI + Vite + Docker)
```

Zmiany na żywo: zamiast WebSocketu (niedostępny w funkcjach serverless Vercela) klient co 3 s
odpytuje `/api/version` — licznik zwiększany po każdym zapisie — i odświeża dane po zmianie.

## Ujawnienie użycia AI

Google Gemini (`gemini-3.8-flash` lub model z `GEMINI_MODEL`): interpretacja komend i function calling,
transkrypcja mowy, propozycja mapowania kolumn przy imporcie. Użytkownik widzi transkrypcję
i kartę zmiany przed zapisem; każda zmiana trafia do audytu z autorem i możliwością cofnięcia.
Gotowy tekst do zgłoszenia: **Ustawienia → Użycie AI**.
