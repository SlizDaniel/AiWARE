# MAGAZYNIER na telefonie

Klient w `mobile/` to Expo SDK 57, React Native 0.86, TypeScript oraz NativeWind 4.
NativeWind 4 korzysta z Tailwind CSS 3; aplikacja webowa nadal korzysta z Tailwind 4.
Osobne konfiguracje i lockfile zapobiegają mieszaniu zależności obu aplikacji.
Konfiguracja opiera się na [instalacji NativeWind](https://www.nativewind.dev/docs/getting-started/installation),
[Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/) i
[Supabase Auth dla React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native).

## Konfiguracja

1. Backend Next.js musi mieć ustawione `DATABASE_URL` (Supabase Postgres),
   `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Użyj dotychczasowego projektu Supabase i kont użytkowników.
2. W `mobile/` wykonaj `npm ci`, skopiuj `.env.example` do `.env` i uzupełnij:

   | Zmienna | Wartość |
   |---|---|
   | `EXPO_PUBLIC_API_URL` | Adres backendu, np. `https://magazynier.vercel.app`, bez `/api` |
   | `EXPO_PUBLIC_SUPABASE_URL` | Adres tego samego projektu Supabase co na backendzie |
   | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publiczny klucz publishable / anon tego projektu |

3. Uruchom `npm start` w `mobile/` (lub `npm run mobile:start` w katalogu głównym).
   Otwórz w Expo Go zgodnym z SDK 57 albo w buildzie deweloperskim.
   `npm run android`, `npm run ios` i `npm run web` uruchamiają wybraną platformę.

Zmienne `EXPO_PUBLIC_*` trafiają do aplikacji. Klucze Gemini, Supabase service-role oraz
`DATABASE_URL` pozostają wyłącznie na backendzie. W wersji wdrożonej używaj adresu HTTPS.

Przy backendzie na laptopie uruchom `npm run dev -- --hostname 0.0.0.0`.
Telefon i laptop muszą być w tej samej sieci; `EXPO_PUBLIC_API_URL` musi wskazywać adres LAN
laptopa, np. `http://192.168.1.20:3000`. `localhost` na fizycznym telefonie wskazuje telefon.
Android Emulator może używać `http://10.0.2.2:3000`.
Po zmianie `.env` zrestartuj Metro (`npm start -- --clear`); przy ponownym eksporcie użyj `--clear`.

### Gdy telefon nie ma dostępu do laptopa przez Wi-Fi

Sprawdź na telefonie `http://<adres-LAN-laptopa>:8081/status`. Jeśli strona się nie otwiera,
uruchom tunel Expo. Backend musi działać lokalnie na porcie 3000.
W `mobile/` narzędzie tunelu można zainstalować lokalnie bez zmiany lockfile:
`npm install --no-save --package-lock=false @expo/ngrok@^4.1.0`.

Uruchom `npm start -- --tunnel`, zapisz wydrukowany host `*.exp.direct` i zatrzymaj serwer.
Następnie uruchom ponownie, podstawiając ten host:

```bash
EXPO_PUBLIC_API_URL=https://twoj-host.exp.direct MAGAZYNIER_TUNNEL_API=1 npm start -- --tunnel --clear
```

Tryb `MAGAZYNIER_TUNNEL_API=1` przekazuje wyłącznie ścieżki `/api/*` z Metro do
`127.0.0.1:3000`, dzięki czemu aplikacja i API korzystają z jednego tunelu.
Autoryzacja Supabase pozostaje egzekwowana przez backend. Tryb jest wyłączony domyślnie.
Na telefonie otwórz nowy adres `exp://…exp.direct` w Expo Go.

## Zachowanie

- **Magu:** komenda tekstowa lub nagranie, edytowalna transkrypcja, odpowiedź albo karta zmiany.
  Zapis wymaga osobnego zatwierdzenia; przełączanie sekcji zachowuje oczekującą kartę.
- **Stany:** wyszukiwanie i minima; kierownik importuje XLSX/CSV po sprawdzeniu mapowania.
  Wszyscy mogą eksportować XLSX/CSV do arkusza udostępniania telefonu.
- **Mapa:** schemat stref i ich zawartość. Odpowiedź o lokalizacji przełącza do mapy i podświetla
  odpowiadającą strefę. Reguły przypisania pozycji są współdzielone z klientem webowym.
- **Historia:** audyt, a dla kierownika cofnięcie z osobnym potwierdzeniem.
- **Więcej:** szkice zamówień, procedury, konto i ustawienia agenta. Role egzekwuje API;
  zarządzanie rolami użytkowników pozostaje w panelu webowym.

Nagranie przez `expo-audio` trwa maksymalnie 45 sekund. Serwer `/api/stt` transkrybuje je przez
Gemini lub skonfigurowany adapter Whisper. Nagranie lokalne usuwamy po odczycie do wysłania.
Transkrypcja trafia do pola tekstowego, bez automatycznego wykonania komendy. Przerwanie pracy
na panelu lub przejście aplikacji w tło zatrzymuje nagrywanie. Brak uprawnień do mikrofonu,
STT lub sieci pozostawia możliwość wpisania komendy. Limit pliku/nagrania to 4 MB.
Opcjonalny odczyt odpowiedzi korzysta z `expo-speech` i głosu polskiego dostępnego na urządzeniu.

Logowanie: e-mail i hasło w Supabase Auth. Sesję zapisuje AsyncStorage zgodnie z quickstartem
Supabase; odświeżanie tokenu działa, gdy aplikacja jest aktywna. API weryfikuje JWT przez
`getClaims(token)`, a rolę odczytuje z serwerowej tabeli `profiles`, nie z metadanych klienta.
Nieprawidłowe jawne credentials nie przełączają się na sesję z cookies.

Aktualizacje: polling `/api/version` co 3 sekundy w aktywnej aplikacji, odświeżenie po zapisie,
po powrocie z tła oraz gestem przeciągnięcia. Nie ma lokalnej kolejki zapisów offline.
Timeout zapisu wymaga sprawdzenia historii przed ponowieniem komendy.
Nasłuch prefixu z Web Speech API pozostaje funkcją klienta webowego; mobilny używa nagrywania
po naciśnięciu. Serwerowy parser offline nadal działa jako fallback interpretacji.

## Weryfikacja i przed wydaniem

```bash
# katalog główny: kontrakty API, role, logika domenowa, transport mobilny
npm test
npm run typecheck
npm run lint

# mobile/: typy, zgodność SDK i bundlowanie wszystkich platform
npm run typecheck
npx expo install --check
npm run export -- --platform all --max-workers 2
```

Bundlowanie generuje kod dla Androida/iOS i wersję webową; nie tworzy podpisanego APK/IPA.
Na branchu `feature/expo-mobile` sprawdzono: 547 testów zaliczonych / 1 pominięty warunkowo,
typy i lint obu klientów, zgodność zależności Expo, eksport Android/iOS/web oraz produkcyjny
build Next.js. Test GUI z atrapą Supabase i izolowaną bazą PGlite potwierdził logowanie,
komendę bez zapisu przed zatwierdzeniem, zachowanie oczekującej karty przy nawigacji,
zatwierdzenie, stany, audyt, undo, utworzenie i podświetlenie strefy, widoki procedur/konta,
import XLSX po mapowaniu i wylogowanie. Sprawdzono także viewport 390 px.
Testy uwierzytelniania używają mocków weryfikatora Supabase. Nie zastępują próby z rzeczywistym
kontem i fizycznym telefonem. Przed wydaniem sprawdź Android/iOS: logowanie, odświeżenie sesji,
zgody mikrofonu, nagranie/transkrypcję, powrót z tła, polski TTS, picker plików i udostępnianie.
Próba przez przeglądarkę potwierdza interfejs i integrację API, a nie moduły natywne.

Audyt npm dla tej instalacji zgłosił 32 problemy (24 high, 8 moderate), w tym zależności
narzędzi Expo/Metro i Tailwind. Proponowane `npm audit fix --force` zmienia główne wersje
frameworków (m.in. cofa Expo); nie stosowano go. Rozwiązanie tych alertów pozostaje wymaganym
punktem kwalifikacji przed publikacją produkcyjną.
