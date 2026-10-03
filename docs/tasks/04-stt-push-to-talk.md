# 04: STT — push-to-talk → tekst → istniejący pipeline

**What to build:** Przycisk „mów" w UI (mysz/touch) włącza mikrofon, mowa jest transkrybowana API zgodnym z Whisper (dobre po polsku), transkrypcja zawsze widać na ekranie, a następnie trafia do tego samego pipeline'u co pole tekstowe z karty 01. Gdy STT padnie (brak sieci, limit) — pole tekstowe jest widoczne i podświetlone jako fallback, użytkownik nigdy nie traci możliwości wprowadzenia komendy.

**Blocked by:** 02 (pipeline tekstu istnieje)

**Estimate:** 1 / 2.5

**Owner:** B

**TDD:** seam graniczny STT→pipeline: fixtura audio → oczekiwana transkrypcja; test zachowania przy błędzie API (timeout/limit) — pipeline dostaje sygnał „STT niedostępny", UI pokazuje fallback, brak śmierci aplikacji.

**Demo check:** klik „mów" → powiedz „wzięliśmy paletę kartonów" → transkrypcja pojawia się na ekranie → karta zmiany jak z karty 01; z użyciem słuchawek w flankujących warunkach (muzyka w tle).

**Status:** done — merged do `origin/main` (cb93692) z kartami 03/07/13; backend 119/119, frontend build+lint, zoneItems 4/4; GUI-check po merge: happy path głosowy (Mów → transkrypcja w polu → karta zmiany → confirm → stany), fallback przy braku klucza STT (banner + podświetlone pole, apka żyje), recovery po błędzie (test). Live demo-check z prawdziwym mikrofonem (słuchawki, muzyka w tle) — do potwierdzenia przez ownera; STT_API_KEY w .env włącza Groq whisper-large-v3.

- [x] push-to-talk działa z mikrofonu laptopa (i touch na telefonie)
- [x] transkrypcja widoczna PRZED wysłaniem do agenta (kontrola użytkownika — kryterium kategorii)
- [x] fallback tekstowy zawsze dostępny, wyraźnie w UI
- [x] błąd STT nie zabija sesji; po odzyskaniu sieci działa ponownie
