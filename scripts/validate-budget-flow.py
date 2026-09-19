"""Independent audit of every rendered event against the source ZIP."""
import collections, gzip, json, pathlib, zipfile

def load_unique(pairs):
    """dict(pairs) silently keeps only the last value on a duplicate key. Fail loudly instead,
    since a duplicate eventId/recordId/entity key here would mean the generator produced
    colliding identifiers that this audit must not paper over."""
    result = {}
    for key, value in pairs:
        assert key not in result, f'Duplicate identifier: {key!r}'
        result[key] = value
    return result

root = pathlib.Path(__file__).resolve().parent.parent
with zipfile.ZipFile(root/'data/pipeline-v2-full-output.zip') as z:
    for year in (2024, 2025):
        source = load_unique((r['eventId'], r) for line in z.open(f'derived/mof/fy{year}/budget-events.jsonl') if (r := json.loads(line)))
        raw = load_unique((r['recordId'], r) for line in z.open(f'normalized/mof/fy{year}/budget-items.jsonl') if (r := json.loads(line)))
        entities = load_unique((k, v) for f in (root/f'public/budget-flow-v2/{year}').glob('*.json.gz') for k, v in json.loads(gzip.decompress(f.read_bytes())).items())
        seen = set()
        zero_count = 0
        stages = collections.Counter()
        for e in entities.values():
            stages.update(e['stages'])
            records = {r['recordId']: r for r in e['records']}
            for rid, record in records.items():
                assert record['source'] == raw[rid]['source']
                assert record['itemNaturalKey'] == raw[rid]['itemNaturalKey']
            for g in e['events']:
                assert g['amountYen'] == sum(ev['amountYen'] for ev in g['evidence'])
                for ev in g['evidence']:
                    assert ev['eventId'] not in seen, 'Duplicate event'
                    seen.add(ev['eventId'])
                    original = source[ev['eventId']]
                    assert ev['amountYen'] == original['amountYen']
                    assert ev['sourceRecordIds'] == original['sourceRecordIds']
                    assert all(rid in records for rid in ev['sourceRecordIds'])
                    assert g['eventType'] == original['eventType']
                    assert g['budgetStatus'] == original.get('budgetStatus', '')
                    assert e['fiscalYear'] == original['fiscalYear']
                    zero_count += ev['amountYen'] == 0
            for l in e['links']:
                assert l['fiscalYear'] == year and l['sourceYear'] == l['reviewYear']
        assert seen == set(source), 'Missing events'
        assert zero_count == sum(ev['amountYen'] == 0 for ev in source.values())
        if year == 2024:
            assert stages == {'initial': 1056, 'supplement': 999, 'settlement': 1272}
            names = {(e['sectionCode'], e['sectionName']) for e in entities.values() if '東日本大震災' in e['specialAccount']}
            assert ('01','復興債費') in names and ('01','復興庁共通費') in names
        else:
            assert stages['settlement'] == 0
            assert any({'submitted','enacted'} <= {g['budgetStatus'] for g in e['events'] if g['eventType']=='initial_budget_state'} for e in entities.values())
        print(f'FY{year}: all {len(seen)} events and {zero_count} zero records preserved; provenance and year separation PASS')
