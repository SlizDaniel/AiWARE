# 14: Aplikacja mobilna — Expo / React Native / Supabase

**What to build:** Zgodnie z decyzją użytkownika z 2026-10-03: osobny klient Expo + React Native + TypeScript + NativeWind w `mobile/`. Supabase Auth, istniejące API Next.js i Supabase Postgres. Panel komend z nagrywaniem/transkrypcją i zatwierdzeniem, stany, schemat stref, historia z undo, kolejka, procedury, import/eksport i ustawienia. Serwer weryfikuje tokeny Bearer, role i autora zmian.

**Blocked by:** 04 (STT działa), 07 (mapa — telefon pokazuje też mini-mapę)

**Estimate:** 1 / 2

**Branch:** `feature/expo-mobile`

**Testing seams:** transport mobilny (token, błędy, surowe audio/eksport, confirm-before-write), serwerowa weryfikacja JWT i zachowanie ról, GUI na izolowanej bazie.

**Demo check:** zaloguj się → nagraj lub wpisz komendę → sprawdź transkrypcję → wyślij → zatwierdź kartę → stany/historia → undo → pytanie o lokalizację → mapa. Import XLSX wymaga sprawdzenia mapowania przed zapisem.

**Status:** zaimplementowane; weryfikacja na fizycznym telefonie pozostaje otwarta. Uruchomienie: `docs/mobile.md`.

- [x] osobny klient Expo, konfiguracja TypeScript/NativeWind, lockfile
- [x] logowanie Supabase i API z Bearer; role pozostają po stronie serwera
- [x] komendy, confirm, stany, mapa, audyt/undo, kolejka, procedury, import/eksport, ustawienia
- [x] testy, typy/lint, zgodność Expo, eksport Android/iOS/web, build backendu
- [x] GUI: atrapa logowania + prawdziwe izolowane API, karta/confirm/audyt/undo/import
- [ ] prawdziwe konto Supabase oraz mikrofon/STT/TTS, picker i udostępnianie na Android/iOS
- [ ] kwalifikacja alertów bezpieczeństwa zależności przed publikacją
