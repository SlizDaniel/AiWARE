"""Sprawdź intencje Gemini na syntetycznych danych, bez wykonywania narzędzi.

Python odpowiada za scenariusze, ocenę i raport. Adapter TypeScript wykorzystuje
produkcyjny provider i walidator aplikacji, żeby nie tworzyć ich drugiej wersji.
Kody wyjścia: 0 zgodne intencje, 1 błędy, 2 konfiguracja, 3 ręczna ocena pytań.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[1]
ENV_NAMES = {'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_MODEL', 'DEMO_MODE'}
ITEMS = [{'id': 1, 'name': 'Kartony'}, {'id': 2, 'name': 'Szkło'}, {'id': 3, 'name': 'Folia stretch'}]
CONTEXT = (
    'Syntetyczny magazyn: id=1 Kartony, ilość=13, minimum=12, strefa A-1; '
    'id=2 Szkło, ilość=20, minimum=8, strefa B-2; '
    'id=3 Folia stretch, ilość=15, minimum=6, strefa C-1. '
    'Jedna paleta = 2 jednostki. Procedura: szkło pakujemy w piankę. '
    'Nie ma innych towarów. Nie zakładaj ilości, których użytkownik nie podał.'
)

# Każdy scenariusz definiuje konkretną intencję, nie tylko poprawny JSON.
# tool=None oznacza, że model powinien zapytać zamiast zgadywać zapis.
CASES = [
    {'id': 'withdrawal', 'text': 'Z półki zabraliśmy cztery sztuki folii stretch.', 'tool': 'update_stock', 'args': {'item_id': 3, 'delta': -4}},
    {'id': 'receipt', 'text': 'Przyjęliśmy pięć sztuk szkła.', 'tool': 'update_stock', 'args': {'item_id': 2, 'delta': 5}},
    {'id': 'pallets', 'text': 'Wzięliśmy trzy palety kartonów.', 'tool': 'update_stock', 'args': {'item_id': 1, 'delta': -6}},
    {'id': 'stock', 'text': 'Podaj aktualną liczbę kartonów.', 'tool': 'get_stock', 'args': {'item_id': 1}},
    {'id': 'location', 'text': 'W którym miejscu znajdę szkło?', 'tool': 'get_location', 'args': {'item_id': 2}},
    {'id': 'reorder', 'text': 'Sprawdź, czy kartony są poniżej minimum.', 'tool': 'check_reorder', 'args': {'item_id': 1}},
    {'id': 'draft', 'text': 'Przygotuj szkic zamówienia na 50 sztuk kartonów.', 'tool': 'draft_order', 'args': {'item_id': 1, 'quantity': 50}},
    {'id': 'procedure', 'text': 'Jak pakujemy szkło?', 'tool': 'recall_procedure', 'args': {'topic': 'szkło'}},
    {'id': 'remember-procedure', 'text': 'Zapisz procedurę. Temat: szkło. Treść: pakujemy w piankę.', 'tool': 'remember_procedure', 'args': {'topic': 'szkło', 'text': 'pakujemy w piankę'}},
    {'id': 'zone', 'text': 'Dodaj strefę o nazwie C2.', 'tool': 'add_zone', 'args': {'name': 'C2'}},
    {'id': 'speech-error', 'text': 'Wzięliśmy dwie sztuki kartonuw.', 'tool': 'update_stock', 'args': {'item_id': 1, 'delta': -2}},
    {'id': 'missing-quantity', 'text': 'Wzięliśmy kartony, ale nie wiem ile.', 'tool': None, 'args': {}},
    {'id': 'unknown-item', 'text': 'Zabraliśmy pięć sztuk nieznanego towaru.', 'tool': None, 'args': {}},
]


def load_environment(files: list[Path], inherited: dict[str, str]) -> dict[str, str]:
    """Środowisko systemowe ma pierwszeństwo; z plików pobieramy tylko pola LLM."""
    env = dict(inherited)
    for file in files:
        if not file.is_file():
            continue
        for line in file.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip().removeprefix('export ')
            name, separator, value = line.partition('=')
            name = name.strip()
            if separator and name in ENV_NAMES and name not in env:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                env[name] = value
    return env


def bridge_environment(env: dict[str, str]) -> dict[str, str]:
    """Adapter nie potrzebuje sekretów bazy ani Supabase; zostają pola LLM/systemu."""
    system_names = {'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
                    'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL'}
    return {key: value for key, value in env.items() if key in ENV_NAMES or key.upper() in system_names}


def run_bridge(case: dict, env: dict[str, str]) -> dict:
    """Jedno wywołanie interpretacji, bez callTool, bazy, proposal ani confirm."""
    node = shutil.which('node')
    bridge = REPO / 'scripts/gemini-readiness-bridge.ts'
    if not node:
        return {'kind': 'error'}
    payload = {'text': case['text'], 'context': CONTEXT, 'items': ITEMS}
    try:
        response = subprocess.run(
            [node, '--import', 'tsx', str(bridge), '--once'],
            input=json.dumps(payload, ensure_ascii=False), encoding='utf-8',
            capture_output=True, cwd=REPO, env=bridge_environment(env), timeout=35, check=False,
        )
        if response.returncode != 0 or len(response.stdout) > 65536:
            return {'kind': 'error'}
        result = json.loads(response.stdout)
        return result if isinstance(result, dict) else {'kind': 'error'}
    except (OSError, subprocess.TimeoutExpired, ValueError, UnicodeError):
        # Nigdy nie wypisuj stderr, exception ani surowych odpowiedzi providera.
        return {'kind': 'error'}


def same_arguments(actual: dict, expected: dict) -> bool:
    """Liczby porównujemy dokładnie; tekst po trim/casefold, bez zmiany intencji."""
    if actual.keys() != expected.keys():
        return False
    for key, value in expected.items():
        received = actual[key]
        if isinstance(value, str):
            if not isinstance(received, str) or received.strip().casefold() != value.strip().casefold():
                return False
        elif isinstance(received, bool) or received != value:
            return False
    return True


def assess(case: dict, payload: dict) -> dict:
    """Raport zawiera nasze etykiety, nigdy tekst/argumenty zwrócone przez model."""
    result = {'id': case['id'], 'expected_tool': case['tool']}
    kind = payload.get('kind')
    if kind == 'clarification':
        result.update(status='review', reason='Pytanie wymaga oceny w GUI; nie potwierdza rozumienia intencji.')
    elif kind == 'call' and isinstance(payload.get('tool'), str) and isinstance(payload.get('args'), dict):
        matched = case['tool'] is not None and payload['tool'] == case['tool'] and same_arguments(payload['args'], case['args'])
        result.update(status='pass' if matched else 'fail', reason='Zgodna intencja.' if matched else 'Narzędzie lub argumenty nie odpowiadają intencji.')
    else:
        result.update(status='error', reason='Błąd providera, walidacji, konfiguracji adaptera lub transportu.')
    return result


def exit_code(results: list[dict]) -> int:
    if any(row['status'] in {'error', 'fail'} for row in results):
        return 1
    return 3 if any(row['status'] == 'review' for row in results) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true', help='Pokaż scenariusze bez czytania env i bez sieci')
    parser.add_argument('--case', action='append', choices=[case['id'] for case in CASES], help='Wybrany scenariusz; można powtórzyć')
    parser.add_argument('--env-file', type=Path, help='Lokalny plik zamiast .env.local/.env')
    parser.add_argument('--report', type=Path, help='Zapisz bezpieczny raport JSON')
    args = parser.parse_args(argv)
    cases = [case for case in CASES if not args.case or case['id'] in args.case]
    if args.list:
        for case in cases:
            print(f"{case['id']}: {case['text']} -> {case['tool'] or 'pytanie'}")
        return 0
    try:
        if args.env_file and not args.env_file.is_file():
            print('Nie ma wskazanego pliku środowiska.')
            return 2
        files = [args.env_file] if args.env_file else [REPO / '.env.local', REPO / '.env']
        env = load_environment(files, dict(os.environ))
    except (OSError, UnicodeError):
        print('Nie udało się odczytać lokalnej konfiguracji.')
        return 2
    if env.get('DEMO_MODE', '').strip().lower() in {'1', 'true', 'yes', 'on'}:
        print('DEMO_MODE jest włączony. Wyłącz go przed sprawdzeniem chmury.')
        return 2
    if not any(env.get(name, '').strip() for name in ('GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY')):
        print('Brak klucza Gemini. Skonfiguruj go lokalnie; nie wklejaj klucza do czatu.')
        return 2
    print(f'Próba {len(cases)} scenariuszy: rzeczywiste żądania do Gemini, mogą zużyć limit API.')
    results = []
    for case in cases:
        started = time.monotonic()
        row = assess(case, run_bridge(case, env))
        row['duration_ms'] = round((time.monotonic() - started) * 1000)
        results.append(row)
        print(f"{row['id']}: {row['status'].upper()} — {row['reason']}")
        if row['status'] == 'error':
            break  # Nie powtarzaj kosztownych żądań po błędzie klucza/limitu/sieci.
    counts = {status: sum(row['status'] == status for row in results) for status in ('pass', 'review', 'fail', 'error')}
    report = {'selected': len(cases), 'completed': len(results), 'not_run': len(cases) - len(results), 'counts': counts, 'results': results}
    print(f"Wynik: {counts}. Niewykonane: {report['not_run']}. Baza nie została otwarta; narzędzia nie zostały wykonane.")
    if args.report:
        try:
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        except OSError:
            print('Nie udało się zapisać raportu JSON.')
            return 2
    return exit_code(results)


if __name__ == '__main__':
    # Czytelne polskie znaki również w przekierowanym wyjściu Windows.
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
