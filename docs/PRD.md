# PRD — MAGAZYNIER

**One-liner:** Głosowy agent magazynowy, który pamięta stany, miejsca i procedury: powiedz mu na hali, co robisz — on proponuje zmianę w bazie, ty ją zatwierdzasz, a strona pokazuje całą wiedzę o magazynie na mapie.

**Zadanie:** Open Task ARTIFICIAL INTELLIGENCE (HackYeah 2026, deadline **4.10 godz. 11:00**). **Feature freeze: 24:00. Submit: 10:30.**

## Problem
Małe magazyny (2–10 osób) trzymają stany w Excelu, który po tygodniu kłamie: ktoś wziął paletę i nie zapisał. Prawdziwy WMS = koszt, terminal, szkolenie — nikt tego nie wdraża. Efekt: braki odkrywane po fakcie, zamawianie z pamięci, wiedza „jak u nas pakujemy" w głowie jednej osoby.

## Solution & Magic Moment
Web-aplikacja + mikrofon: agent rozumie polskie zdania o pracy na hali, mapuje je na narzędzia (`update_stock`, `check_reorder`, `get_location`, `remember_procedure`…) i **proponuje** zmianę na karcie na ekranie. Człowiek jednym kliknięciem zatwierdza — zapis, wpis w audycie, proaktywny szkic zamówienia przy przekroczeniu progu.

**Magic moment (musi wpaść w pierwsze 60 s):** „Magu, wziąłem paletę kartonów" → ekran pokazuje transkrypcję + kartę „Kartony 54→52, minimum 12 — proponuję zamówić 50 na wtorek, zatwierdzasz?" → „Tak" → szkic zamówienia w kolejce. Mapa/stany aktualizują się na oczach jury.

## Demo script (happy path, ~3 min, 3 beaty)
1. **Wdrożenie (0:00–1:00):** import `demo-magazyn.xlsx` → LLM pokazuje proponowane mapowanie kolumn („Ilość"→ilość, „Stan [szt]"→ilość…) → jedno zatwierdzenie → Stany wypełnione. Spacer po hali: „strefa: kartony" ×3 → strefy pojawiają się na mapie schematycznej.
2. **Praca głosem (1:00–2:15):** push-to-talk „wzięliśmy paletę kartonów" → karta zmiany → „tak" → Historia zapisuje wpis z undo → agent proponuje reorder → szkic zamówienia w Kolejce zatwierdzeń. Potem „ile mamy szkła?" → odpowiedź + podświetlenie strefy na mapie.
3. **Pamięć (2:15–3:00):** „Magu, jak pakujemy szkło?" → procedura + „kartony Y, strefa C2 — pokazać na mapie?". Zamknięcie: slajd architektury + on-prem.
- **Fallback gdy demo żywe padnie:** nagrane wideo sukcesu (rano) + zrzuty ekranu + tryb mock (offline-parser, deterministyczna ścieżka przez 5–6 komend demo).

## User stories (każda = jedna karta taska)
1. Jako magazynier mówię komendę po polsku (push-to-talk lub tekst), widzę transkrypcję + kartę proponowanej zmiany, zatwierdzam jednym kliknięciem → zapis w bazie + wpis w audycie. **[MVP]**
2. Jako właściciel importuję XLSX/CSV; LLM proponuje mapowanie kolumn (nazwa/ilość/minimum/lokalizacja); zatwierdzam mapowanie jednym widokiem → stany w aplikacji. **[MVP]**
3. Po każdej zatwierdzonej zmianie agent sprawdza progi i składa szkic zamówienia do Kolejki zatwierdzeń; nigdy nie wysyła automatycznie. **[MVP]**
4. Jako magazynier podczas spaceru nazywam strefy („strefa: kartony") — strefa pojawia się na schematycznej mapie 2D; klik w strefę = szczegóły (co leży, ile). **[MVP]**
5. Pytam „ile mamy X?" / „gdzie leży X?" / „jak pakujemy X?" — dostaję odpowiedź + podświetlenie lokalizacji na mapie. **[MVP]**
6. Widzę pełną historię zmian (kto/kiedy/co) z jednym undo. **[MVP]**
7. Dodaję procedurę głosem/tekstem („jak pakujemy szkło") i później ją wyszukuję. **[MVP]**
8. Eksportuję wszystko z powrotem do XLSX/CSV. **[MVP]**
9. Gdy STT albo LLM padnie, offline-parser obsługuje 5–6 komend demo deterministycznie. **[MVP]**
10. Ustawienia: prefix agenta, wybór adaptera danych, progi, tryb głosu. **[MVP]**
11. Widok telefonu: prosty panel push-to-talk/transkrypcja/zatwierdź. **[NICE-TO-HAVE]** (demo działa też z mikrofonu laptopa)
12. Ścieżka spaceru rysuje się na mapie (IMU/AR w przeglądarce). **[STRETCH — tylko nocą, jeśli rdzeń stoi]**
13. TTS — agent odpowiada głosem. **[NICE-TO-HAVE]**

## Scope
- **Must (MVP):** historie 1–10. Definicja „działa": tracer bullet głos→narzędzie→baza→audyt na ekranie stoi end-to-end.
- **Nice-to-have:** 11, 13 (+ Ollama on-prem realnie podpięty).
- **Stretch:** 12 (zgodnie z konceptem: pełny AR-scan tylko „jeśli rdzeń stoi nocą").
- **Deliberately NOT building:** per-item kody kreskowe, pełny AR-scan, planowanie kubatury, webhook do ERP (tylko kontrakt+atrapa), multi-user/uprawnienia, dokumenty PZ/WZ, auto-wysyłka zamówień, parsowanie formuł Excela (czytamy tylko kolumny i reguły z wartości).

## Stack & constraints
- **Backend:** Python + FastAPI, SQLite, WebSocket do UI. Pętla agenta = LLM + registry narzędzi (`get_stock`, `update_stock`, `check_reorder`, `draft_order`, `get_location`, `add_zone`, `remember_procedure`, `recall_procedure`), audyt w bazie.
- **Frontend:** React + Vite + Tailwind; mapa = SVG (schematyczny rzut, strefy, ściany). 6 sekcji: Mapa, Stany, Kolejka zatwierdzeń, Historia, Procedury, Ustawienia.
- **LLM:** interfejs `LLMProvider` z trzema implementacjami: (1) chmurowe API z function calling (domyślne), (2) Ollama on-prem (opcja wdrożeniowa — opisana, nie testowana nocą), (3) **MockAgent/offline-parser** — zawsze w repo, to on gra w trybie awaryjnym dema.
- **STT:** API zgodne z Whisper (np. Groq/OpenAI — szybkie, tanie, dobre po polsku); **fallback od pierwszej godziny:** pole tekstowe (ten sam pipeline poniżej STT).
- **Mock data policy:** `demo-magazyn.xlsx` (realistyczny „Excel firmy X" z brzydkimi nagłówkami) w repo; seed SQLite; MockAgent; tekstowy fallback STT. Żadna zależność zewnętrzna nie może być jedyną drogą przez demo.
- **Deploy target od godziny pierwszej:** `docker compose up` na laptopie = demo. Wideo sukcesu nagrane rano jako backup.
- **Ujawnienie AI:** używamy chmurowego LLM + STT — wpis do zgłoszenia (wymóg regulaminu); prywatność: transkrypcja widoczna, confirm-before-write, audyt z undo, zero profilowania osób.

## Testing seams
1. **`InventoryAdapter`** (C): Excel/CSV → mapowanie → obiekty domenowe; testy na `demo-magazyn.xlsx` + wariantach nagłówków.
2. **Mapowanie intencji → narzędzia** (A/B): fixture utterance → oczekiwane wywołanie narzędzia (offline-parser deterministycznie; LLM — walidacja schematu JSON function-call). Ten sam kontrakt testowy dla obu ścieżek.
3. Kontrakt HTTP/WS backend↔frontend: karta zmiany, potwierdzenie, audyt — wspólny fixt dla A i D.

## Why now / Why us
- **Now:** LLM z function calling + STT po polsku są wystarczające, by zdanie zastąpiło formularz; kategoria wprost nagradza kontrolę użytkownika nad AI (zatwierdzenie+audyt to rdzeń designu).
- **My:** automatyka i robotyka — układy współrzędnych, mapy, pętle sterowania; umiemy obronić każdą warstwę i mamy instynkt diagnostyczny (fallbacki nie są przyozdobione, są przemyślane).
