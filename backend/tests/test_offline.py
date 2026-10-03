"""Ścieżka offline (karta 02): moduły agenta nie importują bibliotek sieciowych.

Demo awaryjne działa z wyłączonym dostępem do internetu — parser, rejestr narzędzi
i baza mają zero wywołań sieciowych; jedyny dopuszczalny „sieciowy” moduł to sama
fastapi (serwer HTTP), która nie wykonuje żadnych połączeń wychodzących.
"""
import ast
import pathlib

BANNED_ROOTS = {"httpx", "requests", "urllib", "socket", "aiohttp", "websockets", "ftplib", "smtplib"}
MODULES = ["app/db.py", "app/parser.py", "app/tools.py", "app/main.py"]


def test_agent_modules_have_no_network_imports():
    root = pathlib.Path(__file__).resolve().parents[1]
    for rel in MODULES:
        tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                roots = [(node.module or "").split(".")[0]] if node.level == 0 else []
            else:
                continue
            used = [r for r in roots if r in BANNED_ROOTS]
            assert not used, f"{rel}: ścieżka offline nie może importować {used}"
