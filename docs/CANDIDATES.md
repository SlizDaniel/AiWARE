# Kandydaci — HackYeah 2026 (wybór zadania)

Stan: 3.10.2026, 11:25. Start był o 11:00 → **zostało ~23,5h, deadline zgłoszeń jutro 11:00.**
Zespół: 4 osoby, automatyka i robotyka. Cel: vibecoding, efektowne demo, prosty podział pracy.

Decyzję podejmujemy do **~12:30**. Poniżej 3 koncepcje (po najlepszym z każdego zadania) + warianty.

---

## Scoring — bilans pięciu pytań

Skala 1–5. Eliminujemy kandydatów, którzy obalają 2+ kryteria.

| Kryterium | GS: **Interlock** | HubMi: **Splot** | Open-AI: **Warta** |
|---|---|---|---|
| Hair on fire? (ktoś użyje w poniedziałek?) | 5 — realny ból enterprise, GS pisze z własnego doświadczenia | 3 — realna potrzeba instytucji, ale bez pilności u końcowych userów | 4 — małe zakłady tracą czas na ręczne odczyty i awarie |
| Demoable w pozostałym czasie? | 5 — nudny, sprawdzony stack (FastAPI + Ollama + React + pytest) | 4 — standardowy web + RAG, ale 7 modułów = pułapka zakresu | 4 — VLM + kamera + dashboard, tech gotowa |
| Why now? | 5 — agenci i MCP dopiero wchodzą do firm, brak standardu guardraili | 4 — polskie LLM/embeddingi ogarniają język potoczny | 5 — modele wizyjne (VLM) dopiero od ~2025 czytają sceny/Bitmapy niezawodnie |
| Why us? | 4 — "warstwa sterowania" = język automatyków; loop sense→decide→act | 2 — produkt/UX, słaby związek z automatyką | 5 — to jest LITERALLY wasza dziedzina; Q&A jury na Waszym terenie |
| Differentiation (1 zdanie: czemu nie istnieje i czemu my?) | 4 — komercyjne istnieją (Lakera itp.), ale my: open-source, self-hosted, config-driven + demo z MCP | 3 — portale NGO istnieją; różnicowanie przez jakość matchmakingu | 5 — 60% zespołów zrobi chatbota; my patrzymy kamerą na świat fizyczny |
| **Suma** | **23/25** | **16/25** | **23/25** |

**Rekomendacja: Interlock (GS) lub Warta (Open-AI). HubMi odpada** (najsłabszy "why us", pułapka zakresu, przeniesienie praw autorskich na PROIDEA, pitch po polsku dla instytucji — a jury liczy moduły, więc to grind CRUD-a, nie robotyka).

---

## Koncepcja 1: „INTERLOCK" — Goldman Sachs, AI Control Layer (15 000 zł: 6/5/4)

**One-liner dla jury:** *„W każdej fabryce maszyny mają wyłączniki bezpieczeństwa (interlocki), które zatrzymują ją, zanim zrobi szkodę. Zbudowaliśmy interlock dla agentów AI."*

**Co budujemy:** Gateway/proxy (OpenAI-compatible + przechwytywanie wywołań narzędzi MCP), który inspektuje ruch agent↔LLM↔narzędzia. Silnik polityk z jednego pliku YAML (hot-reload!), kontrole deterministyczne (PII, sekrety, sygnatury ataków, budżety tokenowe) + semantyczne (lokalny model klasyfikuje prompt injection). Dashboard na żywo + eksport audytu. Test suite, który jury odpala samodzielnie.

**Magic moment (demo):** podział ekranu „atak vs obrona" — nasz czerwony agent próbuje wykraść (fałszywe) sekrety z atrapy serwera narzędzi; Interlock redaguje dane podmieniając je na atrapy (faker), throttles budżet, na żywo widać kill-chain na dashboardzie. Potem **sędzia sam** wpisuje swój ad-hoc prompt → blocked; przestawia w YAML próg `strictness: 0.6 → 0.9` bez restartu → powtarza prompt → inna reakcja.

**Kryteria GS → co robi w tym koncept:**
- Robustness guardraili 30% → warstwy: deterministic zawsze działa (fallback: semantic wyłączalny flagą — nigdy nie ma twardego downu)
- Architektura 20% → czysty pipeline: `inspect → policy → act (allow/redact/block/throttle) → audit`; telemetria latency
- Security reporting 20% → dashboard live + JSONL/CSV audit export dla security teamu
- Test suite 15–20% → pytest ~40 przypadków positive/negative, `make test`, jury odpala sam
- Implementability 10–15% → 3 linijki integracji (`docker compose up`), diagram architektury

**Why us:** pętla sterowania: *sens → decide → actuate → feedback*. Automatycy myślą takim językiem — i jury to zapamięta. Lokalne modele na własnym GPU to Wasz dom.

**Ryzyka i fallbacki:**
1. Ollama cold-start/OOM na demo → model załadowany i warm od 10:00; semantic filter ma flagę off (system działa bez niego).
2. Przechwycenie MCP strumieniowania w 24h → najpierw HTTP chat-completions (pewniak), MCP tool-calls jako druga warstwa (jeśli zejdzie — bonus, nie fundament).
3. Jury zadaje pytania o kod → co godzinę 10-min "explain-back": każda osoba tłumaczy swoją torbę pozostałym.
4. Fallback totalny: nagrany wideo run + test suite offline.

**Podział pracy (4 torby, słabe sprzężenia):**
- A: Gateway + integracja MCP + telemetria
- B: Policy engine (YAML, hot-reload) + kontrole det./semant. + budżety
- C: Dashboard + raporty/audit + podgląd live
- D: Test suite + czerwony agent do demo + prezentacja 10 slajdów + próba PyT

**Deliberately NOT building:** własny framework agentowy, mainnet czegokolwiek, auth użytkowników UI, obsługa wielu chmur, text-to-SQL "AI analityk".

---

## Koncepcja 2: „WARTA" — Open Task AI (8 000 zł, pojedyncza nagroda)

**One-liner:** *„AI, które czyta maszyny: celuj telefonem w panel/urządzenie, a Warta odczytuje wskaźniki, wykrywa anomalie i prowadzi dziennik maszynisty."*

**Co budujemy:** web/app: kamera → VLM (lokalny Qwen-VL przez Ollama LUB API — tu wolność) → odczyty (ciśnienia, temperatury, kontrolki, pozycje przełączników, lampy) → porównanie z limitem → alarm + log + raport zmianowy generowany przez LLM. Docelowi userzy: małe zakłady, warsztaty, laboratoria, rolnicy — tam gdzie SCADA jest za droga.

**Magic moment:** sędzia (lub Wy) celuje telefonem w fizyczny panel przyniesiony na miejsce (drukowana atrapa z pokrętłami i LED-ami albo sprzęt z laboratorium) → na ekranie live rośnie tabela odczytów → ktoś przekręca pokrętło w czerwoną strefę → **alarm po sekundzie**, z opisem i rekomendacją akcji po polsku.

**Kryteria Open-AI:** Idea & Innovation 30% → nie-chatbot, patrzymy na świat fizyczny (unikalne wśród konkurencji); Relation 20% → AI odgrywa kluczową rolę (VLM); Usability 20% → telefon + 1 ekran; Design 20% → czysty dashboard z historią i trendami; Completeness 10% → pełny loop: odczyt→alert→log→raport.

**Why us:** to jest Wasza dziedzina — kontrola procesów, utrzymanie ruchu, czujniki. Będziecie umieć odpowiedzieć na każde pytanie jury o fizykę i sens pomiaru (regulamin: zespół musi umieć obronić każdy element). Żadna drużyna informatyczna nie ma tej perspektywy.

**Ryzyka i fallbacki:**
1. Oświetlenie/kamera na sali → nagrane klipy + zestaw zdjęć offline; VLM też działa na uploadzie zdjęcia.
2. VLM halucynuje odczyty → pokażcie zamiast tego skalę pewności + "human-in-the-loop" (potwierdzenie odczytu przyciskiem) — to jest feature, nie bug (kategoria AI wymaga pokazania weryfikowalności!).
3. Kategoria otwarta = tłok → wygrywa jakość demo; live-camera to Wasz atut sceniczny.
4. Fallback: pre-recorded demo + statyczne zdjęcia panelu.

**Podział pracy:**
- A: pipeline wizji (kamera/upload → VLM → parser odczytów)
- B: logika progów/alarmów + baza odczytów + raport zmianowy (LLM)
- C: UI/dashboard (live feed, historia, trend, konfiguracja limitów)
- D: dane testowe (panele, zdjęcia, filmy), demo choreography, prezentacja

**Deliberately NOT building:** predykcja awarii ML z danych drgań (za mało czasu), integracje PLC na żywo, aplikacja natywna mobilna (web + kamera wystarczy).

---

## Koncepcja 3: „SPLOT" — HubMi.pl (15 000 zł: 6/5/4) — NIE rekomendowany

**One-liner:** *„Mapa Wyzwań Społecznych jako serce nawigacji: opisz problem, a piny na mapie Małopolski rozświetlą się dopasowanymi innowacjami, podobnymi przypadkami i instytucjami, które to już rozwiązały."*

**Dlaczego był fajny:** punktacja wprost płaci za liczbę modułów (obowiązkowy matchmaking 10% + każdy kolejny 5%, max 7 modułów = 40%), map-spine jest ładniejszy niż portal z zakładkami, i rozdziela się na 4 osoby.

**Dlaczego odpada dla Was:** (1) "why us" 2/5 — to produkt/UX/CRUD, nie automatyka; (2) pułapka zakresu: 7 modułów w 23h = średnio 3h na moduł ze wszystkimi edge case'ami; (3) WCAG 2.1 AA liczy się w kryteriach 20% — pełna zgodność to grind; (4) **przeniesienie autorskich praw majątkowych na PROIDEA przy wygranej**; (5) pitch po polsku przed instytucją — inna liga prezentacyjna niż demo techniczne.

**Gdyby mimo wszystko:** matchmaking (RAG po Bibliotece Innowacji + dostarczonych danych) + map-spine UI + fiszki z asystentem AI + panel admina; deweloper frontu z wyczuciem designu prowadzi; reszta klepie moduły.

---

## Wariant 2b: „STETOSKOP" — Open Task AI, wersja audio (rozwinięcie Warty)

**One-liner:** *„Telefon jako stetoskop przemysłowy: nagraj 2 minuty zdrowej maszyny, a AI pilnuje odchyleń i mówi ludzkim głosem, co może się psuta."* (nazwa robocza: Stetoskop)

**Zmiana vs Warta:** zero kamer i zero montowania czujników — mikrofon telefonu. Zadanie ML to **detekcja anomalii one-class** (baseline zdrowej maszyny), nie klasyfikacja usterek → **wielki dataset niepotrzebny**:
1. Enrolment: nagrywamy zdrową maszynę sami (własny silnik/wentylator z laboratorium) — baseline per-maszyna, działa na KAŻDEJ maszynie.
2. Wiarygodność: publiczne datasety **MIMII + ToyADMOS** (DCASE Task 2: pompa, wentylator, zawór, slider — normalne i anormalne) do pokazania na innych maszynach.
3. Interpretacja: warstwa fizyczna — mapa pasm: 1× RPM = niewyważenie, 2× = nieosiowość/luź, łożysko = BPFO/BPFI, przekładnia = zęby×RPM; LLM tłumaczy wynik po polsku + raport.

**Pipeline:** nagranie → log-mel spektrogram → embedding (pretrained PANNs/VGGish) → dystans do baseline (kNN/Mahalanobis albo prosty AE) → próg → warstwa interpretacji → alert + raport zmianowy.

**Magic moment:** na stoisku nagrywamy baseline wentylatora (2 min). Sędzia przykłada kartkę do łopatek / dokręca śrubę / zmienia obciążenie → **alarm po sekundach** z wykrytym pasmem i hipotezą przyczyny. Plus odtworzone pary normalny/anormalny z MIMII.

**Dlaczego my:** diagnostyka drganiowo-akustyczna to jest literalnie program Waszych studiów (FFT, analiza obwiedni, częstotliwości defektowe łożysk). Q&A jury = home turf; konkurowanie z informatykami na ich polu odpada.

**Uczciwie o konkurencji:** diagnostyka akustyczna istnieje komercyjnie (Augury, SKF, Brüel & Kjær) — za enterprise pieniądze i z instalacją czujników. Nasz kąt: telefon, zero instalacji, baseline w 5 minut, małe warsztaty. To wystarcza na hackathon, pod warunkiem że demo żyje.

**Samochód jako use-case:** odpada jako core — nie ma publicznego zbioru oznaczonych usterek silników aut, a OBD/iTrust to inna liga. Zostaje jako slajd „działa na dowolnej maszynie, też aucie (porównanie z własnym baseline'em)".

**Ryzyka:** hałas sali (baseline nagrywany NA MIEJSCU w tym samym otoczeniu — to jest feature: enrolment w środowisku); fałszywe alarmy (progi + pasma pewności); detektor nie złapie subtelnej usterki na żywo (fallback: MIMII audio + nagrania zrobione wcześniej tego samego dnia).

**Podział pracy:** A audio pipeline (nagrywanie/web audio, mel, embeddingi); B detektor (enrolment, dystans, progi, historię); C interpretacja fizyczna + LLM raporty; D UI/dashboard + materiały demo + prezentacja.

**Zadanie:** Open Task ARTIFICIAL INTELLIGENCE (8k, pojedyncza nagroda).

---

## Wariant 2c: „MAPOWNIK" — Open Task AI, skan pomieszczenia → prosty WMS (pomysł zespołu, rozwinięty)

**One-liner:** *„Telefon zamiast wdrożenia WMS: przeskanuj magazyn telefonem, mapa 2D rysuje się sama, a podczas skanu jednym tapnięciem zaznaczasz, co gdzie leży. Jutro apka poprowadzi cię AR-strzałką do szukanej rzeczy."*

**Rdzeń techniczny (nic od zera):**
- SLAM od telefonu: ARCore (Android, domyślnie) / ARKit + RoomPlan (iPhone z LiDAR) — poza kamery 6 DOF + wykryte płaszczyzny (podłoga/ściany) jako poligony.
- Mapa 2D = rzut poligonów ścian na płaszczyznę podłogi, rysowany live podczas spaceru. Zapis JSON.
- **Relokacja przez znacznik ArUco** (ARCore Augmented Images): mapa i wszystkie piny przechowywane w układzie znacznika (`T_marker→mapa`) na ścianie; kolejne wejście = wykryj znacznik → masz mapę. 100% offline, oba systemy, narracja „lokalizacja jak AGV po znaczniku".
- Produkty: skan kodów kreskowych (ML Kit) → SQLite; piny = pozycje względem znacznika.
- Garnitur AI: hands-free głos przy skanowaniu (ręce zajęte): „znacznik: elektronika, pięć sztuk"; opcjonalnie VLM auto-rozpieranie ze zdjęcia półki (checkboxy do zatwierdzenia).

**Magic moment:** dzień 2 (czyli 10 minut później na demo): wykrycie znacznika → mapa wraca → „znajdź wkrętarkę" → AR strzałka prowadzi do pudełka.

**Stack:** Kotlin + ARCore native + Jetpack Compose + ML Kit + SQLite. BEZ pluginów Flutter/RN do AR.

**Wymagany sprzęt:** Android wspierany przez ARCore (sprawdzić dziś listę developers.google.com/ar/devices) albo iPhone Pro. Brak → plan B: RTAB-Map app skanuje i eksportuje raster 2D → nasza web-apka na nim pinuje produkty; plan C: tryb śledzenia po zdjęciu.

**Rekwizyt:** 2-3 kartony + regałka = mini-magazyn do zeskanowania na stoisku (Arena jest za duża do skanu).

**Deliberately NOT building:** multi-user, sync, dokumenty magazynowe (PZ/WZ), stany rezerwacyjne — jeden pokój, kilkanaście pozycji, jeden telefon.

**Uczciwie:** istnieją Sortly/BoxHero (inwentaryzacja) i Polycam (skan) — nikt nie łączy skan→mapa→oznacz→znajdź-AR w jednym tanim przepływie.

**Zadanie:** Open Task ARTIFICIAL INTELLIGENCE (8k). AI widoczne: SLAM AR + głos + (opc.) VLM.

**Spike 60 min:** hello_ar (Google sample) na własnym telefonie: stabilność płaszczyzn i pozy, powrót po 10 m spaceru. Działa → rdzeń dowiedziony.

---

## Wariant 2d: „MAGAZYNIER" — Mapownik + agent instytucjonalny (pomysł zespołu, obecna główna linia)

**One-liner:** *„Agent z głosem, który zna wasz magazyn: mówi się do niego na hali, on pamięta stany, miejsca i procedury — a mapa z telefonu to jego oczy."* (nazwa robocza Magazynier; nazwa wywoławcza krótka, np. „Magu")

**Architektura: jeden LLM + narzędzia (function calling), trzy pamięci:**
1. **Stan (ground truth):** SQLite w apce = jedyne źródło prawdy. Excel/Sheets = import day-one (wizard „przenieś waszego Excela") + eksport/sync, NIE źródło prawdy. Narzędzia: `get_stock`, `update_stock(delta)`, `check_reorder`, `draft_order(item, qty)` (proponuje, człowiek zatwierdza — nie auto-wysyłka).
2. **Przestrzeń:** mapa/piny z Mapownika (ARCore + ArUco, patrz 2c). Narzędzia: `get_location(item)`, `navigate(item)` → AR strzałka.
3. **Procedury:** wypowiedziane praktyki zapisywane jako rekordy (kto/kiedy/tekst + embedding): „od dziś pakujemy lampy w kartony Y" → później „Magu, jak pakujemy szkło?" → procedura + **link do miejsca** („kartony Y, regał C2 — prowadzę?"). Fuzja pamięci proceduralnej ze spatial to synergie, której nie ma żaden chatbot.

**Kryterium Open AI wprost premiuje kontrolę:** task każe pokazać „how users can verify its outputs and remain in control" → transkrypcja na ekranie (co agent usłyszał), confirm-before-write przy zmianach stanu, dziennik działań agenta z undo. To jest odpowiedź na rubrykę, nie dodatek.

**Magic moment (3 beaty):** (1) skan + tagowanie (mapa rysuje się sama); (2) „Magu, wziąłem dwie palety kartonów" → „Kartony 54→52. Minimum to 12 — proponuję 50 na wtorek. Zatwierdzasz?" → szkic zamówienia; (3) „Magu, jak pakujemy szkło?" → procedura + lokalizacja + AR strzałka.

**Głos — plan niezawodności:** push-to-talk + słuchawki, transkrypcja widoczna, fallback pisemny (chat box), awaryjnie offline-parser 5-6 komend demo. Demo nigdy nie zależy od STT.

**Podział pracy:** A: AR skan/mapa/ArUco (część ryzykowna, wieczorem); B: rdzeń agenta (LLM+tools, STT/TTS, fallbacki); C: inwentarz + Excel import/export + reorder + dziennik/undo; D: UI (mapa, stany, czat agenta, zatwierdzenia) + demo + prezentacja. Tracer bullet: agent aktualizuje stan głosem z dziennikiem — do wieczora, AR w nocy.

**Cut:** VLM rozpoznawanie półek (agent przejmuje tę rolę), auto-wysyłka zamówień, multi-user, dokumenty PZ/WZ.

**Zadanie:** Open Task ARTIFICIAL INTELLIGENCE (8k). AI jest produktem: LLM agent + narzędzia na stanie fizycznym + pamięć proceduralna + AR.

**Spike 60 min (oba równolegle):** hello_ar na telefonie (stabilność pozy/płaszczyzn) + pętla agenta: głos→intent→update stanu→dziennik. Oba działają → bierzemy.

---

### Decyzje projektowe po ocenie planu (3.10, ok. 12:00)

1. **Integracja = adapter:** interfejs `InventoryAdapter` (SQLite / Google Sheets / CSV-watch); day-one wizard importu z Excela; webhook do ERP tylko opisany + atrapa w prezentacji. Pozycjonowanie: szybka pas OBOK obecnego systemu, nie zamiennik.
2. **Prywatność = „notatnik, nie nadzorca":** agent zapisuje co mu mówią, nie co obserwuje. Mikrofon tylko po wywołaniu (push-to-talk/wake-word), transkrypcja na ekranie, confirm-before-write (autorem wpisu jest pracownik), undo, bez metryk wydajności i przypisywania do osób, audio→tekst→usunięcie. To wprost odpowiada na kryterium „verify outputs and remain in control".
3. **Zakres = 3 domeny narzędzi** (test: „bez tego agent to tylko notatnik"): stany+reorder; położenie itemów; procedury („jak pakujemy X"). Planowanie pakowania = roadmapa, nie feature.
4. **Mapa:** rdzeń = agent + tabela lokacji + schematyczny widok 2D (gwarantowane demo). AR-scan (ARCore+ArUco) = warstwa upgrade nocą; bez niej demo nadal żyje (strzałka na schemacie 2D).
5. **Brakujące elementy planu do uzupełnienia:** 3 beaty dema (import Excela → głos+reorder+zatwierdzenie → procedura+lokalizacja), definicja użytkownika (właściciel małego magazynu 2–10 os., stany w Excelu), plan awaryjny głosu (push-to-talk, fallback pisemny, offline-parser komend demo).

---

## Zadania wstępne po wyborze (niezależnie od konceptu)

1. 12:30 — decyzja ✔ → 13:00 szkic architektury na jednym arkuszu (wszyscy)
2. 13:00 — setup repo + szkielety 4 toreb (każdy u siebie, `docker compose up` działa na start)
3. 18:00 — pierwszy "tracer bullet" end-to-end działa (najprostsza ścieżka przez cały system)
4. 22:00 — feature freeze draft demo; 23:00 — nagranie wideo fallback
5. Rano 7:00 — próba generalna; 9:30 — prezentacja PDF (10 slajdów); 10:30 — submit (deadline 11:00)
