# 01: TRACER BULLET — tekst → karta zmiany → confirm → baza + audyt na ekranie

**What to build:** Najcieńsza pionowa ścieżka przez cały system, działająca na ekranie: użytkownik wpisuje w polu tekstowym „wzięliśmy paletę kartonów", backend rozumie intencję, zamiast pisać od razu pokazuje **kartę zmiany** („Kartony 54→52"), użytkownik klika **Zatwierdź** → stan w bazie się zmienia, lista Stanów pokazuje 52, sekcja Historia pokazuje nowy wpis. Repozytorium startuje z `git init`, docker compose podnosi backend+frontend jedną komendą, szkielet 6 sekcji UI istnieje (z 4 pustymi).

**Blocked by:** None — can start now. **Termin twardy: 16:00.**

**Estimate:** 1.5 / 3 (para A+D)

**Owner:** A+D (para; B i C pracują równolegle nad przygotowaniem: B — lista 6 komend demo i oczekiwanych wywołań narzędzi jako fixtury do karty 02; C — plik `demo-magazyn.xlsx` i schemat bazy do karty 05)

**TDD:** kontrakt intencja→narzędzie: fixtura „wzięliśmy paletę kartonów" → wywołanie `update_stock(kartony, -2)` (parser offline na start, LLM podpięty później pod ten sam kontrakt). Test pisany pierwszy.

**Demo check:** `docker compose up` → otwarta strona → wpisz komendę w panelu → karta zmiany widoczna → Zatwierdź → Stany pokazuje nową wartość → Historia pokazuje wpis.

**Status:** ready

- [ ] `docker compose up` podnosi całość jedną komendą z czystego clone
- [ ] pole tekstowe w UI wysyła komendę do backendu
- [ ] backend zwraca kartę zmiany (co usłyszał + co planuje: stan przed→po)
- [ ] klik Zatwierdź zapisuje zmianę w SQLite i nic nie zapisuje się przed zatwierdzeniem
- [ ] sekcja Stany odświeża się po zatwierdzeniu
- [ ] sekcja Historia pokazuje wpis (co/kiedy) — undo w karcie 06
- [ ] szkielet 6 sekcji nawigacji istnieje (Mapa, Stany, Kolejka, Historia, Procedury, Ustawienia)
