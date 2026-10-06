# Skan sekretów — 2026-10-06

## Wynik i zakres

Gitleaks **8.30.1**, z domyślnymi regułami, nie wykrył sekretów w przeskanowanej zawartości. Nie znaleziono podstaw do wskazania konkretnego klucza do unieważnienia. To wynik automatycznej detekcji, nie gwarancja braku dowolnych poufnych danych.

Punkt odniesienia: `9acea604f1cde9aa95c77dd941c92aaf9bde83aa` (`codex/portfolio-cleanup`). Przed skanem pobrano referencje i tagi z `origin`. Repozytorium nie jest płytkim klonem.

| Sprawdzenie | Zakres | Wynik |
|---|---|---|
| Bieżąca zawartość commita | Archiwum śledzonych plików `HEAD`; skan również obsługiwanych archiwów zagnieżdżonych | 0 znalezisk |
| Historia zmian | `git --log-opts="--all --full-history"`; 213 osiągalnych commitów, 160 commitów przetworzonych przez skan diffów | 0 znalezisk |
| Pełna zawartość plików historycznych | Wszystkie 1195 unikalnych blobów osiągalnych przez lokalne referencje Git; dodatkowa kontrola zawartości merge commitów | 0 znalezisk |
| Tekst PDF-ów | Tekst wyodrębniony z 22 historycznych wersji PDF-ów; wszystkie wyodrębnione poprawnie | 0 znalezisk |
| Pliki środowiskowe w bieżącym commicie | Śledzone tylko `.env.example` i `mobile/.env.example` | Szablony, bez wykrytych sekretów |

Skaner pobrano z oficjalnego wydania i sprawdzono SHA256 względem opublikowanego pliku sum kontrolnych. Skanowanie było lokalne; nie wysyłano zawartości repo do usługi skanującej i nie sprawdzano aktywności tokenów u dostawców. Raporty generowano z `--redact=100`, bez ujawniania wartości znalezisk.

## Ograniczenia

- Nie wykonano OCR screenshotów, obrazów osadzonych w PDF-ach ani innych grafik. Ekstrakcja PDF obejmuje warstwę tekstową.
- Skan dotyczy osiągalnej historii pobranych referencji, nie utraconych commitów, usuniętych zdalnych gałęzi, forków ani cudzych klonów.
- Nie sprawdzano lokalnych baz, ignorowanych plików `.env`, ustawień Vercel/Supabase ani GitHub Actions Secrets. Nie są częścią przeskanowanego publicznego kodu.
- Skaner może nie rozpoznać niestandardowych haseł i danych poufnych. Adres e-mail autora commita sam w sobie nie jest sekretem dostępowym.
- Audyt podatności npm to odrębne sprawdzenie; wynik tego skanu nie rozstrzyga o podatnościach zależności.

## Powtórzenie skanu

Po zainstalowaniu Gitleaks, z katalogu głównego repo:

```bash
git fetch origin --tags
gitleaks git . --log-opts="--all --full-history" --redact=100 --ignore-gitleaks-allow
```

Ta komenda powtarza skan historii diffów. Opisane wyżej sprawdzenie wszystkich blobów i ekstrakcja PDF były dodatkowymi krokami audytu.

Jeżeli później zostanie wykryty rzeczywisty sekret, należy najpierw go unieważnić lub wymienić u dostawcy, ocenić użycie i dopiero potem uzgodnić usunięcie z plików oraz ewentualne czyszczenie historii. Usunięcie z bieżącego commita nie unieważnia klucza.

Lokalne raporty tego przebiegu znajdują się w ignorowanym `data/security-audit/`. Wynik dotyczy wskazanego punktu odniesienia; kolejne zmiany wymagają ponownej kontroli.
