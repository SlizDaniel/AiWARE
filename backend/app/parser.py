"""Deterministyczny parser intencji (offline) — tracer bullet, karta 01.

Rozpoznaje WYŁĄCZNIE komendy:
  - „wzięliśmy paletę X"  → update_stock(X, -2 * liczba_palet)
  - „doszła paleta X"     → update_stock(X, +2 * liczba_palet)
gdzie „paleta" = 2 szt., a X musi pasować do pozycji z bazy (po stemple polskich
odmian, np. „kartonów" → „Kartony"). Wszystko inne → None (brak propozycji).

Ten sam kontrakt (tekst → wywołanie narzędzia) będzie później realizowany przez
LLM function-calling — patrz seam A/B w PRD.
"""
import re
from dataclasses import dataclass

from app.models import ItemRef

SZT_NA_PALETE = 2

_TAKE_RE = re.compile(r"wzi[ęe]liśmy", re.IGNORECASE)
_GOT_RE = re.compile(r"doszł[ayo]", re.IGNORECASE)  # doszła / doszły / doszło
_PALETTE_RE = re.compile(r"\bpalet", re.IGNORECASE)
_COUNT_RE = re.compile(
    r"\b(\d+|jedn\w*|jedn[ąa]|dw[oa]\w*|trzy|cztery|pięć)\s+palet", re.IGNORECASE
)
_WORD_COUNTS = {
    "jedn": 1,
    "dw": 2,
    "trzy": 3,
    "czter": 4,
    "pięć": 5,
}
_TOKEN_RE = re.compile(r"[a-ząćęłńóśźż0-9]+")


@dataclass(frozen=True)
class ParsedCommand:
    """Wynik mapowania intencji na narzędzie (tool call)."""

    tool: str  # zawsze "update_stock" w tracerze
    item_id: int
    item_name: str
    delta: int
    text: str

    @property
    def args(self) -> dict:
        """Oczekiwane wywołanie narzędzia: update_stock(item_id=..., delta=...)."""
        return {"item_id": self.item_id, "delta": self.delta}


def parse_command(text: str, items: list[ItemRef]) -> ParsedCommand | None:
    if not text:
        return None
    t = text.lower().strip()

    sign: int
    if _TAKE_RE.search(t):
        sign = -1
    elif _GOT_RE.search(t):
        sign = +1
    else:
        return None

    if not _PALETTE_RE.search(t):
        return None

    item = _find_item(t, items)
    if item is None:
        return None

    palety = _count_palets(t)
    return ParsedCommand(
        tool="update_stock",
        item_id=item.id,
        item_name=item.name,
        delta=sign * palety * SZT_NA_PALETE,
        text=text,
    )


def _count_palets(t: str) -> int:
    m = _COUNT_RE.search(t)
    if not m:
        return 1
    word = m.group(1)
    if word.isdigit():
        return int(word)
    for prefix, n in _WORD_COUNTS.items():
        if word.startswith(prefix):
            return n
    return 1


def _find_item(t: str, items: list[ItemRef]) -> ItemRef | None:
    """Dopasowanie towaru po stemplu: „Kartony" → „karton", „kartonów", „kartony"…"""
    best: tuple[int, ItemRef] | None = None
    for item in items:
        first_word = item.name.lower().split()[0]
        stem = first_word[: max(4, len(first_word) - 2)]
        for token in _TOKEN_RE.findall(t):
            if token.startswith(stem):
                if best is None or len(stem) > best[0]:
                    best = (len(stem), item)
                break
    return best[1] if best else None
