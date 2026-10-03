"""Tests without cloud requests, keys or database access."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('check_gemini', Path(__file__).with_name('check-gemini.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class GeminiReadinessTests(unittest.TestCase):
    def test_correct_tool_and_arguments_pass(self):
        case = checker.CASES[0]
        self.assertEqual(checker.assess(case, {'kind': 'call', 'tool': case['tool'], 'args': case['args']})['status'], 'pass')

    def test_valid_schema_but_wrong_intent_fails(self):
        case = checker.CASES[0]
        for args in [{'item_id': 3, 'delta': 4}, {'item_id': 1, 'delta': -4}, {'item_id': 3, 'delta': True}]:
            self.assertEqual(checker.assess(case, {'kind': 'call', 'tool': 'update_stock', 'args': args})['status'], 'fail')
        self.assertEqual(checker.assess(case, {'kind': 'call', 'tool': 'get_stock', 'args': {}})['status'], 'fail')

    def test_clarification_requires_review_not_a_false_pass(self):
        result = checker.assess(checker.CASES[0], {'kind': 'clarification'})
        self.assertEqual(result['status'], 'review')
        self.assertEqual(checker.exit_code([result]), 3)
        unclear = next(case for case in checker.CASES if case['tool'] is None)
        self.assertEqual(checker.assess(unclear, {'kind': 'call', 'tool': 'update_stock', 'args': {'item_id': 1, 'delta': -1}})['status'], 'fail')

    def test_errors_override_review_and_unknown_protocol_is_error(self):
        case = checker.CASES[0]
        for payload in [{}, {'kind': 'error'}, {'kind': 'unexpected'}, {'kind': 'call'}]:
            self.assertEqual(checker.assess(case, payload)['status'], 'error')
        self.assertEqual(checker.exit_code([{'status': 'review'}, {'status': 'error'}]), 1)
        self.assertEqual(checker.exit_code([{'status': 'pass'}]), 0)

    def test_results_do_not_echo_model_text_or_secrets(self):
        result = checker.assess(checker.CASES[0], {'kind': 'error', 'message': 'private-api-key'})
        self.assertNotIn('private-api-key', json.dumps(result))

    def test_environment_precedence_and_only_provider_variables(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.env'
            path.write_text('GEMINI_API_KEY="file-key"\nGEMINI_MODEL=model\nDATABASE_URL=private\n', encoding='utf-8')
            env = checker.load_environment([path], {'GEMINI_API_KEY': 'system-key'})
        self.assertEqual(env['GEMINI_API_KEY'], 'system-key')
        self.assertEqual(env['GEMINI_MODEL'], 'model')
        self.assertNotIn('DATABASE_URL', env)

    def test_list_does_not_load_env_or_run_bridge(self):
        with patch.object(checker, 'load_environment') as load, patch.object(checker, 'run_bridge') as run, patch('builtins.print'):
            self.assertEqual(checker.main(['--list']), 0)
        load.assert_not_called()
        run.assert_not_called()

    def test_no_key_and_demo_refuse_cloud(self):
        with patch.object(checker, 'run_bridge') as run, patch('builtins.print'):
            for env in [{}, {'GEMINI_API_KEY': 'fake', 'DEMO_MODE': '1'}, {'GOOGLE_API_KEY': 'fake', 'DEMO_MODE': ' true '}]:
                with patch.object(checker, 'load_environment', return_value=env):
                    self.assertEqual(checker.main([]), 2)
        run.assert_not_called()

    def test_bridge_timeout_and_bad_json_are_sanitized(self):
        case = checker.CASES[0]
        with patch.object(checker.shutil, 'which', return_value='node'), patch.object(checker.subprocess, 'run', side_effect=subprocess.TimeoutExpired('private-key', 30)):
            self.assertEqual(checker.run_bridge(case, {})['kind'], 'error')
        with patch.object(checker.shutil, 'which', return_value='node'), patch.object(checker.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, 'private-key', 'secret')):
            self.assertNotIn('private-key', json.dumps(checker.run_bridge(case, {})))

    def test_child_environment_excludes_database_and_other_secrets(self):
        env = checker.bridge_environment({'GEMINI_API_KEY': 'fake', 'PATH': 'node-path', 'SYSTEMROOT': 'Windows',
                                          'DATABASE_URL': 'private-db', 'SUPABASE_SECRET_KEY': 'private', 'NODE_OPTIONS': 'injected'})
        self.assertEqual(env, {'GEMINI_API_KEY': 'fake', 'PATH': 'node-path', 'SYSTEMROOT': 'Windows'})

    def test_subset_and_json_report(self):
        case = checker.CASES[0]
        payload = {'kind': 'call', 'tool': case['tool'], 'args': case['args']}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'report.json'
            with patch.object(checker, 'load_environment', return_value={'GEMINI_API_KEY': 'fake'}), patch.object(checker, 'run_bridge', return_value=payload) as run, patch('builtins.print'):
                code = checker.main(['--case', case['id'], '--report', str(output)])
            report = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(code, 0)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(report['counts']['pass'], 1)
        self.assertEqual(report['results'][0]['id'], case['id'])
        self.assertNotIn('fake', json.dumps(report))


if __name__ == '__main__':
    unittest.main()
