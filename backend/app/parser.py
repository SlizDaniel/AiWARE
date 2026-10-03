"""Deterministyczny parser intencji (offline) — karta 02.

Mapuje komendy demo na wywołania narzędzi — bez internetu, bez LLM
(to gwarantowana ścieżka dema awaryjnego, PRD: MockAgent/offline-parser):
  - „wzięliśmy paletę X"  → update_stock(X, -2 * liczba_palet)
  - „doszła paleta X"     → update_stock(X, +2 * liczba_palet)
  - „strefa: X"           → add_zone(X)
  - „ile mamy [X]?"       → get_stock(X)   / get_stock() dla całego magazynu
  - „gdzie leży X?"       → get_location(X)
  - „jak pakujemy X?"     → recall_procedure(X)
  - „zapamiętaj: X …"     → remember_procedure(X, …)  (sugestia z clarify przy braku procedury)

„paleta" = 2 szt., a X musi pasować do pozycji z bazy (po stemplach polskich
odmian, np. „kartonów" → „Kartony"). Gdy intencja jest znana, ale towaru nie ma
w bazie, parser ZWRACA intencję z `missing_item` (API proponuje dodanie /
prosi o doprecyzowanie — nigdy nie zgaduje po cichu). Wszystko inne → None.

Ten sam kontrakt (tekst → wywołanie narzędzia) realizuje LLM function-calling —
patrz seam 2 w PRD.
"""
import re
from dataclasses import dataclass, field

from app.models import ItemRef

SZT_NA_PALETE = 2

_TAKE_RE = re.compile(r"wzi[ęe]liśmy", re.IGNORECASE)
_GOT_RE = re.compile(r"doszł[ayo]", re.IGNORECASE)  # doszła / doszły / doszło
_PALETTE_RE = re.compile(r"\bpalet\w*", re.IGNORECASE)
_AFTER_PALETTE_RE = re.compile(r"\bpalet\w*\s+(.+?)\s*[?.!]*\s*$", re.IGNORECASE)
_COUNT_RE = re.compile(
    r"\b(\d+|jedn\w*|dw[oa]\w*|trzy|cztery|pięć)\s+palet", re.IGNORECASE
)
_WORD_COUNTS = {"jedn": 1, "dw": 2, "trzy": 3, "czter": 4, "pięć": 5}
_TOKEN_RE = re.compile(r"[a-ząćęłńóśźż0-9]+")

_ZONE_RE = re.compile(r"\bstrefa\s*:\s*(.+?)\s*[?.!]*\s*$", re.IGNORECASE)
_REMEMBER_RE = re.compile(r"\bzapamiętaj\s*:\s*(.+?)\s*[?.!]*\s*$", re.IGNORECASE)
_HOW_MANY_RE = re.compile(r"\bile\s+mamy(?:\s+(.+?))?\s*[?.!]*\s*$", re.IGNORECASE)
_WHERE_RE = re.compile(r"\bgdzie\s+leż\w*\s+(.+?)\s*[?.!]*\s*$", re.IGNORECASE)
_HOW_PACK_RE = re.compile(r"\bjak\s+(?:się\s+)?pakuj\w*\s+(.+?)\s*[?.!]*\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class ParsedCommand:
    """Wynik mapowania intencji na narzędzie (tool call)."""

    tool: str
    text: str
    args: dict = field(default_factory=dict)
    item_id: int | None = None
    item_name: str | None = None
    missing_item: str | None = None  # rozpoznany towar, którego nie ma w bazie

    @property
    def delta(self) -> int:
        """Delta stanu (dla narzędzi update_stock; 0 dla pozostałych)."""
        return int(self.args.get("delta", 0))


def parse_command(text: str, items: list[ItemRef]) -> ParsedCommand | None:
    if not text:
        return None
    t = text.lower().strip()

    zone = _ZONE_RE.search(t)
    if zone:
        name = zone.group(1).strip()
        return ParsedCommand(tool="add_zone", text=text, args={"name": name}) if name else None

    remember = _REMEMBER_RE.search(t)
    if remember:
        # treść procedury w ORYGINALNEJ wersji (regex na niezmienionym tekście),
        # żeby „kartony Y, strefa C2” nie zapisowało się zmalauprawnionymi literami
        orig = _REMEMBER_RE.search(text.strip()) or remember
        fragment = orig.group(1).strip()
        # temat = pierwszy token frazy („zapamiętaj: szkło pakujemy w…” → „szkło”),
        # treść = cała fraza; recall i tak szuka też po fragmencie treści
        tokens = _TOKEN_RE.findall(fragment)
        return (
            ParsedCommand(
                tool="remember_procedure",
                text=text,
                args={"topic": tokens[0].lower(), "text": fragment},
            )
            if tokens
            else None
        )

    how_many = _HOW_MANY_RE.search(t)
    where = _WHERE_RE.search(t)
    how_pack = _HOW_PACK_RE.search(t)

    sign: int
    if _TAKE_RE.search(t):
        sign = -1
        if not _PALETTE_RE.search(t):
            return None
    elif _GOT_RE.search(t):
        sign = +1
        if not _PALETTE_RE.search(t):
            return None
    elif how_pack:
        topic = how_pack.group(1).strip()
        return ParsedCommand(tool="recall_procedure", text=text, args={"topic": topic}) if topic else None
    elif where:
        return _query_intent("get_location", where.group(1).strip(), t, items, text)
    elif how_many:
        fragment = (how_many.group(1) or "").strip()
        return _query_intent("get_stock", fragment, t, items, text)
    else:
        return None

    # intencje update_stock: towar z bazy albo missing_item (bez args wykonania)
    item = _find_item(t, items)
    if item is not None:
        return ParsedCommand(
            tool="update_stock",
            text=text,
            args={"item_id": item.id, "delta": sign * _count_palets(t) * SZT_NA_PALETE},
            item_id=item.id,
            item_name=item.name,
        )
    after = _AFTER_PALETTE_RE.search(t)
    missing = after.group(1).strip() if after else None
    return ParsedCommand(tool="update_stock", text=text, missing_item=missing)


def _query_intent(tool: str, fragment: str, t: str, items: list[ItemRef], text: str) -> ParsedCommand:
    """Pytania o stan/lokalizację: z towarem, bez towaru (cały magazyn) albo missing_item."""
    if not fragment:
        return ParsedCommand(tool=tool, text=text, args={})
    item = _find_item(fragment, items) or _find_item(t, items)
    if item is not None:
        return ParsedCommand(tool=tool, text=text, args={"item_id": item.id}, item_id=item.id, item_name=item.name)
    return ParsedCommand(tool=tool, text=text, missing_item=fragment)


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
    """Dopasowanie towaru po stemplach: „Kartony" → „karton", „kartonów", „kartony"…"""
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
