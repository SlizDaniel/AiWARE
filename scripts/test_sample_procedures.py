import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sample_procedures', Path(__file__).with_name('load-sample-procedures.py'))
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)

class SampleProceduresTests(unittest.TestCase):
    def setUp(self):
        self.samples = json.loads(loader.SAMPLES.read_text(encoding='utf-8'))
        self.calls = []
        self.rules = []
        self.health = {'demo_mode': True, 'auth_mode': 'disabled'}
    def request(self, base, path, body=None):
        self.calls.append((path, body))
        if path == '/api/health': return self.health
        if path == '/api/stock': return {'items': [{'id': i+1, 'name': row['item']} for i,row in enumerate(self.samples)]}
        if path == '/api/packaging': return {'packaging': [{'id': i+10, 'name': row['packaging']} for i,row in enumerate(self.samples)]}
        if path == '/api/procedures' and body is None: return {'procedures': self.rules}
        if path == '/api/procedures': return {'proposal': {'id': 'test-proposal'}}
        if path == '/api/proposals/test-proposal/confirm': return {'ok': True}
        raise AssertionError(path)
    def load(self): return loader.load_samples('http://127.0.0.1:3002', self.samples, self.request)
    def test_samples_use_existing_products_and_fit_notes_limit(self):
        self.assertEqual(len(self.samples), 3)
        self.assertEqual(len({row['item'] for row in self.samples}), 3)
        for row in self.samples:
            self.assertLessEqual(len(row['notes']), 500)
            self.assertGreater(row['quantity_per_package'], 0)
            self.assertIn('DEMO:', row['notes'])
    def test_proposal_and_confirm_used_for_each_rule(self):
        self.assertEqual(self.load()['saved'], 3)
        writes = [(path,body) for path,body in self.calls if body is not None]
        self.assertEqual(len(writes), 6)
        self.assertEqual(writes[0][1]['expected_version'], 0)
        self.assertTrue(writes[1][0].endswith('/confirm'))
    def test_regular_or_authenticated_warehouse_never_written(self):
        for health in [{'demo_mode': False, 'auth_mode': 'disabled'}, {'demo_mode': True, 'auth_mode': 'supabase'}]:
            self.health = health
            self.calls = []
            with self.assertRaises(ValueError): self.load()
            self.assertEqual(len(self.calls), 1)
    def test_custom_rules_are_preserved(self):
        self.rules = [{'item_id': 1, 'version': 2, 'notes': 'Own instruction', 'updated_by': 'Manager'}]
        result = self.load()
        self.assertEqual(result['preserved'], 1)
        self.assertEqual(result['saved'], 2)
    def test_repeated_import_is_noop(self):
        self.rules = [{'item_id': i+1, 'packaging_id': i+10, 'quantity_per_package': row['quantity_per_package'],
                       'notes': row['notes'], 'version': 1} for i,row in enumerate(self.samples)]
        self.assertEqual(self.load()['unchanged'], 3)
        self.assertFalse(any(body is not None for path,body in self.calls))
    def test_only_unchanged_factory_glass_can_be_replaced(self):
        self.rules = [{'item_id': 1, 'version': 1, 'updated_by': 'Demo — reguła wzorcowa', 'notes': 'Owiń folią i dodaj przekładki.',
                       'topic': 'Szkło', 'packaging_name': 'Duży karton', 'quantity_per_package': 1}]
        self.assertEqual(self.load()['saved'], 3)
        writes = [body for path,body in self.calls if path == '/api/procedures' and body is not None]
        self.assertEqual(writes[0]['expected_version'], 1)
    def test_only_local_demo_urls_accepted(self):
        for url in ['https://example.com', 'http://example.com', 'http://localhost/api', 'http://user:pass@localhost', 'http://localhost?x=1']:
            with self.assertRaises(ValueError): loader.local_demo_url(url)

if __name__ == '__main__': unittest.main()
