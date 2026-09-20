"""Unit checks and independent full-archive verification of the RS product."""
import collections
import gzip
import hashlib
import json
import pathlib
import runpy
import unittest
import zipfile
import os

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADAPTER = runpy.run_path(str(ROOT/'scripts/generate-budget-flow-rs.py'))

class ConsolidationTest(unittest.TestCase):
    def test_no_double_count_and_preserve_null_zero(self):
        row = dict(projectId='1', fiscalYear=2024, requestFiscalYear=2025, recordId='a', source={},
                   initialBudgetYen=0, currentBudgetYen=10, executionYen=None, nextYearRequestYen=None)
        blank = dict(row, recordId='b', initialBudgetYen=None, currentBudgetYen=None)
        value = ADAPTER['consolidate']([row, blank, row])
        self.assertEqual(value['initialBudgetYen'], 0)
        self.assertEqual(value['currentBudgetYen'], 10)
        self.assertIsNone(value['executionYen'])
        self.assertEqual(len(value['evidence']), 3)
        with self.assertRaises(ValueError):
            ADAPTER['consolidate']([row, dict(row, currentBudgetYen=11)])

    def test_full_product_matches_normalized_and_derived(self):
        archive = pathlib.Path(os.environ.get('BUDGET_FLOW_ARCHIVE', ROOT/'data/pipeline-v2-full-output.zip'))
        if not archive.exists():
            self.skipTest('Set BUDGET_FLOW_ARCHIVE to verify generated data against the source ZIP')
        with zipfile.ZipFile(archive) as z:
            def rows(n): return [json.loads(l) for l in z.open(n)]
            def product(n): return json.loads(gzip.decompress((ROOT/'public/budget-flow-v2/rs'/n).read_bytes()))
            manifest = product('manifest.json.gz')
            self.assertEqual(manifest['archiveSha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
            # Independently reproduce record->entity mapping from published MOF evidence,
            # avoiding the generator's key/digest implementation.
            record_entities = collections.defaultdict(set)
            for fy in (2024,2025):
                for path in (ROOT/f'public/budget-flow-v2/{fy}').glob('*.gz'):
                    for eid,e in json.loads(gzip.decompress(path.read_bytes())).items():
                        for r in e['records']:
                            # Extra amendment provenance can belong to a related entity;
                            # only use records that share this entity's raw section key.
                            if r['sectionNaturalKey'] in e['rawKeys']:
                                record_entities[r['recordId']].add((fy,eid))
            for year in manifest['reviewYears']:
                index = product(f'{year}.json.gz')
                originals = rows(f'normalized/rs/review-{year}/projects.jsonl')
                expected_ids = {r['projectId'] for r in originals}
                self.assertEqual({p['projectId'] for p in index['projects']}, expected_ids)
                self.assertEqual(len(index['projects']), len(expected_ids))
                details = {}
                for shard in {p['shard'] for p in index['projects']}:
                    details.update(product(f'{year}/{shard}.json.gz'))
                self.assertEqual(set(details), {p['id'] for p in index['projects']})
                expected_links = collections.defaultdict(dict)
                for name in z.namelist():
                    if name.startswith(f'derived/links/mof-rs-review-{year}-') and name.endswith('.jsonl'):
                        for l in rows(name):
                            for pid in l['projectIds']: expected_links[pid][l['linkId']] = l
                totals = collections.defaultdict(list)
                for r in rows(f'normalized/rs/review-{year}/budget-summary.jsonl'):
                    if r['scopeLevel']=='project_total': totals[r['projectId'],r['fiscalYear']].append(r)
                for p in index['projects']:
                    d = details[p['id']]
                    self.assertEqual(p['id'], f'{year}:{p["projectId"]}')
                    self.assertEqual({l['linkId'] for l in d['links']}, set(expected_links[p['projectId']]))
                    for link in d['links']:
                        original = expected_links[p['projectId']][link['linkId']]
                        for field in ('fiscalYear','phase','revision','matchMethod','rsRecordIds','mofRecordIds'):
                            self.assertEqual(link[field],original[field])
                        expected_entities = set().union(*(record_entities[r] for r in original['mofRecordIds']))
                        self.assertEqual({(e['fiscalYear'],e['id']) for e in link['entities']},expected_entities)
                    for c in p['connections']:
                        self.assertEqual(c['entityCount'],len({e['id'] for l in d['links'] if l['fiscalYear']==c['fiscalYear'] for e in l['entities']}))
                    for b in d['budgets']:
                        original = totals[p['projectId'],b['fiscalYear']]
                        self.assertEqual({e['recordId'] for e in b['evidence']},{r['recordId'] for r in original})
                        for field in ADAPTER['METRICS']:
                            vals = {r[field] for r in original if r[field] is not None}
                            self.assertEqual(b[field],next(iter(vals),None))
                print(f'RS {year}: {len(expected_ids)} projects, full population / budgets / bidirectional links PASS')

if __name__ == '__main__': unittest.main()
