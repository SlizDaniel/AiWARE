"""Load fictional packing procedures into local offline demo through proposal + confirm API."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SAMPLES = Path(__file__).resolve().parents[1] / "data-samples/warehouse-procedures.json"


def local_demo_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Use a local demo URL such as http://127.0.0.1:3002")
    return value.rstrip("/")


def request_json(base: str, path: str, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(base + path, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"API returned HTTP {error.code}; use an offline demo with manager access.") from error


def is_unchanged_demo_rule(rule: dict) -> bool:
    return (rule.get("updated_by") == "Demo — reguła wzorcowa" and rule.get("notes") == "Owiń folią i dodaj przekładki."
            and rule.get("topic") == "Szkło" and rule.get("packaging_name") == "Duży karton" and rule.get("quantity_per_package") == 1)


def load_samples(base: str, samples: list[dict], request=request_json) -> dict[str, int]:
    base = local_demo_url(base)
    health = request(base, "/api/health")
    if health.get("demo_mode") is not True or health.get("auth_mode") != "disabled":
        raise ValueError("This loader only writes to the isolated offline demo, never the regular warehouse.")
    items = {item["name"].casefold(): item for item in request(base, "/api/stock")["items"]}
    packaging = {item["name"].casefold(): item for item in request(base, "/api/packaging")["packaging"]}
    existing = {rule["item_id"]: rule for rule in request(base, "/api/procedures")["procedures"]}
    result = {"saved": 0, "unchanged": 0, "preserved": 0, "missing": 0}
    for sample in samples:
        item, package = items.get(sample["item"].casefold()), packaging.get(sample["packaging"].casefold())
        if not item or not package:
            result["missing"] += 1
            continue
        before = existing.get(item["id"])
        body = {"item_id": item["id"], "packaging_id": package["id"],
                "quantity_per_package": sample["quantity_per_package"], "notes": sample["notes"],
                "expected_version": before["version"] if before else 0}
        if before and all(before.get(key) == body[key] for key in ("packaging_id", "quantity_per_package", "notes")):
            result["unchanged"] += 1
            continue
        if before and not is_unchanged_demo_rule(before):
            result["preserved"] += 1
            continue
        proposal = request(base, "/api/procedures", body)["proposal"]
        request(base, f"/api/proposals/{proposal['id']}/confirm", {})
        result["saved"] += 1
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:3002")
    args = parser.parse_args(argv)
    try:
        result = load_samples(args.url, json.loads(SAMPLES.read_text(encoding="utf-8")))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f"Could not load sample procedures: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
