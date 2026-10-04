# 26: Naprawa lokalnego startu

Owner A. Branch `fix/startup-loading-recovery`.

Użytkownik zgłosił niekończące ładowanie localhost i wcześniejszy błąd toLowerCase.
Odtworzono na 3002 ChunkLoadError: HTML wskazuje brakujący chunk JavaScript.
API me/health tego demo odpowiada 200 w <200ms; na 3000 wymagane logowanie,
a health nie odpowiedział w 8s. 5173 jest starszym frontendem Vite.
Nie odtworzono błędu toLowerCase, nie przypisujemy mu niepotwierdzonej przyczyny.

## Kryteria

- Offline launcher buduje/uruchamia z osobnego .next-demo, zwykły build/dev
  nie nadpisują plików tego demo. Brak tego buildu wymaga --build.
- Nie resetujemy bazy. Zachowujemy dotychczasowe dane demo.
- Startup me oraz health/version mają limit 15s (także body), abort i błąd.
- Błąd konta pokazuje komunikat i retry, zamiast bezterminowego spinnera.
- Zachowane uprawnienia i przekierowanie 401 do logowania.
- Regresje oraz GUI startu/operacji po restarcie. Zmiana kolegi nietknięta.
