# Materiały prezentacji MAGAZYNIER

Źródła i screenshoty przeniesione z dawnego `tmp/presentation/`. Zachowano materiały zespołu oraz finalne PDF-y:

- [Prezentacja — 10 slajdów](../output/pdf/MAGAZYNIER-prezentacja-10-slajdow.pdf).
- [Przewodnik web/mobile — 41 stron](../output/pdf/MAGAZYNIER-przewodnik-web-mobile.pdf).
- [Screenshoty web/mobile](assets/) używane przez generatory.

## Generatory PDF

Skrypty korzystają z fontów Segoe w `C:/Windows/Fonts`, dlatego poniższa instrukcja dotyczy Windows. Wymagają Pythona oraz pakietów `reportlab`, `Pillow`, `pypdf` i `pypdfium2`. Można je zainstalować we własnym środowisku wirtualnym:

```powershell
python -m pip install reportlab Pillow pypdf pypdfium2
```

Z katalogu głównego repo:

```powershell
python presentation/build_guide.py
python presentation/render_guide.py
python presentation/build_pitch10.py
```

Można użyć `py` zamiast `python`, jeśli taki launcher jest dostępny. Ścieżki plików są ustalane względem skryptów, więc nie zależą od katalogu terminala.

Generatory nadpisują odpowiednie PDF-y w `output/pdf/`. `build_guide.py` aktualizuje też `slide-content.json` i `layout.json`. Podglądy w `render/` i `render10/` są ignorowane przez Git i można je odtworzyć. Generator prezentacji sprawdza liczbę slajdów i tekst, a renderer przewodnika kontroluje 41 stron oraz obecność wybranych polskich etykiet.

## Dane lokalnego demo do screenshotów

Po `npm ci` w głównym katalogu repo:

```powershell
node --import tsx presentation/seed.ts
```

Skrypt **resetuje osobną bazę PGlite `data/presentation-demo`** i dodaje fikcyjne konta, ścieżkę, sektor i zadanie. Ścieżka jest wyznaczana względem pliku, niezależnie od katalogu terminala. Skrypt nie wybiera bazy z `DATABASE_URL` i nie łączy się z usługą AI. Nie używaj tej bazy do rzeczywistych danych.

## Historyczne proxy do prób GUI

```powershell
node presentation/preview-proxy.mjs
```

Proxy nasłuchuje wyłącznie na `127.0.0.1:3099` i przekazuje `/api/` do lokalnego backendu `127.0.0.1:3005`. Endpointy `/auth/v1/` zwracają fikcyjnego użytkownika i token demonstracyjny. To atrapa do lokalnych prób, nie implementacja uwierzytelniania produkcyjnego. Backend musi zostać uruchomiony osobno; sam skrypt go nie uruchamia. Ctrl+C zatrzymuje proxy.
