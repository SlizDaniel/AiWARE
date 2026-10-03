# 03: LLMProvider z function calling (chmura) + przełącznik trybu

**What to build:** Za kontraktem z karty 02 stoi teraz prawdziwy LLM z function calling: dowolne polskie zdanie o pracy na hali mapuje się na narzędzia (nie tylko 6 komend demo). Przełącznik w konfiguracji/env wybiera tryb: `llm` (domyślny) / `offline` (parser z karty 02) / `mock` (karta 13). Odpowiedzi LLM przechodzą walidację schematu — zła odpowiedź modelu = fallback na parser + komunikat na ekranie, nigdy crash.

**Blocked by:** 02 (kontrakt + rejestr narzędzi)

**Estimate:** 1 / 2

**Owner:** A

**TDD:** ten sam seam co karta 02, rozszerzony o fixtury „trudnych" sformułowań („odeszliśmy do Bratysławy 3 palety z Jasiem", „przenieś kartony do strefy C2") — walidacja, że odpowiedź LLM jest poprawnym wywołaniem narzędzia lub czytelnym pytaniem zwrotnym; test walidacji schematu odrzuca śmieciowy JSON.

**Demo check:** ustawić tryb `llm`, wpisać 3 naturalne zdania niebędące komendami demo (np. „zabrakło nam opakowań, wzięliśmy 4 opakowania folii") — agent mapuje na narzędzie lub pyta; przełączyć na `offline` — wciąż działa 6 komend.

**Status:** implemented and verified locally on `feature/llm-function-calling` — all registry tools are exposed to the LLM; reads return answers, writes require confirmation, invalid calls fall back offline. Backend tests and frontend build pass. Provider behavior is verified with controlled API responses; a live-cloud demo check still requires an API key.

**Integration contract for card 02:** the registry passes OpenAI-compatible function schemas to `LLMProvider.interpret(text, tools, context)`. The result is `Interpretation(tool_call=ToolCall(name, arguments))` or `Interpretation(clarification=...)`. The provider rejects unknown tool names, malformed JSON, missing required values, and arguments with the wrong JSON types. The command layer still validates that item IDs exist and only creates a proposal; writes happen after user confirmation.

- [x] klucz API z .env, brak klucza = automatyczny start w trybie offline z ostrzeżeniem na ekranie
- [ ] dowolne zdanie mapuje się na narzędzie lub generuje pytanie zwrotne na karcie
- [x] walidacja odpowiedzi LLM; śmieć → fallback na parser, UI żyje
- [x] przełączanie trybów konfiguracją, bez restartu dema

The remaining unchecked natural-language criterion needs the live-cloud demo check.

Walidacja sprawdza też zakończenie generacji: obecne `finish_reason` musi być
`stop` lub `tool_calls`; ucięcie, filtr, brak zakończenia i odmowa modelu powodują
fallback offline, nawet gdy argumenty wyglądają jak poprawny JSON. Dla endpointów
zgodnych z OpenAI pomijających to pole zachowano walidację schematu. Żadna z tych
odpowiedzi nie wykonuje narzędzia przed potwierdzeniem.
