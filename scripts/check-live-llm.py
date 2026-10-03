"""Task 03: exercise a real provider with synthetic inventory, without database writes."""
import argparse
import asyncio
import os
from pathlib import Path
import sys

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.agent_contract import normalize_call, tool_schemas
from app.llm import LLMProviderError, provider_from_env
from app.models import ItemRef

SAMPLES = (
    ("Z półki zabraliśmy cztery sztuki folii stretch.", "update_stock", {"item_id": 3, "delta": -4}),
    ("Podaj mi aktualną liczbę kartonów w magazynie.", "get_stock", {"item_id": 1}),
    ("W którym miejscu znajdę szkło?", "get_location", {"item_id": 2}),
)
ITEMS = [ItemRef(id=1, name="Kartony"), ItemRef(id=2, name="Szkło"), ItemRef(id=3, name="Folia stretch")]
CONTEXT = (
    "Dane syntetyczne do próby: id=1 Kartony, ilość=13, minimum=12, lokalizacja=Strefa A-1; "
    "id=2 Szkło, ilość=20, minimum=8, lokalizacja=Strefa B-2; "
    "id=3 Folia stretch, ilość=15, minimum=6, lokalizacja=Strefa C-1. Jedna paleta to 2 jednostki."
)


async def check() -> int:
    matched = 0
    clarifications = 0
    try:
        provider = provider_from_env()
        for index, (text, expected_tool, expected_args) in enumerate(SAMPLES, start=1):
            result = await provider.interpret(text, tool_schemas(), CONTEXT)
            if result.tool_call is not None:
                parsed = normalize_call(result.tool_call, text, ITEMS)
                if parsed.tool != expected_tool or parsed.args != expected_args:
                    raise LLMProviderError(f"Sample {index}: tool or arguments do not match the expected intent")
                matched += 1
                print(f"{index}/3: matched intent — {parsed.tool}")
            elif result.clarification:
                clarifications += 1
                print(f"{index}/3: clarification returned; review it in the application GUI")
            else:
                raise LLMProviderError("Provider returned neither a call nor a clarification")
    except LLMProviderError as exc:
        print(f"Live LLM check FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"{matched} matched tool calls; {clarifications} clarifications require manual review.")
    print("No tools executed; no database opened. Still required: confirm the full command/card flow in the application GUI.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=REPO / ".env")
    args = parser.parse_args()
    load_dotenv(args.env_file, override=False)
    if os.environ.get("DEMO_MODE", "0").strip().lower() in {"1", "true", "yes", "on"}:
        print("Demo offline is enabled. Disable DEMO_MODE explicitly before a live API check.", file=sys.stderr)
        return 2
    if not os.environ.get("LLM_API_KEY", "").strip():
        print("Missing LLM_API_KEY. Configure it locally in .env or the environment; do not paste it into chat.", file=sys.stderr)
        return 2
    return asyncio.run(check())


if __name__ == "__main__":
    raise SystemExit(main())
