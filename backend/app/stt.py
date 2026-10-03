"""Karta 04 — STT: API zgodne z Whisper (np. Groq/OpenAI) → tekst po polsku.

Fallback od pierwszej godziny (PRD): brak klucza, brak sieci, timeout/limit
→ `STTUnavailable`; endpoint zamienia to na jawnie 503, a UI zostaje przy
polu tekstowym. Żadna zależność zewnętrzna nie może być jedyną drogą dema.
"""
import os

import httpx

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "whisper-large-v3"
REQUEST_TIMEOUT_S = 15.0
HINT = "wpisz komendę w polu tekstowym"


class STTUnavailable(Exception):
    """STT niedostępny (brak klucza, brak sieci, timeout/limit) — użyj pola tekstowego."""


def _fail(reason: str) -> STTUnavailable:
    return STTUnavailable(f"{reason} — {HINT}.")


def _env(name: str, default: str) -> str:
    # docker-compose przekazuje puste stringi, nie brak zmiennej — to samo co „nieustawione”
    return os.environ.get(name, "").strip() or default


def transcribe(data: bytes, filename: str) -> str:
    """Nagraj audio do API zgodnego z Whisper i zwróć transkrypcję (polski)."""
    api_key = os.environ.get("STT_API_KEY", "").strip()
    if not api_key:
        raise _fail("Brak klucza API STT (STT_API_KEY)")
    base_url = _env("STT_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    model = _env("STT_MODEL", DEFAULT_MODEL)

    try:
        response = httpx.post(
            f"{base_url}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": model, "language": "pl"},
            files={"file": (filename, data)},
            timeout=REQUEST_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        raise _fail(f"API STT nieosiągalne ({exc.__class__.__name__})") from exc

    if response.status_code == 401:
        raise _fail("API STT odrzuciło klucz (401) — sprawdź STT_API_KEY")
    if response.status_code == 429:
        raise _fail("Limit API STT wyczerpany (429)")
    if response.status_code != 200:
        raise _fail(f"API STT zwróciło błąd ({response.status_code})")

    text = str(response.json().get("text", "")).strip()
    if not text:
        raise _fail("API STT nie zwróciło tekstu")
    return text
