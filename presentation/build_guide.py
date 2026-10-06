from pathlib import Path
from xml.sax.saxutils import escape
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
import json

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'presentation/assets'
OUT=ROOT/'output/pdf/MAGAZYNIER-przewodnik-web-mobile.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
for name,file in [('Segoe','segoeui.ttf'),('SegoeBold','segoeuib.ttf'),('SegoeLight','segoeuil.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/file)))
pdfmetrics.registerFontFamily('Segoe',normal='Segoe',bold='SegoeBold',italic='Segoe',boldItalic='SegoeBold')
W,H=1280,720
INK='#182D26'; GREEN='#315B45'; MUTED='#59665F'; BG='#F6F5EF'; LINE='#D7DED5'
slides=[]
def add(title,section,steps=None,image=None,crop=None,note='',kind='screen',**kwargs):
    slides.append(dict(title=title,section=section,steps=steps or [],image=image,crop=crop,note=note,kind=kind,**kwargs))

add('MAGAZYNIER','Przewodnik użytkownika',kind='cover')
add('Twoja droga przez aplikację','Na początek',kind='text',steps=[
 ('01 / Uruchomienie i konto','Przygotuj aplikację lub otwórz adres otrzymany od kierownika. Załóż konto w wersji webowej i uzyskaj dostęp.'),
 ('02 / Przygotowanie magazynu','Kierownik ustawia agenta, importuje stany, definiuje lokalizacje i reguły pakowania.'),
 ('03 / Codzienna praca','Pracownik pyta o towar, zgłasza wydania i przyjęcia, zatwierdza karty oraz wykonuje własne zadania.'),
 ('04 / Praca na telefonie','Zaloguj się tym samym kontem. Korzystaj z komend, stanów, mapy, historii i menu Więcej.')],note='Screeny: rzeczywisty interfejs na fikcyjnych danych. Mobile: podgląd Expo Web 390 × 844; logowanie w lokalnej atrapie Auth, bez kont produkcyjnych.')
add('Uruchomienie na komputerze','Instalacja / administrator',kind='code',steps=[('Wymagania','Node.js ≥ 20.9, npm, Git. Internet jest potrzebny przy instalacji. Python 3.10+ jest opcjonalny dla launchera demo.'),('Konfiguracja','Skopiuj .env.example do .env.local. Puste wartości wystarczą do startu lokalnego: PGlite, parser offline i rola lokalnego kierownika.'),('Start','Otwórz localhost:3000. W trybie lokalnym bez Supabase Auth nie sprawdzisz rozdzielenia ról.')],code='git clone https://github.com/SlizDaniel/AiWARE.git\ncd AiWARE\nnpm ci\n# PowerShell:\nCopy-Item .env.example .env.local\nnpm run dev',note='macOS/Linux: cp .env.example .env.local. Zachowaj własny plik konfiguracji, jeśli już istnieje.')
add('Konfiguracja wdrożenia i AI','Instalacja / administrator',kind='code',steps=[('Supabase','Ustaw połączenie PostgreSQL, URL projektu i publiczny klucz Auth. W Auth skonfiguruj e-mail/hasło, Site URL i adres /auth/callback.'),('Gemini i głos','GEMINI_API_KEY włącza AI. OPENROUTER_API_KEY dodaje Mercury Decide, a STT_API_KEY opcjonalny Whisper/Groq.'),('Vercel','Wybierz Next.js i katalog główny. Ustaw zmienne projektu i wykonaj deploy. Sprawdź /api/health i logowanie.')],code='DATABASE_URL=postgresql://...\nNEXT_PUBLIC_SUPABASE_URL=https://...\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...\nGEMINI_API_KEY=...\n\nnpm run db:setup\nnpm run build\nnpm start',note='Klucze serwerowe pozostają na backendzie. Na Vercel storage=ephemeral oznacza nietrwałe dane. AUTH_DISABLED=1 służy wyłącznie do lokalnych prób.')
add('Logowanie w przeglądarce','Konto / web',image='web-login.png',crop=(405,60,455,520),steps=[('1. Otwórz aplikację','Przejdź do adresu wdrożenia i wybierz zakładkę Zaloguj.'),('2. Podaj dane','Wpisz adres e-mail i hasło swojego konta. Przycisk Pokaż pozwala sprawdzić wpisane hasło.'),('3. Wejdź do magazynu','Kliknij Zaloguj. Jeśli e-mail nie jest potwierdzony, najpierw otwórz link z wiadomości rejestracyjnej.')],note='Logowanie produkcyjne wymaga skonfigurowanego Supabase Auth. Konto oczekujące zobaczy informację o potrzebie akceptacji.')
add('Rejestracja nowego użytkownika','Konto / web',image='web-register.png',crop=(405,60,455,610),steps=[('1. Wybierz Załóż konto','Podaj e-mail, hasło i opcjonalnie imię oraz nazwisko widoczne w audycie.'),('2. Wyślij formularz','Użyj hasła spełniającego wymagania projektu Auth; formularz wymaga co najmniej 6 znaków.'),('3. Potwierdź e-mail','Jeśli Supabase wymaga potwierdzenia, kliknij link z wiadomości. Potem zaloguj się hasłem.'),('4. Poczekaj na dostęp','Pierwsze konto w nowej bazie zostaje kierownikiem. Kolejne czekają na nadanie roli.')],note='Rejestracja jest w wersji webowej. Ustawienia poczty, potwierdzania e-mail i możliwości rejestracji zależą od Supabase.')
add('Akceptacja kont i podział ról','Konto / kierownik',kind='table',rows=[['Operacja','Pracownik','Kierownik'],['Komendy, pytania i karty zmian stanów','Tak','Tak'],['Stany, mapa, historia, eksport','Tak','Tak'],['Import i bezpośrednia edycja produktów','Nie','Tak'],['Decyzje o szkicach oraz undo zapasu','Nie','Tak'],['Zapis reguł, ustawienia i role','Nie','Tak'],['Zadania','Własne: odczyt i wykonanie','Wszystkie: przydział i anulowanie'],['Dashboard, raporty i powiadomienia','Nie','Tak']],note='Ustawienia → Użytkownicy → nadaj rolę pracownik lub kierownik. Status oczekujacy blokuje dostęp do danych. Ostatni kierownik musi zachować uprawnienia.')
add('Nawigacja i stany magazynowe','Codzienna praca / web',image='web-stock.png',steps=[('1. Wybierz sekcję z lewej','Mapa, Stany, Kolejka, Historia, Procedury i Ustawienia. Kierownik ma też Dashboard; zadania obsługujesz w sekcji Zadania.'),('2. Sprawdź towar','Wyszukaj nazwę, zmień sortowanie lub pokaż braki. Każdy wiersz zawiera stan, jednostkę, minimum i lokalizację.'),('3. Korzystaj z agenta','Panel komend pozostaje obok danych. Odpowiedź lub propozycję sprawdzasz w tym samym miejscu.')],note='Kolory i oznaczenia rozróżniają zerowy stan, zapas poniżej minimum, blisko minimum oraz stan OK.')
add('Prefix i tryb agenta','Konfiguracja / kierownik',image='web-settings.png',crop=(285,170,605,390),steps=[('1. Otwórz Ustawienia','W części Agent wpisz prefix, np. Magu lub Gosiu. Komendy bez prefixu też działają.'),('2. Wybierz interpretację','LLM korzysta z AI; offline i mock z deterministycznego parsera. W demo tryb jest zablokowany.'),('3. Zapisz ustawienia','Zmiany obowiązują bez restartu. Po zmianie prefixu poprzedni przestaje aktywować agenta.')],note='Pracownik widzi ustawienia do odczytu. Klucze dostawców ustawia administrator w konfiguracji serwera.')
add('Mikrofon, nasłuch i odczyt głosem','Konfiguracja / kierownik',image='web-voice-settings.png',crop=(285,155,605,555),steps=[('1. Wybierz tryb głosu','Mikrofon po naciśnięciu, nasłuch na prefix albo tylko tekst.'),('2. Sprawdź transkrypcję','Zezwól na mikrofon przy korzystaniu z głosu. Opcjonalna transkrypcja serwera doprecyzowuje tekst z przeglądarki.'),('3. Włącz TTS, jeśli potrzebujesz','Opcja Czytaj odpowiedzi głosem korzysta z dostępnego polskiego głosu. Zapisz zmianę i sprawdź próbkę.')],note='Mikrofon wymaga HTTPS lub localhost. W DEMO_MODE chmurowe STT i TTS są wyłączone; pozostaje tekst. Nasłuch na telefonie włącza się przyciskiem.')
add('Źródło danych, minima i zamówienia','Konfiguracja / kierownik',image='web-thresholds.png',crop=(285,140,605,570),steps=[('1. Wybierz źródło danych','Wbudowana baza lub import XLSX/CSV. W obu przypadkach dane są przechowywane w bazie.'),('2. Ustal domyślne minimum','Dotyczy nowych produktów i importu bez kolumny minimum. Nie zmienia progów istniejących pozycji.'),('3. Ustal wielkość szkicu','Domyślna ilość w szkicu zamówienia określa propozycję uzupełnienia po spadku poniżej minimum.'),('4. Zapisz ustawienia','Obowiązują dla kolejnych operacji; zmiana nie aktualizuje automatycznie Twojego pliku Excel.')])
add('Import pliku magazynu','Dane / kierownik',image='web-import.png',crop=(285,175,615,340),steps=[('1. Otwórz Stany','Kliknij Importuj plik i wybierz XLSX albo CSV.'),('2. Wczytaj arkusz','Limit: 4 MB i 10 000 wierszy. Wymagane są nazwa produktu i ilość; można dodać minimum, lokalizację i jednostkę.'),('3. Przejdź do podglądu','Na tym etapie nic nie zmienia stanu. Aplikacja przygotowuje sugestię przypisania kolumn.')],note='W trybie LLM nagłówki i pierwsze 5 wierszy trafiają do Gemini. Offline mapowanie powstaje z nazw kolumn, bez AI.')
add('Mapowanie kolumn i zatwierdzenie','Dane / kierownik',image='web-import-mapping.png',crop=(285,20,610,635),steps=[('1. Sprawdź przypisania','Nazwa pozycji → nazwa; Aktualny stan → ilość. Dopasuj minimum, lokalizację i jednostkę.'),('2. Obejrzyj próbkę','Sprawdź liczby i miejsca składowania. Sugestia i procent dopasowania wymagają Twojej oceny.'),('3. Zatwierdź import','Dopiero ten przycisk zapisuje dane. Pozycje o tej samej nazwie są aktualizowane zamiast powielane.')],note='Import czyta wartości arkusza; aplikacja nie oblicza formuł Excel. Błędne mapowanie popraw przed zapisem.')
add('Edycja produktu i eksport stanów','Dane / web',image='web-edit.png',crop=(285,85,615,625),steps=[('1. Kierownik: kliknij ikonę edycji','Popraw nazwę, ilość, minimum, jednostkę lub lokalizację. Sprawdź dane i wybierz Zapisz produkt.'),('2. Wszyscy: pobierz arkusz','Przyciski CSV i XLSX eksportują aktualne stany do pliku.'),('3. Zachowaj spójność','Zmiany wykonywane przez aplikację trafiają do bazy. Excel odświeżasz przez ponowny eksport.')],note='Eksport stanów nie jest backupem kont, audytu, procedur ani map. Bezpośrednia edycja i usuwanie produktów wymagają kierownika.')
add('Komenda i karta zmiany','Agent / web',image='web-proposal.png',crop=(930,265,315,438),steps=[('1. Powiedz albo wpisz polecenie','Np. „wzięliśmy paletę kartonów”. W trybie tekstowym kliknij Wyślij.'),('2. Sprawdź kartę','Towar, ilość, stan przed i po, jednostka oraz minimum. W demo: 13 → 11 szt.'),('3. Podejmij decyzję','Zatwierdź zapisuje operację; Odrzuć pozostawia stan. Możesz też powiedzieć tak/zatwierdź albo nie/odrzuć w aktywnym trybie głosowym.')],note='Parser demo przyjmuje 2 jednostki na paletę. Dla rzeczywistego wydania podaj jawną ilość i sprawdź kartę.')
add('Historia zatwierdzonych operacji','Audyt / web',image='web-history.png',crop=(285,125,610,590),steps=[('1. Otwórz Historię','Znajdziesz kto, kiedy i co zmienił: treść polecenia, stan przed i po oraz wpisy innych operacji.'),('2. Sprawdź efekt','Po zatwierdzeniu kartonów widoczna jest zmiana 13 → 11 oraz osobny szkic uzupełnienia.'),('3. Rozróżniaj wpisy','Pytanie nie jest zmianą zapasu. Import, reguła pakowania czy szkic mają własny rodzaj zdarzenia.')],note='Autora ustala serwer na podstawie konta. Na screenach demo jest lokalny kierownik.')
add('Cofnięcie błędnej zmiany','Audyt / kierownik',image='web-undo.png',crop=(285,165,610,430),steps=[('1. Znajdź zmianę zapasu','Kliknij Cofnij przy właściwym wpisie historii.'),('2. Przeczytaj potwierdzenie','Sprawdź produkt i stan po korekcie. Dla przykładu 11 wróci do 13.'),('3. Wybierz Tak, cofnij','Powstaje nowy wpis audytu. Pierwotna operacja pozostaje widoczna; nie jest usuwana.')],note='Undo dotyczy zmian zapasu. Nie każda operacja ma cofnięcie, a wpis już cofnięty nie może być cofnięty ponownie.')
add('Szkic uzupełnienia zapasu','Kolejka / kierownik',image='web-queue.png',crop=(285,160,610,545),steps=[('1. Otwórz Kolejkę','Po spadku poniżej minimum agent może utworzyć szkic. W przykładzie proponuje 50 szt. kartonów.'),('2. Sprawdź produkt i ilość','Obejrzyj termin dostawy oraz filtr Oczekujące / Rozpatrzone / Wszystkie.'),('3. Zatwierdź albo odrzuć','Kierownik zapisuje decyzję. Przycisk usunięcia z kolejki odrzuca szkic; możliwe jest zbiorcze odrzucenie.')],note='Zatwierdzenie szkicu nie wysyła zamówienia do dostawcy i nie zwiększa fizycznego stanu towaru.')
add('Lokalizacja na mapie','Mapa / web',image='web-map.png',crop=(285,670,960,570),steps=[('1. Zapytaj o miejsce','„Gdzie leży szkło?” daje lokalizację i podświetla odpowiadającą strefę.'),('2. Wybierz strefę lub sektor','Sprawdź znajdujące się tam towary i ilości. Strefę dodasz komendą „strefa: Strefa B-2” i zatwierdzeniem.'),('3. Uzupełniaj plan','Zapisuj przejścia i sektory. Nazwy stref powinny odpowiadać lokalizacjom w stanach.')],note='Układ stref jest schematyczny. Przypisanie towaru do sektora opisuje rozmieszczenie, nie zmienia zapasu. Usuwanie ścieżek i sektorów: kierownik.')
add('Wyszukiwanie procedury','Procedury / web',image='web-procedures.png',crop=(285,175,610,480),steps=[('1. Wybierz Procedury','Wyszukaj produkt, np. Szkło, albo zapytaj „Magu, jak pakujemy szkło?”.'),('2. Przeczytaj całą instrukcję','Zwróć uwagę na opakowanie, ilość na opakowanie i postępowanie przy brakach lub uszkodzeniu.'),('3. Odszukaj towar','Pokaż na mapie przenosi do jego strefy. Jeśli opakowanie jest powiązane ze stanem, zobaczysz zapas.')],note='Samo przeczytanie procedury nie odejmuje towaru ani opakowania. Reguły demo są fikcyjnymi przykładami.')
add('Zapis reguły pakowania','Procedury / kierownik',image='web-packing-form.png',crop=(285,230,610,425),steps=[('1. Wybierz produkt i opakowanie','W formularzu Nowa reguła pakowania wybierz pozycje z katalogu.'),('2. Wpisz ilość i uwagi','Podaj liczbę jednostek produktu w jednym opakowaniu oraz warunki wykonania.'),('3. Sprawdź Podgląd reguły','Zatwierdź kartę. Można też podać pełną komendę, np. „zapamiętaj: Szkło pakujemy po 2 w Duży karton”.')],note='Jedna aktywna reguła na produkt. Zapis i aktualizacja wymagają kierownika; zmiana produktu lub reguły może unieważnić starą kartę.')
add('Przydzielanie i wykonywanie zadań','Zadania / web',image='web-tasks.png',crop=(285,175,610,475),steps=[('1. Kierownik: przygotuj zadanie','Wybierz aktywnego pracownika, wpisz tytuł, opis i priorytet Normalny albo Pilny.'),('2. Przydziel zadanie','Pracownik zobaczy je na własnym koncie i licznik nowych zadań.'),('3. Pracownik: potwierdź wykonanie','Odczytaj instrukcję, oznacz własne zadanie jako przeczytane i następnie wykonane. Kierownik może anulować przydział.')],note='Pracownik widzi własne zadania, kierownik wszystkie. Pytanie agenta o cudze zadania jest dostępne tylko kierownikowi.')
add('Pomoc do wykonania zadania','Zadania / web',image='web-task-procedures.png',crop=(285,45,610,550),steps=[('1. Kliknij Jak wykonać?','Aplikacja szuka zapisanych procedur związanych z treścią zadania.'),('2. Sprawdź źródła','W offline widzisz pełne dopasowane instrukcje. W AI Gemini wybiera kroki ze wskazanych źródeł.'),('3. Nie uzupełniaj braków domysłem','Przeczytaj warunki bezpieczeństwa. Gdy brak procedury lub instrukcja jest niejasna, poproś kierownika.')],note='Po kliknięciu pomocy w trybie AI treść zadania i dopasowane procedury trafiają do Gemini. Pomoc nie zmienia stanów ani statusu zadania.')
add('Dashboard i powiadomienia','Zarządzanie / kierownik',image='web-dashboard-alert.png',crop=(285,680,950,820),steps=[('1. Sprawdź stan teraz','Towary poniżej minimum, oczekujące szkice i brakujące lokalizacje.'),('2. Wybierz okres','Dziś, 7 dni, 30 dni lub własne daty. Liczniki bieżące nadal opisują stan teraz.'),('3. Otwórz alert','Przejdź do stanów lub kolejki. Oznaczenie powiadomienia jako przeczytane nie rozwiązuje problemu.')],note='Raport pokazuje liczbę operacji, nie sumę sztuk różnych towarów. Powiadomienia i dashboard są dostępne tylko kierownikowi.')
add('Dziennik i przekazanie zmiany','Raporty / kierownik',image='web-shift.png',crop=(285,1790,950,455),steps=[('1. Sprawdź dziennik akcji','Filtruj po autorze, typie zdarzenia, towarze, statusie i nazwie. Pobierz pasujące wpisy jako CSV.'),('2. Wybierz towar do trendu','Historia zapasu pokazuje stan po zapisanych zmianach i luki w dostępnej historii.'),('3. Przekaż zmianę','Zakładka Przekazanie zmiany podsumowuje ostatnie 8 godzin albo własny zakres godzin.')],note='Podsumowanie dotyczy zapisanej pracy magazynu; nie jest ewidencją czasu pracy ani oceną osób.')
add('Uruchomienie klienta mobilnego','Mobile / administrator',kind='code',steps=[('1. Przygotuj backend','Użyj tego samego API Next.js i projektu Supabase co w wersji webowej.'),('2. Uzupełnij mobile/.env','API URL bez /api; publiczny URL i klucz Supabase. Nie umieszczaj tu klucza Gemini ani hasła bazy.'),('3. Uruchom Expo','Otwórz w Expo Go zgodnym z SDK 57 lub buildzie deweloperskim. Na laptopie i telefonie zadbaj o wspólną sieć.')],code='cd mobile\nnpm ci\n# PowerShell:\nCopy-Item .env.example .env\n\nEXPO_PUBLIC_API_URL=https://twoja-aplikacja\nEXPO_PUBLIC_SUPABASE_URL=https://twoj-projekt\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...\n\nnpm start',note='Lokalnie API: adres LAN laptopa, np. http://192.168.1.20:3000. localhost na telefonie wskazuje telefon. Po zmianie .env: npm start -- --clear.')
add('Logowanie na telefonie','Mobile / konto',image='mobile-login.png',kind='mobile',steps=[('1. Użyj konta z webu','Aplikacja mobilna ma formularz logowania. Konto załóż wcześniej na stronie webowej.'),('2. Wpisz e-mail i hasło','Wybierz Wejdź do magazynu. Dostęp i uprawnienia są takie same jak w przeglądarce.'),('3. Sprawdź rolę','Po wejściu u góry widzisz użytkownika i rolę. Jeśli konto czeka na akceptację, poproś kierownika o nadanie dostępu.')],note='Zrzut klienta Expo Web. Konto i dane demonstracyjne; nie jest to screen z fizycznego Androida/iOS.')
add('Panel Magu na telefonie','Mobile / komendy',image='mobile-command.png',kind='mobile',steps=[('1. Otwórz Magu','Dolny pasek przełącza komendy, Stany, Mapę, Historię i Więcej.'),('2. Nagraj lub wpisz','W zwykłym trybie Nagraj komendę wysyła audio do STT. Obejrzyj i popraw transkrypcję przed wysłaniem.'),('3. Wyślij polecenie','Przyciski przykładów pomagają rozpocząć. Pytanie daje odpowiedź; operacja zapisu tworzy kartę.')],note='W pokazanym demo nagrywanie jest wyłączone. Tekst przechodzi przez ten sam pipeline komend.')
add('Zatwierdzanie mobilnej karty','Mobile / operacje',image='mobile-proposal.png',kind='mobile',steps=[('1. Przeczytaj propozycję','Na screenie: przyjęcie palety kartonów i zmiana 11 → 13 szt.'),('2. Sprawdź ilość i towar','Karta nie zmieniła jeszcze zapasu. Porównaj ją z rzeczywistą operacją na hali.'),('3. Zatwierdź zmianę lub odrzuć','Zatwierdzenie zapisuje operację oraz audyt. Przełączanie sekcji zachowuje oczekującą kartę.')],note='W nasłuchu na prefix można używać potwierdzeń głosowych. Nie ponawiaj zapisu po timeout bez sprawdzenia historii.')
add('Stany, import i eksport na telefonie','Mobile / dane',image='mobile-stock.png',kind='mobile',steps=[('1. Otwórz Stany','Wyszukaj produkt i sprawdź zapas, minimum oraz lokalizację.'),('2. Kierownik: importuj plik','Wybierz XLSX/CSV, sprawdź mapowanie i zatwierdź. Obowiązują te same limity i uprawnienia API.'),('3. Wyeksportuj dane','Pobierz CSV/XLSX i udostępnij plik przez mechanizm telefonu. Obsługę plików sprawdź na docelowym urządzeniu.')],note='Web i telefon korzystają z tej samej bazy. Odświeżenie widoku pobiera aktualne dane serwera.')
add('Mapa alejek w aplikacji','Mobile / mapa',image='mobile-map.png',kind='mobile',steps=[('1. Otwórz Mapę','Zobacz zapisane przejścia oraz sektory. Dotknij strefy, aby sprawdzić zawartość.'),('2. Wybierz punkt startu','START lub zapisane skrzyżowanie. Ustal kierunek pierwszej alejki na planie.'),('3. Skalibruj krok','Zmierz odcinek i podziel dystans przez liczbę kroków. Wpisz długość kroku przed spacerem.')],note='Kompas nie obraca planu mobilnego. To schemat alejek o szacowanych wymiarach, nie pomiar geodezyjny.')
add('Mapowanie podczas spaceru','Mobile / mapa',kind='text',steps=[('1 / Rozpocznij spacer','Stań w wybranym punkcie, ustal kierunek i wybierz Rozpocznij spacer z telefonem. Na urządzeniu zezwól na wymagany czujnik ruchu.'),('2 / Zaznaczaj skrzyżowania','Idź prosto; na skrzyżowaniu zatrzymaj się i dodaj punkt. W lewo, W prawo oraz Zawróć zmieniają kierunek planu.'),('3 / Skoryguj powrót','Po fizycznym powrocie wybierz znany punkt START/S…; korekta dotyczy nowych odcinków. Niepasujący powrót może zostać odrzucony.'),('4 / Zapisz przejście','Nazwij ścieżkę i wybierz Zapisz na mapie. Jeśli czujnik nie działa, użyj + Krok lub trybu ręcznego. Dodaj sektor i przypisz towar.')],note='Screeny nie potwierdzają pracy czujników. Przed pracą na hali sprawdź mapowanie na fizycznym telefonie; usuwanie sektorów i ścieżek wymaga kierownika.')
add('Historia operacji na telefonie','Mobile / audyt',image='mobile-history.png',kind='mobile',steps=[('1. Otwórz Historię','Sprawdź wykonane operacje i stany przed oraz po zmianie.'),('2. Kierownik: cofnij zmianę','Wybierz Cofnij zmianę. Aplikacja pokaże osobne potwierdzenie przed wykonaniem korekty.'),('3. Zweryfikuj zapis','Po błędzie sieci sprawdź historię przed ponownym potwierdzaniem, aby uniknąć podwójnej operacji.')],note='Pracownik może czytać historię, ale nie ma uprawnienia do undo.')
add('Kolejka zamówień na telefonie','Mobile / Więcej',image='mobile-queue.png',kind='mobile',steps=[('1. Wybierz Więcej → Kolejka','Sprawdź szkice, ilość, termin i status.'),('2. Kierownik: wybierz decyzję','Zatwierdź szkic lub Odrzuć szkic. Następnie potwierdź w osobnym widoku.'),('3. Zachowaj kontrolę zakupów','To zapis decyzji w aplikacji. Zamówienie nadal nie jest automatycznie wysyłane dostawcy.')],note='Pracownik ma podgląd. Decyzje zakupowe API dopuszcza wyłącznie dla kierownika.')
add('Procedury pod ręką','Mobile / Więcej',image='mobile-procedures.png',kind='mobile',steps=[('1. Wybierz Więcej → Procedury','Znajdź instrukcję przez pole wyszukiwania albo pytanie do Magu.'),('2. Przeczytaj pełną treść','Sprawdź ilość na opakowanie i zasady przy brakach, uszkodzeniu lub rozbieżności stanów.'),('3. Użyj lokalizacji','Pytanie „gdzie leży szkło?” przenosi do mapy i podświetla odpowiednią strefę.')],note='Zatwierdzone reguły są wspólne dla obu klientów. Zapis nowej reguły wymaga roli kierownika i pełnych danych produktu/opakowania.')
add('Konto i ustawienia na telefonie','Mobile / Więcej',image='mobile-settings.png',kind='mobile',steps=[('1. Wybierz Więcej → Konto','Sprawdź użytkownika, rolę i konfigurację agenta.'),('2. Kierownik: dostosuj pracę','Prefix, AI/offline/mock, mikrofon lub nasłuch, źródło danych, minima i wielkość szkicu. Zapisz ustawienia.'),('3. Sprawdź głos i wyloguj się','TTS zależy od polskiego głosu systemu. Po skończonej pracy możesz wylogować konto.')],note='Pracownik widzi ustawienia do odczytu. Zarządzanie rolami użytkowników pozostaje w panelu webowym.')
add('Nasłuch na prefix w praktyce','Mobile / głos',kind='text',steps=[('1 / Włącz nasłuch w Magu','Kierownik wcześniej wybiera ten tryb w ustawieniach. Użytkownik włącza pętlę przyciskiem i udziela zgody na mikrofon.'),('2 / Powiedz „Magu, …”','Wypowiedz komendę po prefiksie. Sam prefix uzbraja kolejną wypowiedź; aplikacja wysyła transkrypcję do obsługi komendy.'),('3 / Sprawdź i potwierdź','Oczekującą kartę zatwierdzasz „tak”/„zatwierdź” lub odrzucasz „nie”/„odrzuć”. Nadal możesz użyć przycisków.'),('4 / Reaguj na błąd','Przejście do tła lub odczyt TTS wstrzymuje nasłuch. Po kolejnych błędach transkrypcji użyj wznowienia albo wpisz tekst.')],note='Chmurowe STT wymaga połączenia z API. Przed wydaniem sprawdź zgody mikrofonu, hałas na hali, powrót z tła i rozpoznawanie na Android/iOS.')
add('Web i mobile: gdzie wykonać operację','Zakres funkcji',kind='table',rows=[['Funkcja','Web','Aplikacja Expo'],['Rejestracja i akceptacja kont','Tak','Logowanie istniejącym kontem'],['Komendy i zatwierdzanie stanów','Tak','Tak'],['Stany oraz import/eksport','Tak','Tak'],['Mapa stref, sektory i ścieżki','Tak','Tak; wspomagane mapowanie alejek'],['Historia oraz undo kierownika','Tak','Tak'],['Kolejka i procedury','Tak','Tak, w Więcej'],['Ustawienia agenta','Tak','Tak, w Konto'],['Role, dashboard, raporty i zadania','Tak','Brak osobnych widoków']],note='Uprawnienia API są wspólne. Webowy widok na małym ekranie i klient Expo to dwa różne interfejsy.')
add('AI, dane i tryb awaryjny','Kontrola i prywatność',kind='text',steps=[('Co trafia do dostawców','Komenda i kontekst towarów do LLM; audio do STT; nagłówki i próbka importu do Gemini; zadanie i dopasowane procedury po kliknięciu pomocy.'),('Jak sprawdzić użycie AI','Ustawienia → Użycie AI pokazują integracje i gotowy tekst ujawnienia AI. Rozpoznawanie przeglądarki może korzystać z usługi Google.'),('Jak pracować bez AI','Offline/mock zastępują interpretację i mapowanie parserem. Nie wyłączają same w sobie Supabase ani każdego trybu STT.'),('Jak przygotować demo bez internetu','Z internetem: python scripts/start-demo.py --build --reset. Kolejne próby: python scripts/start-demo.py --reset; adres 127.0.0.1:3002.')],note='Demo używa osobnej bazy i wyłącza zewnętrzne API AI. Szkice nie są wysyłane, mapa nie jest skanem AR, odczyt procedury nie rozlicza automatycznie opakowań.')
add('Pierwsza próba i najczęstsze problemy','Lista kontrolna',kind='table',rows=[['Sprawdzenie','Oczekiwany wynik / rozwiązanie'],['Konto i rola','Kierownik akceptuje nowego pracownika; worker nie widzi funkcji zarządzania.'],['Import i minima','Nazwy, jednostki, ilości i miejsca zgadzają się z arkuszem.'],['Karta zmiany','Przed confirm brak zmiany; po confirm nowy stan i audyt.'],['Brak lub szkic','Kolejka pokazuje propozycję; decyzja nie wysyła zamówienia.'],['Mikrofon / STT','Sprawdź zgodę, HTTPS i konfigurację; tekst pozostaje fallbackiem.'],['Telefon / sieć','LAN zamiast localhost; po zmianie .env zrestartuj Expo.'],['Nieaktualna karta / timeout','Wczytaj stan i historię, zanim ponowisz zapis.'],['Nietrwała baza','storage=ephemeral → skonfiguruj PostgreSQL.']],note='Przeprowadź pełną próbę z osobnym kontem pracownika i fizycznym telefonem. Eksport stanów nie zastępuje backupu bazy.')
add('Dokumentacja i następny krok','Materiały projektu',kind='closing',steps=[('Zacznij od krótkiej próby','Import → karta zmiany → zatwierdzenie → historia → szkic → mapa → procedura. Następnie przydziel zadanie pracownikowi.'),('Instrukcje w repozytorium','README.md: pełne uruchomienie i role. docs/mobile.md: telefon i tunel. docs/demo-offline.md: demo. docs/sample-warehouse-procedures.md: scenariusze.'),('Projekt i autorzy','MAGAZYNIER · HackYeah 2026 · Open Task ARTIFICIAL INTELLIGENCE. Kod: Apache 2.0. Historia autorów i wkładów w repozytorium GitHub.')],note='github.com/SlizDaniel/AiWARE',url='https://github.com/SlizDaniel/AiWARE')

slides[10]['steps']=slides[10]['steps'][:3]
slides[10]['note']='Zapisz ustawienia, aby zastosować zmiany. Aplikacja nie aktualizuje automatycznie pliku Excel.'
C=canvas.Canvas(str(OUT),pagesize=(W,H),pageCompression=1)
C.setTitle('MAGAZYNIER | Przewodnik użytkownika - web i mobile')
C.setAuthor('Zespół MAGAZYNIER')
C.setSubject('Rejestracja, konfiguracja i obsługa magazynu w aplikacji webowej i Expo')
layout=[]
def para(text,x,top,width,size=21,bold=False,color=INK,leading=None):
    style=ParagraphStyle('p',fontName='SegoeBold' if bold else 'Segoe',fontSize=size,leading=leading or size*1.35,textColor=HexColor(color),spaceAfter=0)
    p=Paragraph(text,style); _,h=p.wrap(width,H)
    assert top+h <= (H-18 if top>=650 else H-65), f'Text overflow on slide {C.getPageNumber()}: {text[:40]} {top+h}'
    p.drawOn(C,x,H-top-h)
    return h

def screenshot(name,x,top,bw,bh,crop=None):
    source=ASSETS/name
    iw,ih=Image.open(source).size
    cx,cy,cw,ch=crop or (0,0,iw,ih)
    assert 0<=cx and 0<=cy and cx+cw<=iw and cy+ch<=ih, (name,crop,(iw,ih))
    scale=min(bw/cw,bh/ch); dw,dh=cw*scale,ch*scale
    dx=x+(bw-dw)/2; dt=top+(bh-dh)/2; dy=H-dt-dh
    C.saveState(); clip=C.beginPath();clip.rect(dx,dy,dw,dh);C.clipPath(clip,stroke=0,fill=0)
    C.drawImage(str(source),dx-cx*scale,dy-(ih-cy-ch)*scale,width=iw*scale,height=ih*scale,mask='auto')
    C.restoreState()
    layout.append({'slide':C.getPageNumber(),'image':name,'crop':crop,'box':[dx,dt,dw,dh]})

for i,s in enumerate(slides,1):
    C.setFillColor(HexColor(BG));C.rect(0,0,W,H,fill=1,stroke=0)
    C.bookmarkPage('slide'+str(i));C.addOutlineEntry(s['title'],'slide'+str(i),level=0,closed=False)
    if s['kind']=='cover':
        para('MAGAZYNIER',66,154,850,66,True)
        para('Twój magazyn.<br/>Głos, wiedza i kontrola.',70,258,760,39,color=GREEN)
        para('Przewodnik krok po kroku<br/>Wersja webowa i aplikacja mobilna',72,412,770,24,color=MUTED)
        C.drawImage(str(ROOT/'public/brand/mascot.jpg'),940,237,width=240,height=240,mask='auto')
        para('HackYeah 2026 · Open Task ARTIFICIAL INTELLIGENCE',72,625,1000,18,color=MUTED)
    else:
        para(s['section'].upper(),64,32,1152,13,True,color=GREEN)
        para(s['title'],64,66,1152,36,True)
        C.setStrokeColor(HexColor(LINE));C.setLineWidth(.7);C.line(64,H-125,1216,H-125)
        kind=s['kind']
        if kind in ('screen','mobile'):
            if kind=='mobile':
                screenshot(s['image'],76,145,315,500,s['crop']); tx,tw=448,724
            else:
                screenshot(s['image'],64,148,715,493,s['crop']);tx,tw=832,376
            y=160
            for head,body in s['steps']:
                y+=para(escape(head),tx,y,tw,21,True)+8
                y+=para(escape(body),tx,y,tw,19,color=MUTED)+18
            caption='Expo Web · dane demo' if kind=='mobile' else 'Web · dane demo · fragment interfejsu'
            para(caption,76 if kind=='mobile' else 64,650,715,12,color=MUTED)
        elif kind in ('text','closing'):
            y=157
            for head,body in s['steps']:
                y+=para(escape(head),78,y,1120,24,True)+8
                y+=para(escape(body),78,y,1120,21,color=MUTED)+25
        elif kind=='code':
            code_x=66;code_y=163
            for line in s['code'].split('\n'):
                if line: para(escape(line),code_x,code_y,660,19,color=GREEN)
                code_y+=28
            y=163
            for head,body in s['steps']:
                y+=para(escape(head),790,y,420,22,True)+10
                y+=para(escape(body),790,y,420,20,color=MUTED)+25
        elif kind=='table':
            is_role=(i==7); is_compare=s['title'].startswith('Web i mobile')
            widths=[630,210,312] if is_role else ([580,230,342] if is_compare else [320,832])
            body_size=18 if len(s['rows'])>8 else 19
            data=[]
            for ri,row in enumerate(s['rows']):
                st=ParagraphStyle('cell',fontName='SegoeBold' if ri==0 else 'Segoe',fontSize=body_size,leading=body_size*1.24,textColor=HexColor('#FFFFFF' if ri==0 else INK))
                data.append([Paragraph(escape(v),st) for v in row])
            t=Table(data,colWidths=widths)
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor(GREEN)),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),11),('LINEBELOW',(0,1),(-1,-1),.5,HexColor(LINE))]))
            _,th=t.wrap(1152,500);assert th<=505,(i,th);t.drawOn(C,64,H-151-th)
        if s['note']:
            para(escape(s['note']),64,674,1130,12,color=MUTED,leading=14)
        if s.get('url'):
            C.linkURL(s['url'],(64,18,575,55),relative=0,thickness=0)
    C.setFillColor(HexColor(MUTED));C.setFont('Segoe',11)
    C.drawRightString(1216,14,f'{i:02d} / {len(slides):02d}')
    C.showPage()
C.save()
(ROOT/'presentation/slide-content.json').write_text(json.dumps(slides,ensure_ascii=False,indent=2),encoding='utf8')
(ROOT/'presentation/layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf8')
print(f'Created {OUT} | {len(slides)} pages')
