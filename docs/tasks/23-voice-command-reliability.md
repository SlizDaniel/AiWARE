# 23: Audyt i poprawa niezawodności głosu oraz intencji

**Owner:** A. **Branch:** `fix/voice-command-reliability`. **Baza:** `ef391f9`.

Użytkownik zlecił dokładny przegląd repo, poprawę znalezionych usterek ze szczególnym
uwzględnieniem LLM, prefiksu głosowego i dopasowania fraz do operacji magazynu.
Poprawki powstają na osobnym branchu. Każdy zapis nadal wymaga karty i potwierdzenia.

## Usterki i kryteria akceptacji

1. Parser liczył „dwie palety” jako jedną, a „1,5 palety” jako pięć. Ilości
   całkowite (cyfry i słowa 1–12) oraz palety/sztuki/rolki mają poprawny kierunek
   i wartość. Ułamki, zero, brak ilości i nieznany przelicznik wymagają pytania.
2. Dopasowanie tylko pierwszego słowa nazwy wybierało pierwszy wariant z bazy.
   Wszystkie wypowiedziane słowa muszą pasować. Dwa warianty → doprecyzowanie;
   odmiana „kartonów dużych” → „Kartony duże”; kod produktu wymaga dokładnego dopasowania.
3. Negacja i plan były interpretowane jako dokonane wydanie. Rozpoznane niepewne
   wypowiedzi wymagają doprecyzowania, także gdy model zwróci update_stock.
4. Poprawny JSON LLM nie gwarantował poprawnego towaru/ilości. Dla jednoznacznych
   poleceń obsługiwanych offline serwer porównuje ID i deltę z rozpoznaną frazą.
   Sprzeczność → clarify, bez propozycji i zapisu. Jawne rolki/sztuki muszą być
   zgodne z jednostką towaru. ID modelu musi występować w dostarczonym kontekście.
5. Limit 40 towarów pomijał podobnie brzmiący towar z dalszej części listy.
   Ograniczony ranking literówek poprawia dobór kontekstu; sam ranking nie wykonuje operacji.
6. „Tak” w wyniku pośrednim było wykonywane po 700 ms mimo możliwości późniejszej
   korekty STT. Wynik pośredni jest tylko podglądem. Wykonanie decyzji wymaga wyniku końcowego.
7. Kilka wyników pośrednich trafiało do jednego indeksu, dublując słowa po finalizacji.
   Każdy wynik zachowuje indeks, kolejność i czas początku. Bufor nadal czeka na
   końcowe segmenty i pauzę 1000 ms; nowy prefiks zastępuje niewysłaną komendę.
8. Bezpieczna alternatywa STT z identyczną treścią komendy może rozpoznać prefiks
   również w podglądzie. Dozwolone są dwa początkowe wypełniacze („no hej Magu”);
   nadal nie reagujemy na dowolne wystąpienie prefiksu w środku rozmowy.
9. Korekta nazwy uwzględnia ograniczoną odmianę, np. „półek” → „Bułki”. Istniejąca
   dokładna/odmieniona nazwa wygrywa; korekta wymaga wyraźnej przewagi i jest pokazana.
10. Dużo stref/procedur zużywało całe 600 znaków słownika STT. Osobne budżety
    zachowują miejsce na prefiks, towary i komendy domenowe.
11. Pomoc do zadań pomijała aktualne packing_rules. Pobiera pełne zatwierdzone
    reguły i starsze notatki; notatka o identycznym temacie produktu z aktualną
    regułą jest pomijana. Ujemny source ID oznacza regułę pakowania, dodatni
    notatkę. Opcjonalny kind identyfikuje źródło; UI pokazuje właściwą etykietę.
12. Niektóre API wywracały się po body `null` zamiast zwrócić 422. Wspólny reader
    wymaga obiektu JSON; parametry ID muszą być dodatnimi bezpiecznymi integerami.
13. Pythonowy check Gemini oczekiwał starego schematu procedur. Scenariusze
    uwzględniają nowy katalog opakowań, rolę, dwie palety, ułamek i błędną jednostkę.

## Zakres przeglądu

Przejrzano architekturę i istotne ścieżki aktywnego web/mobile: sesje i role,
API, parser i kontrakt narzędzi, transport Gemini i fallbacki, STT, Web Speech,
bufory PCM/komend, TTS, doprecyzowania, potwierdzenia i audyt, import/mapowanie,
mapę/PDR, zadania i źródła pomocy. `legacy/` jest archiwum, a materiały konkursowe
i grafiki nie są wykonywalną częścią aplikacji. Nie jest to formalny audyt bezpieczeństwa.

## Ograniczenia i kolejne kroki

- Odmiana i korekta nazw pozostają heurystyką, nie pełnym słownikiem polskim
  ani modelem akustycznym. Nowy podobny produkt nadal może być błędnie dopasowany.
- Paleta nadal oznacza demonstracyjne 2 jednostki. Do realnego magazynu potrzebne
  są zatwierdzone przeliczniki per towar, zamiast zgadywania z wypowiedzi.
- Kontrola znaczenia LLM dotyczy rozpoznanych wzorców; dowolna długa wypowiedź
  wymaga oceny modelu i sprawdzenia karty. Nie gwarantujemy pełnej walidacji semantycznej.
- Nasłuch mobilny nadal ma 6-sekundowe nagrania bez nakładania; fraza na granicy
  segmentu może być ucięta. Zmiana tego wymaga testów na telefonie i innego buforowania.
- Web Speech zależy od przeglądarki/usługi. Tolerancja prefiksu nie dowodzi jakości
  rozpoznawania rzeczywistego nagrania. Potrzebna próba z głosem zespołu i hałasem hali.
- Pomoc do zadań dobiera źródła leksykalnie, w ograniczonym budżecie. Ogólne notatki
  o innym temacie mogą wymagać ręcznego przeglądu po zmianie reguł.
- API nadal pobiera pełną listę zapasu przed ograniczeniem kontekstu. Dla dużych
  magazynów warto wdrożyć wyszukiwanie i paginację po stronie bazy.

## Weryfikacja

Regresje na istniejących seams: intencja → narzędzie, komenda → odpowiedź,
STT → tekst, decyzje i bufor wypowiedzi, zadanie → procedury, wejście HTTP.
Transporty chmurowe w testach są kontrolowane; żadna próba fizycznym mikrofonem
ani pomiar prawdziwego Gemini nie jest przedstawiana jako wykonana.
Wyniki końcowe zostaną uzupełnione po testach, buildzie, GUI i review.
