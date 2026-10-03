"""Persistent owner settings in the inventory database."""
import json
import os
import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import db, stt


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prefix: str | None = None
    mode: Literal["llm", "offline", "mock"] | None = None
    adapter: Literal["sqlite", "file_import"] | None = None
    default_minimum: int | None = Field(default=None, ge=0, le=100000, strict=True)
    voice_mode: Literal["push_to_talk", "text"] | None = None

    @field_validator("*")
    @classmethod
    def not_null(cls, value):
        if value is None:
            raise ValueError("Ustawienie nie może być puste.")
        return value

    @field_validator("prefix")
    @classmethod
    def valid_prefix(cls, value: str | None) -> str:
        if value is None or not 2 <= len(value.strip()) <= 30 or not value.strip().isalpha():
            raise ValueError("Prefix musi być jednym słowem (2–30 liter).")
        return value.strip()


def init_settings(path: str, mode: str) -> None:
    with db.connect(path) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)")
        defaults = {"prefix": "Magu", "mode": mode, "retired_prefixes": [], "adapter": "sqlite", "default_minimum": 0, "voice_mode": "push_to_talk"}
        conn.execute("INSERT OR IGNORE INTO app_settings (id, value) VALUES (1, ?)", (json.dumps(defaults),))
        saved = json.loads(conn.execute("SELECT value FROM app_settings WHERE id = 1").fetchone()["value"])
        conn.execute("UPDATE app_settings SET value = ? WHERE id = 1", (json.dumps(defaults | saved),))


def read_settings(path: str) -> dict:
    with db.connect(path) as conn:
        return json.loads(conn.execute("SELECT value FROM app_settings WHERE id = 1").fetchone()["value"])


def update_settings(path: str, changes: dict) -> dict:
    with db.connect(path) as conn:
        current = json.loads(conn.execute("SELECT value FROM app_settings WHERE id = 1").fetchone()["value"])
        if "prefix" in changes and changes["prefix"].casefold() != current["prefix"].casefold():
            current["retired_prefixes"] = sorted(set(current["retired_prefixes"] + [current["prefix"]]))
        current.update(changes)
        conn.execute("UPDATE app_settings SET value = ? WHERE id = 1", (json.dumps(current),))
        return current


def command_text(text: str, config: dict) -> str | None:
    """Strip the current invocation; reject prefixes replaced by the owner."""
    for prefix in [config["prefix"], *config["retired_prefixes"]]:
        match = re.match(rf"^\s*{re.escape(prefix)}\b[\s,.:!—-]*", text, re.IGNORECASE)
        if match:
            return text[match.end():] if prefix == config["prefix"] else None
    return text


def ai_usage(config: dict, mode_status: dict) -> dict:
    llm_enabled = mode_status["effective_mode"] == "llm"
    stt_enabled = not mode_status["demo_mode"] and config["voice_mode"] == "push_to_talk" and bool(os.environ.get("STT_API_KEY", "").strip())
    llm_provider = urlsplit(os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")).hostname or "API zgodne z OpenAI"
    stt_provider = urlsplit(os.environ.get("STT_BASE_URL", "").strip() or stt.DEFAULT_BASE_URL).hostname or "API zgodne z Whisper"
    llm_model = os.environ.get("LLM_MODEL", "gpt-4o-mini")
    stt_model = os.environ.get("STT_MODEL", "").strip() or stt.DEFAULT_MODEL
    disclosure = (
        "MAGAZYNIER korzysta z AI do interpretacji poleceń i transkrypcji mowy. "
        f"Skonfigurowane integracje: LLM {llm_model} ({llm_provider}), STT {stt_model} ({stt_provider}). "
        f"W bieżącym trybie LLM {'jest aktywne' if llm_enabled else 'jest zastąpione parserem offline'}, "
        f"a STT {'jest dostępne po naciśnięciu mikrofonu' if stt_enabled else 'jest wyłączone lub nieskonfigurowane'}. "
        "Polecenia i nagrania są wysyłane do skonfigurowanych API tylko przy aktywnej integracji. "
        "Zmiany stanów wymagają zatwierdzenia przez człowieka i są zapisywane w audycie."
        " Przy tworzeniu projektu korzystaliśmy także z Codex/ChatGPT."
    )
    return {"llm_model": llm_model, "llm_provider": llm_provider, "llm_enabled": llm_enabled,
            "stt_model": stt_model, "stt_provider": stt_provider, "stt_enabled": stt_enabled, "disclosure": disclosure}
