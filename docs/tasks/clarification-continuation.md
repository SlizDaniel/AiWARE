# Kontynuacja doprecyzowań i rodziny towarów

Branch: `codex/fix-voice-command-end`.

Problem: po dopycie („Pasuje kilka produktów…”) następna wypowiedź była traktowana
jak nowa komenda — trzeba było powtarzać całość. Osobna pozycja „Kartony” była
po cichu wybierana także przy istnieniu „Kartony duże”/„Kartony małe”.

## Zachowanie

- Niepewny towar (rodzina z wariantami albo kilka dopasowań) → dopyt z listą opcji
  i podpowiedzią „Dopowiedz różnicę, np. „duże””, zamiast cichego wyboru.
- Krótkie dopowiedzenie („duże”, „małe”) domyka oczekującą komendę:
  `runCommand` skleja pierwszą wypowiedź tury z odpowiedzią (zdejmując prefiks
  wake word) i parsuje offline — bez LLM, bez dodatkowego kosztu. Pełna nowa
  komenda ma pierwszeństwo; „nie/anuluj/stop/…” czyści kontekst (typ `unknown`).
- Dopowiedzenia ilości („10”) nadal prowadzi LLM z kontekstem
  `pending_clarification` — deterministyczny merge ich celowo nie łapie.
- Dokładna (nieodmieniona) nazwa towaru nie dopytuje; odmieniona prowadzka
  rodziny („kartonów” przy „Kartony/Kartony duże/małe”) — tak.
- Tryb LLM: niepewność parsera offline (rodzina) wygrywa z wyborem modelu dla
  narzędzi odczytu (`READ_TOOLS`) — dopyt zamiast odpowiedzi o wybrany wariant.
- Fast-path głosu (`extractInventoryQuestion`) nie wybiera wariantu, którego
  nie wypowiedziano, ani rodziny po odmianie; dokładna nazwa odpowiada od razu.

## Mercury / Gemini

Bez zmian w stacku AI: `DecisionHybridProvider` (mercury-decide:free → Gemini
fallback) przyszedł z main i jest podpięty w `/api/command`. Weryfikacja live
(2026-10-04): `inception/mercury-decide:free` odpowiada 200 na
`openrouter.ai/api/alpha/decisions`, `cost: 0` — modelu nie ma w publicznej
liście `/models`, dlatego nie wolno go sprawdzać po tej liście.

## Weryfikacja

`tsc --noEmit` czyste; 958 testów w 53 plikach zielonych (2 skip). Nowe testy:
rodzina w parserze (dopyt z opcjami, dokładna nazwa, dopowiedzenie wariantu),
kontynuacja w `commands` („duże” → karta zmiany „Kartony duże”, „małe” → odczyt
stanu, „nie” → porzucenie, pełna nowa komenda ma pierwszeństwo, guard LLM),
`inventoryFamily` oraz fast-path (odmieniona rodzina → null, dokładna nazwa → OK).

GUI-check (2026-10-04, `next dev` :3001, izolowana baza, tryb LLM z
mercury-decide→Gemini): dodanie „Kartony duże”/„Kartony małe” przez LLM
z kartami zmian; „wzięliśmy paletę kartonów” → dopyt „Pasuje kilka produktów:
„Kartony”, „Kartony duże”, „Kartony małe”. Dopowiedz różnicę…”; samo „duże” →
karta „Kartony duże 10→8” z historią „wzięliśmy paletę kartonów → duże”; zapis
potwierdzony (8 szt w tabeli); „ile mamy kartonów” → dopyt; „małe” → odpowiedź
„Kartony małe: 4 szt (minimum 0)”. Fizycznego mikrofonu nie testowano.
