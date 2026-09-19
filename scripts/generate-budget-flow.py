"""Read-only adapter for the independent reference ZIP. Never runs or writes V1/V2 pipelines."""
import argparse, collections, gzip, hashlib, json, pathlib, zipfile

FIELDS = ('accountType', 'ministry', 'organization', 'specialAccount', 'subAccount', 'agency', 'sectionCode', 'sectionName')

def key(row):
    return tuple(row.get(k, '') for k in FIELDS)

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()[:20]

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as f:
        f.write(gzip.compress(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))

def build(archive, root, output):
    archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as z:
        def rows(name):
            with z.open(name) as f:
                for line in f:
                    yield json.loads(line)
        manifest = {r['path']: r for r in json.loads(z.read('source-manifest.json'))['files']}
        for year in (2024, 2025):
            records = {r['recordId']: r for r in rows(f'normalized/mof/fy{year}/budget-items.jsonl')}
            entities = {}
            record_entity = {}
            for r in records.values():
                k = key(r)
                eid = digest([year, k])
                record_entity[r['recordId']] = eid
                if eid not in entities:
                    entities[eid] = dict(zip(FIELDS, k), id=eid, fiscalYear=year, sourceYear=year,
                        identityMethod='exact-scope-code-name', rawKeys=set(), stages=set(), events={}, records={}, relations=[], links=[], comparisons=[])
                e = entities[eid]
                e['rawKeys'].add(r['sectionNaturalKey'])
                e['stages'].add(r['phase'])
                e['records'][r['recordId']] = {k: r.get(k) for k in ('recordId', 'itemNaturalKey', 'sectionNaturalKey', 'phase', 'budgetStatus', 'revision', 'sourceAmountColumn', 'source')}
            event_count = 0
            totals = collections.Counter()
            for ev in rows(f'derived/mof/fy{year}/budget-events.jsonl'):
                event_count += 1
                eid = digest([year, key(ev)])
                e = entities[eid]
                ids = ev['sourceRecordIds']
                assert all(i in records for i in ids), 'Dangling provenance'
                typ = ev['eventType']
                status = ev.get('budgetStatus', '')
                rev = ev.get('revision')
                ek = json.dumps([typ, status, rev])
                group = e['events'].setdefault(ek, dict(eventType=typ, budgetStatus=status, revision=rev, amountYen=0, evidence=[]))
                amount = ev['amountYen']
                assert isinstance(amount, int) and abs(amount) < 2**53
                group['amountYen'] += amount
                group['evidence'].append(dict(eventId=ev['eventId'], amountYen=amount, itemName=ev['subItemName'], sourceRecordIds=ids))
                totals[typ, status, rev] += amount
                # Amendments may refer to raw records whose code changed; preserve both sources.
                for rid in ids:
                    if rid not in e['records']:
                        r = records[rid]
                        e['records'][rid] = {k: r.get(k) for k in ('recordId', 'itemNaturalKey', 'sectionNaturalKey', 'phase', 'budgetStatus', 'revision', 'sourceAmountColumn', 'source')}
            for relation in rows(f'derived/mof/fy{year}/identity-relations.jsonl'):
                involved = set(record_entity[i] for i in relation['sourceRecordIds'] + relation['targetRecordIds'])
                if relation['relationType'] != 'same_item' or len(involved) > 1:
                    for eid in involved:
                        entities[eid]['relations'].append(dict(relation, entityIds=sorted(involved)))
            for sy in (2024, 2025):
                path = f'derived/links/mof-rs-review-{sy}-fy{year}.jsonl'
                if path not in z.namelist():
                    continue
                for link in rows(path):
                    involved = set(record_entity[i] for i in link['mofRecordIds'])
                    for eid in involved:
                        entities[eid]['links'].append(dict(link, sourceYear=link['reviewYear'], spansEntities=len(involved)>1))
            v1path = root / f'public/data/mof-budget-{year}.json.gz'
            v1 = json.loads(gzip.decompress(v1path.read_bytes()))
            v1groups = collections.defaultdict(list)
            for section in v1['sections']:
                v1groups[key(section)].append(section)
            phases = {'当初予算': ('initial_budget_state', 'enacted'), '決算': ('settlement_budget_appropriation', '')}
            for e in entities.values():
                for s in v1groups[key(e)]:
                    if s['budgetType'] not in phases:
                        continue
                    typ, status = phases[s['budgetType']]
                    g = e['events'].get(json.dumps([typ, status, None]))
                    if g:
                        e['comparisons'].append(dict(budgetType=s['budgetType'], eventType=typ, v1Amount=s['amount'], v2Amount=g['amountYen'], differenceYen=g['amountYen']-s['amount'], v1Id=s['id']))
            shards = collections.defaultdict(dict)
            index = []
            for eid, e in sorted(entities.items()):
                e['events'] = list(e['events'].values())
                e['rawKeys'] = sorted(e['rawKeys'])
                e['stages'] = sorted(e['stages'])
                used_paths = {r['source']['path'] for r in e['records'].values()}
                e['sources'] = {p: manifest[p] for p in sorted(used_paths)}
                e['records'] = list(e['records'].values())
                assert all(abs(g['amountYen']) < 2**53 for g in e['events'])
                shards[eid[0]][eid] = e
                index.append({k: e[k] for k in (*FIELDS, 'id', 'fiscalYear', 'sourceYear', 'stages')} | dict(eventCount=sum(len(g['evidence']) for g in e['events']), relationCount=len(e['relations'])))
            # Verify the state equation without mixing snapshots with adjustments.
            checked = 0
            for e in entities.values():
                bytype = {g['eventType']: g['amountYen'] for g in e['events']}
                if 'current_budget_state' in bytype:
                    assert bytype['current_budget_state'] == sum(bytype[t] for t in ('spent','carryover_out','unused'))
                    checked += 1
            for shard, data in shards.items():
                write(output / str(year) / f'{shard}.json.gz', data)
            info = dict(schemaVersion=1, fiscalYear=year, sourceYear=year, archiveSha256=archive_hash,
                v1File=f'public/data/mof-budget-{year}.json.gz', v1Sha256=hashlib.sha256(v1path.read_bytes()).hexdigest(),
                eventCount=event_count, recordCount=len(records), settlementChecks=checked,
                totals=[dict(eventType=t, budgetStatus=s, revision=r, amountYen=a) for (t,s,r),a in totals.items()], entities=index)
            write(output / f'{year}.json.gz', info)
            print(f'FY{year}: {len(index)} entities, {event_count} events, {checked} settlement equations PASS')

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=pathlib.Path, default=pathlib.Path('.'))
    p.add_argument('--archive', type=pathlib.Path)
    p.add_argument('--output', type=pathlib.Path)
    a = p.parse_args()
    build(a.archive or a.root/'data/pipeline-v2-full-output.zip', a.root, a.output or a.root/'public/budget-flow-v2')
