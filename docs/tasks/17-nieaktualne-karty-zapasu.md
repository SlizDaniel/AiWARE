# 17: Nieaktualne karty zmiany zapasu

**Owner:** A — kontynuacja odpowiedzialności z kart 01/08.

**Zakres zaakceptowany przez użytkownika:** inny pracownik/import/undo zmienia
zapas po pokazaniu karty; zatwierdzenie nie może po cichu zapisać innych wartości
przed/po niż przedstawione użytkownikowi. Nowy branch `fix/stale-stock-proposals`.

## Kryteria

- [x] Przed zapisem porównujemy obecne quantity/name/unit z kartą zapisaną na serwerze.
- [x] Porównanie odbywa się po `SELECT ... FOR UPDATE`, w transakcji zapisu i audytu.
- [x] Rozbieżność: HTTP 409 `{detail}`, bez zmiany zapasu, audytu, reorder i wersji danych.
- [x] Nieaktualna karta zostaje unieważniona; ponowne zatwierdzenie daje 404.
- [x] Brak pełnego snapshotu w starej karcie także wymaga nowej komendy.
- [x] Nowa komenda tworzy kartę z aktualnymi wartościami do osobnego zatwierdzenia.
- [x] Zmiana innego towaru, lokalizacji lub minimum nie blokuje tej operacji zapasu.
- [x] Testy HTTP na PGlite i postgres.js: inna karta, import, undo, nazwa/jednostka,
  niepełna karta, nowa karta i brak efektów ubocznych odmowy.
- [x] Pełny zestaw, build, review i GUI-check.

**Status:** implemented and verified — pełny zestaw 645 passed, 2 skipped;
nowa karta 15 passed, 1 skipped (ten skip jest częścią pełnego wyniku).
Build/typecheck/lint passed; Standards i Spec review bez uwag.
GUI na osobnej bazie `data/stale-stock-gui`: karta 13→11, drugi zapis 13→11,
próba starej karty daje widoczny błąd i nie zmienia 11; po odrzuceniu i ponowieniu
nowa karta 11→9 zatwierdza się poprawnie. Bez modyfikacji danych chmurowych.

## Kontrakt z frontendem

Istniejący `POST /api/proposals/{id}/confirm` i payload sukcesu pozostają takie same.
Snapshot nie jest argumentem Gemini i nie pochodzi z treści POST klienta.
Przykładowa odmowa:

```json
{"detail":"Dane towaru zmieniły się od pokazania karty. Nic nie zapisano. Odrzuć tę kartę i wyślij komendę ponownie, aby zatwierdzić aktualny stan."}
```

Obecny CommandPanel pokazuje `detail` przy karcie; użytkownik klika Odrzuć,
ponawia komendę i potwierdza nową kartę. Nie ponawiaj automatycznie confirm,
nie aktualizuj wartości starej karty bez kolejnego potwierdzenia.
Unieważnienie usuwa wyłącznie propozycję; „Nic nie zapisano” dotyczy operacji
magazynowej, nie tego technicznego usunięcia. Błąd 409 nie podbija `/api/version`.

## Ograniczenia

To porównanie aktualnych pól karty, nie pełny licznik wersji rekordu. Jeśli pola
zmieniono i przywrócono przed pierwszą próbą confirm, karta nadal pasuje do stanu.
Bezpośrednie wewnętrzne wywołania narzędzia bez karty pozostają bez snapshotu;
wszystkie potwierdzenia kart `update_stock` przez HTTP wymagają snapshotu.
Undo stosuje kompensację istniejącej operacji, nie ten mechanizm zatwierdzania karty.
Nie dodajemy migracji ani nowego endpointu.

Równoczesne żądania są sprawdzane na PGlite. Most testowy postgres.js → PGlite
ma jeden backend i nie reprezentuje dwóch niezależnych sesji produkcyjnego
Postgresa; ten jeden przypadek jest pomijany dla mostu, a pozostałe przechodzą
na obu adapterach. Rzeczywista współbieżność Supabase wymaga osobnej próby.

Backend aplikacji jest w TypeScript: blokada i zapis muszą pozostać w tej samej
transakcji. Osobny serwis Pythona nie zapewniłby tej spójności bez przebudowy
architektury. Polskie komentarze w implementacji wyjaśniają źródło snapshotu
i miejsce atomowego porównania.
