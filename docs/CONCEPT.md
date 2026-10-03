# Concept — MAGAZYNIER (nazwa robocza)

**One-liner:** *„Głosowy agent magazynowy, który pamięta stany, miejsca i procedury: powiedz mu na hali, co robisz — on zaproponuje zmianę w bazie, ty ją zatwierdzasz, a strona pokazuje całą wiedzę o magazynie na mapie."*

**Zadanie:** Open Task ARTIFICIAL INTELLIGENCE (8 000 PLN, deadline 4.10 godz. 11:00, HackTribe).

---

## Problem
Małe firmy (warsztaty, magazyny 2–10 osób) trzymają stany w Excelu, który po tygodniu kłamie: ktoś wziął paletę i nie zapisał. Wdrożenie prawdziwego WMS to koszt, terminal i szkolenie — nikt tego nie robi. Efekt: braki discovery po fakcie, zamawianie z pamięci, wiedza „jak u nas pakujemy" w głowach jednej osoby.

## Magic moment
„Magu, wziąłem paletę kartonów" → agent na ekranie pokazuje, co usłyszał, i mówi: „Kartony 54→52. Minimum to 12 — proponuję 50 na wtorek, zatwierdzasz?" → „Tak" → szkic zamówienia pojawia się na stronie. Drugi beat: „Magu, jak pakujemy szkło?" → procedura + „kartony Y, strefa C2 — pokazać na mapie?".

## Demo w jednym zdaniu
„Właściciel magazynu importuje swój Excel, przechodzi z telefonem po magazynie nazywając strefy, a potem zarządza stanami głosem z zatwierdzeniem na ekranie."

## Why now
LLM z function calling + STT po polsku działają wystarczająco dobrze, żeby zamiast formularza wystarczyło zdanie w przestrzeń. Kategoria Open AI wprost wymaga pokazania kontroli użytkownika nad AI — zatwierdzanie i audyt to rdzeń designu, nie dodatek.

## Why us
Automatyka i robotyka: pętle sterowania, układy współrzędnych, mapy, czujniki. Umiemy obronić każdą warstwę (SLAM/ścieżki, mapowanie intencji, adaptery danych) i mamy instynkt diagnostyczny.

## Dopasowanie do kryteriów (Open AI)
- Idea & Innovation 30% — agent operujący na stanie świata fizycznego + pamięć proceduralna + lokalizacje; nie chatbot.
- Relation to Category 20% — AI jest produktem: rozumienie mowy, mapowanie intencji, proponowanie działań, uczenie się procedur.
- Usability 20% — hands-free na hali, zatwierdzenie jednym kliknięciem, audyt z undo.
- Design 20% — spójny dashboard: mapa, stany, historia, procedury.
- Completeness 10% — pełna pętla działa live: głos → narzędzie → baza → strona.

## Zakres produktu v1

**Wdrożenie (onboarding):**
1. Odpalenie jako kontener/apka na lokalnym serwerze firmy (docker compose up) — dane nie wychodzą z firmy.
2. Skan magazynu: spacer z telefonem, ścieżka rysuje się na mapie; na bieżąco nazywacie strefy głosem („strefa: produkty firmy X") — agent zapisuje lokalizacje kategoriami i pokazuje na mapie. Per-item (kody kreskowe) = stretch.
3. Import istniejącego setupu z Excela (niżej).

**Workflow głosowy:**
- „\<prefix\> wzięliśmy paletę kartonów X" → na ekranie: transkrypcja (co usłyszał) + karta zmiany (co planuje: 54→52) + opcjonalna propozycja głosowa → **confirm-before-write** (jedno kliknięcie / „tak") → zapis + wpis w dzienniku z undo.
- Proaktywność: po każdej zmianie sprawdza progi („minimum 12 — proponuję 50") → szkic zamówienia do zatwierdzenia. Nigdy auto-wysyłka.
- Zapytania: stany, gdzie leży, jak się pakuje (procedury).

**Import setupów z Excela (ważne ograniczenie zakresu):**
- Parsujemy **kolumny strukturalne**: nazwa / ilość / minimum / lokalizacja — z reguł reorder typu „jeżeli X < Y to Z" czytamy progi z kolumn (min, ilość_koszykowa), a NIE formuły Excela (to roadmapa).
- **LLM-asystowane mapowanie kolumn:** agent proponuje, która kolumna jest która (firma X ma „Ilość", firma Y „Stan [szt]"), człowiek zatwierdza mapowanie jednym widokiem. To jest feature AI w samym onboardingzie — nikt się nie zniechęca przy starcie.
- Eksport: XLSX/CSV do pobrania zawsze („wasiat Excela zostaje").
- Adapter `InventoryAdapter`: SQLite (własna baza) / Google Sheets / CSV-watch — interfejs wspólny; webhook do ERP = kontrakt opisany + atrapa w prezentacji.

**Strona (web):** finalna lista sekcji:
1. **Mapa/Rozmieszczenie** — schematyczny rzut + strefy + ścieżki; klik = szczegóły.
2. **Stany** — lista poziomów z progami, wizualne strefy (ok/ostatnia szansa/poniżej minimum).
3. **Kolejka zatwierdzeń** — zmiany i szkice zamówień czekające na decyzję.
4. **Historia zmian (audyt)** — kto/kiedy/co (atrybucja opcjonalna), z undo.
5. **Pamięć/Procedury** — „jak pakujemy X", wyszukiwarka, dodawanie głosem.
6. **Ustawienia** — prefix agenta, adapter danych (Excel/Sheets), progi, tryb głosu.

## Architektura (komponenty)
- **Backend (Python FastAPI):** pętla agenta = LLM + registry narzędzi (`get_stock`, `update_stock`, `check_reorder`, `draft_order`, `get_location`, `add_zone`, `remember_procedure`, `recall_procedure`), WebSocket do UI, audyt.
- **LLMProvider (interfejs):** domyślnie API chmurowe (najszybsze/najpewniejsze function calling); tryb on-prem (Ollama) jako opisana opcja wdrożeniowa — spójna z historią „dane nie wychodzą z firmy". Ujawnić użycie w zgłoszeniu (wymóg regulaminu).
- **Głos:** push-to-talk na telefonie/webie + transkrypcja na ekranie; TTS opcjonalnie (ekran-first); fallback: pole tekstowe + offline-parser 5–6 komend demo.
- **Frontend (React/Next lub podobny):** 6 sekcji wyżej; widok telefonu = prosty panel „zdjęcie/push-to-talk/transkrypcja/zatwierdź".
- **Mapa v1 (gwarantowana):** schematyczny 2D (ściany/strefy) + tagowanie stref głosem/tapem; **stretch:** live śledzenie ścieżki z IMU/AR w przeglądarce; pełny AR-scan pomieszczenia — tylko jeśli rdzeń stoi nocą.
- **Deployment:** docker compose, jeden plik konfiguracyjny (adapter, progi, prefix).

## Prywatność i kontrola („notatnik, nie nadzorca")
Mikrofon tylko po wywołaniu; transkrypcja zawsze widoczna; człowiek jest autorem wpisu (zatwierdza); dziennik z undo; zero metryk wydajności i przypisywania do osób; audio→tekst→usunięcie; on-prem jako opcja. W prezentacji osobny slajd — odpowiada wprost na kryterium kontroli użytkownika.

## Scenariusz dema (3 beaty, ~3 min)
1. **Wdrożenie:** import „Excela firmy" (przygotowany plik) → LLM proponuje mapowanie kolumn → zatwierdzone; spacer: „strefa: kartony" ×3 → mapa rośnie na oczach jury.
2. **Praca głosem:** „wzięliśmy paletę kartonów" → karta zmiany → zatwierdzenie → reorder → szkic zamówienia.
3. **Pamięć:** „jak pakujemy szkło?" → procedura + lokalizacja na mapie. Zamknięcie: slajd z architekturą + on-prem.

## Ryzyka i fallbacki
1. STT w hałasie sali → słuchawki, push-to-talk, fallback pisemny, offline-parser na komendy demo.
2. Pad internetu/API LLM → offline-parser komend demo (deterministyczna ścieżka przez demo), cache odpowiedzi.
3. Ścieżka/mapa w przeglądarce flakuje → schematyczne strefy tap/głos (gwarantowane), ścieżka = stretch.
4. Scope creep → feature freeze o 24:00; nowe pomysły tylko do backlogu prezentacji.
5. Fallback totalny: nagrane wideo sukcesu rano + zrzuty ekranu + statyczny import Excela.

## Plan budowy (4 osoby, start ~12:30, deadline 11:00)
- **A — Backend/agent:** pętla LLM+tools, audyt, offline-parser fallbacków.
- **B — Głos + intencje:** STT/TTS, push-to-talk, transkrypcja, mapowanie komend→narzędzia.
- **C — Dane:** SQLite, `InventoryAdapter`, import/export Excel + mapowanie kolumn LLM, progi/reorder.
- **D — Frontend:** 6 sekcji, mapa schematyczna, widok telefonu, design system.
- **Milestones:** 16:00 tracer bullet (głos→narzędzie→baza→audyt na ekranie); 19:00 mapa+strefy+stany; 22:00 import Excela+reorder; 24:00 **feature freeze**; w nocy: procedury+poler+slajdy; 07:00 próba generalna; 09:00 prezentacja PDF (10 slajdów); 10:30 submit (deadline 11:00).

## Checklist zgłoszenia (HackTribe, do 11:00 4.10)
- [ ] tytuł projektu, nazwa zespołu, członkowie
- [ ] opis projektu
- [ ] prezentacja PDF max 10 slajdów (PL/EN)
- [ ] repozytorium + README (jak odpalić: docker compose up, plik konfiguracyjny)
- [ ] **ujawnienie użycia AI/modeli/API** (wymóg regulaminu) — spisać narzędzia
- [ ] link do demo (jeśli hostujemy) / nagranie jako backup
- [ ] zgłoszenie PRZED 11:00 — bufor 30 min

## Deliberately NOT building (v1)
Per-item kody kreskowe (stretch), pełny AR-scan pomieszczenia (stretch nocny), planowanie pakowania/kubatury (roadmapa), webhook do ERP (tylko kontrakt), multi-user i uprawnienia, dokumenty PZ/WZ, auto-wysyłka zamówień, parsing formuł Excela.
