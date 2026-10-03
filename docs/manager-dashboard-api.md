# Dashboard kierownika — kontrakt backendu v1

Branch: `feature/manager-dashboard`. Backend jest gotowy do podłączenia nowej
sekcji UI; nawigacja i komponent dashboardu pozostają zadaniem frontendu.
Typy odpowiedzi: `src/lib/dashboard.ts` (bez zależności od serwera).

## Dostęp i odświeżanie

- Oba endpointy wymagają zalogowanego **kierownika**, sprawdzanego przez istniejące
  `session('kierownik')`. Brak sesji: 401; pracownik: 403; błędna konfiguracja auth: 503.
- Lokalnie z wyłączonym auth obowiązuje istniejące konto lokalnego kierownika.
- Endpointy tylko odczytują dane magazynu. Nie uruchamiają Gemini ani STT.
- Odpowiedzi mają `Cache-Control: private, no-store`.
- Frontend może korzystać z obecnego pollingu `/api/version`: po zmianie wersji
  ponownie pobrać podsumowanie i aktualną stronę dziennika.
- Zmiana okresu lub filtrów dziennika powinna przywracać `page=1`.

## 1. GET /api/dashboard

Wspólne parametry okresu dla obu endpointów:

| Parametr | Znaczenie |
|---|---|
| `period=today` | Dzisiaj w strefie `APP_TIMEZONE`, domyślnie Europe/Warsaw. |
| `period=7d` | Dzisiaj i sześć poprzednich dni; domyślny okres. |
| `period=30d` | Dzisiaj i 29 poprzednich dni. |
| `from=2026-10-01&to=2026-10-03` | Własny zakres, obie daty włącznie, maksymalnie 366 dni. |

Nie łącz `period` z `from/to`. Daty są dniami kalendarzowymi, nie przesuwającym
się oknem 24 godzin. Nieprawidłowy zakres zwraca 422 z `{ "detail": "..." }`.
Każdy endpoint zwraca wyliczone `range: {from, to, timezone}`.

### Odpowiedź

```json
{
  "generated_at": "2026-10-03T12:00:00.000Z",
  "data_version": 8,
  "range": {"from":"2026-10-03","to":"2026-10-03","timezone":"Europe/Warsaw"},
  "current": {"total_items":3,"below_minimum":1,"pending_drafts":1,"missing_location":0},
  "period": {"audit_events":3,"stock_changes":1,"withdrawals":1,"receipts":0,"undo_count":0,"import_events":1},
  "daily": [{"date":"2026-10-03","withdrawals":1,"receipts":0,"undo_count":0}],
  "most_changed_items": [{"item_id":1,"item_name":"Kartony","stock_changes":1,"withdrawals":1,"receipts":0}],
  "attention": {
    "below_minimum": [{"item_id":1,"item_name":"Kartony","quantity":11,"minimum":12,"unit":"szt","pending_draft_id":1}],
    "pending_drafts": [{"id":1,"item_id":1,"item_name":"Kartony","quantity":50,"unit":"szt","deliver_on":"2026-10-06","created_at":"2026-10-03T11:00:00.000Z","waiting_hours":1}],
    "missing_location": []
  }
}
```

### Definicje statystyk — ważne dla etykiet UI

- `current` i `attention` pokazują **stan teraz**, niezależnie od wybranego okresu.
  Nie są rekonstrukcją stanu magazynu na koniec historycznego dnia.
- `stock_changes`: niezerowe zmiany typu `stock_change`, które nie są undo i nie
  zostały cofnięte. `withdrawals` / `receipts` to **liczby operacji**, nie sumy ilości.
  Nie sumujemy sztuk, rolek ani różnych towarów.
- `undo_count`: liczba wpisów korygujących (`undo_of != null`). Oryginał i korekta
  pozostają w dzienniku. Cofnięty później oryginał przestaje być liczony także
  w raporcie wcześniejszego okresu — statystyki odzwierciedlają aktualny stan audytu.
- `audit_events`: wszystkie wpisy audytu, także import, automatyczny reorder i undo.
  Nie podpisuj tej liczby jako „liczba komend pracowników”.
- `import_events`: wpisy audytu importowanych pozycji, **nie liczba wgranych plików**.
  Jeden import czterech pozycji może utworzyć cztery takie wpisy.
- `daily` zawiera każdy dzień zakresu, również dni z zerami. Sumy dzienne są zgodne
  z liczbami operacji w `period`. `most_changed_items` pokazuje maksymalnie 10 pozycji.
- Listy `attention` zawierają po maksymalnie 10 rekordów; pełne liczniki są w `current`.
  Braki z ilością <= 0 są pierwsze; szkice są od najstarszych. `waiting_hours`
  oznacza godziny od utworzenia, minimum 0. Dalsze rekordy są w istniejących
  sekcjach Stany i Kolejka. Przejście do nich realizuje frontend po identyfikatorze.
- Wszystkie części jednej odpowiedzi powstają w jednej transakcji odczytu
  z izolacją REPEATABLE READ. Dwa oddzielne żądania mogą zobaczyć różne wersje danych.

## 2. GET /api/dashboard/activity

Przykład:
`/api/dashboard/activity?period=7d&actor_id=<UUID>&event_type=stock_change&status=active&page=1&page_size=25`

| Parametr | Wartości |
|---|---|
| `actor_id` | UUID konta; `unassigned` dla wpisów bez UUID; brak = wszyscy. |
| `event_type` | Jedna wartość z `DASHBOARD_EVENT_TYPES` w pliku typów. |
| `item_id` | Dodatni identyfikator towaru. |
| `q` | Fragment nazwy towaru/etykiety, bez rozróżnienia wielkości liter, maks. 100 znaków. `%` i `_` są literalne. |
| `status` | `all` (domyślny), `active`, `undone`, `undo`. |
| `page` | Od 1 do 100000, domyślnie 1. |
| `page_size` | Od 1 do 100, domyślnie 25. |

Filtry łączą się przez AND. Dotyczą tylko dziennika, nie kafelków i wykresów
z pierwszego endpointu. `active` oznacza wpis niebędący korektą i niecofnięty;
może być importem lub zdarzeniem reorder, nie tylko zmianą stanu.

```json
{
  "range":{"from":"2026-10-03","to":"2026-10-03","timezone":"Europe/Warsaw"},
  "filters":{"actor_id":null,"event_type":null,"item_id":null,"q":"","status":"all"},
  "page":1,"page_size":25,"total":1,"has_more":false,
  "entries":[{
    "id":42,"ts":"2026-10-03T12:00:00.000Z",
    "actor_id":"22222222-2222-4222-8222-222222222222","actor":"Jan Kowalski",
    "item_id":1,"item_name":"Kartony","event_type":"stock_change",
    "text":"wzięliśmy paletę kartonów","details":"","delta":-2,"before":13,"after":11,
    "undo_of":null,"undone_by":null,"status":"active"
  }]
}
```

Sortowanie: najnowszy czas, następnie największy ID. `total` obejmuje wszystkie
pasujące wpisy, niezależnie od strony. Przy pustym wyniku `entries=[]`, `total=0`.
Nowe wpisy pomiędzy żądaniami mogą przesunąć strony — po aktualizacji wersji
warto wrócić na pierwszą stronę. Czas `ts` jest ISO UTC; formatowanie w UI według `range.timezone`.

### Autorzy i szczegóły

- Do dropdownu osób wykorzystaj istniejące `GET /api/users` (także tylko kierownik).
  Wartość filtra to UUID, nie nazwa; dodaj opcję „Bez przypisanego konta”.
- `actor` to nazwa zapisana podczas operacji, więc zmiana profilu nie zmienia historii.
  Nie zakładamy, że obecna rola konta jest jego rolą historyczną. Stare wpisy mogą
  mieć `actor_id=null`; nazwa nadal jest dostępna w wierszu.
- `event_type`/`details` pozwalają oznaczyć import, szkic zamówienia i decyzje.
  Autor automatycznego reorder może być tym samym autorem co zatwierdzona zmiana.
- `undo_of` i `undone_by` wiążą korekty. Dla akcji Cofnij użyj istniejącego
  `POST /api/history/{id}/undo` z obecnym potwierdzeniem; nie każdy aktywny wpis jest cofalny.
- Dziennik nie zawiera pytań, logowań, anulowanych kart ani nieudanych wywołań AI.
  Nie nazywaj go pełnym logiem wszystkich zachowań użytkownika.

## Sprawdzenie przed podłączeniem UI

`npm test -- tests/dashboard-api.test.ts` — prawdziwe route handlery, testowa baza,
oba silniki: PGlite i postgres.js przez protokół Postgres. Testy obejmują daty,
undo/import, filtry, paginację, 401/403 i brak zewnętrznych wywołań w demo.
Dashboard nie wymaga migracji tabel ani nowych pakietów.
