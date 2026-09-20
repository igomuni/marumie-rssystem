"""PRODUCTS adapter: reference normalized RS + derived links -> Budget Flow.
Never mutates SOURCE/NORMALIZED/DERIVED or the existing MOF/V1 products.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import runpy
import zipfile

mof = runpy.run_path(str(pathlib.Path(__file__).with_name('generate-budget-flow.py')))
METRICS = ('initialBudgetYen', 'currentBudgetYen', 'executionYen', 'nextYearRequestYen')


def consolidate(rows):
    """Repeated project totals are snapshots, not additive account breakdowns."""
    result = {}
    for field in METRICS:
        values = {r[field] for r in rows if r.get(field) is not None}
        if any(not isinstance(v, int) or abs(v) >= 2**53 for v in values):
            raise ValueError(f'Unsafe integer: {field}')
        if len(values) > 1:
            raise ValueError(f'Conflicting project totals: {rows[0]["projectId"]} {field}: {values}')
        result[field] = next(iter(values), None)
    request_years = {r['requestFiscalYear'] for r in rows if r['requestFiscalYear'] is not None}
    if len(request_years) > 1:
        raise ValueError('Conflicting request fiscal years')
    return dict(result, fiscalYear=rows[0]['fiscalYear'], requestFiscalYear=next(iter(request_years), None),
                evidence=[{k: r[k] for k in ('recordId', 'source')} for r in rows])


def build(archive, output):
    archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as z:
        def rows(name):
            return [json.loads(line) for line in z.open(name)]
        manifest = {r['path']: r for r in json.loads(z.read('source-manifest.json'))['files']}
        review_years = sorted({int(n.split('/')[2][7:]) for n in z.namelist()
                               if n.startswith('normalized/rs/review-') and n.endswith('/projects.jsonl')})
        mof_records = {}
        for name in z.namelist():
            if name.startswith('normalized/mof/fy') and name.endswith('/budget-items.jsonl'):
                year = int(name.split('/')[2][2:])
                for r in rows(name):
                    mof_records[r['recordId']] = dict(id=mof['digest']([year, mof['key'](r)]), fiscalYear=year,
                                                     **{k: r[k] for k in mof['FIELDS']})
        reports = []
        for year in review_years:
            base = f'normalized/rs/review-{year}'
            org_rows = rows(f'{base}/projects.jsonl')
            projects = {}
            for r in org_rows:
                assert r['reviewYear'] == year
                pid = r['projectId']
                p = projects.setdefault(pid, dict(id=f'{year}:{pid}', projectId=pid, reviewYear=year,
                    projectName=r['projectName'], organizations=[], budgets=[], accountsByYear={}, links=[], organizationRows=[]))
                assert p['projectName'] == r['projectName'], f'Conflicting names: {pid}'
                p['organizationRows'].append(r)
                p['organizations'].extend(v for v in (r['ministry'], r['bureau']) if v)
            totals = collections.defaultdict(list)
            for r in rows(f'{base}/budget-summary.jsonl'):
                assert r['reviewYear'] == year and r['projectId'] in projects
                if r['scopeLevel'] == 'project_total':
                    totals[r['projectId'], r['fiscalYear']].append(r)
            for (pid, fy), records in sorted(totals.items()):
                projects[pid]['budgets'].append(consolidate(records))
            for r in rows(f'{base}/budget-items.jsonl'):
                assert r['reviewYear'] == year and r['projectId'] in projects
                values = projects[r['projectId']]['accountsByYear'].setdefault(str(r['fiscalYear']), set())
                if r['accountType']:
                    values.add(r['accountType'])
            coverage = []
            source_link_count = 0
            for name in sorted(z.namelist()):
                if not name.startswith(f'derived/links/mof-rs-review-{year}-fy') or not name.endswith('.jsonl'):
                    continue
                fy = int(name.rsplit('fy', 1)[1].split('.')[0])
                coverage.append(fy)
                for link in rows(name):
                    assert link['reviewYear'] == year and link['fiscalYear'] == fy
                    source_link_count += 1
                    entities = {mof_records[rid]['id']: mof_records[rid] for rid in link['mofRecordIds']}
                    assert all(e['fiscalYear'] == fy for e in entities.values())
                    for pid in link['projectIds']:
                        assert pid in projects, f'Dangling project: {year}:{pid}'
                        projects[pid]['links'].append({k: link[k] for k in ('linkId', 'fiscalYear', 'phase', 'revision', 'matchMethod', 'rsRecordIds', 'mofRecordIds')} | dict(entities=list(entities.values())))
            index, shards = [], collections.defaultdict(dict)
            for pid, p in sorted(projects.items(), key=lambda x: int(x[0])):
                p['organizations'] = sorted(set(p['organizations']))
                p['accountsByYear'] = {fy: sorted(values) for fy, values in sorted(p['accountsByYear'].items())}
                p['shard'] = hashlib.sha256(p['id'].encode()).hexdigest()[0]
                source_paths = {r['source']['path'] for r in p['organizationRows']}
                source_paths.update(e['source']['path'] for b in p['budgets'] for e in b['evidence'])
                p['sources'] = {path: manifest[path] for path in sorted(source_paths)}
                summary = {k: p[k] for k in ('id', 'projectId', 'reviewYear', 'projectName', 'organizations', 'accountsByYear', 'shard')}
                summary['budgets'] = [{k: v for k, v in b.items() if k != 'evidence'} for b in p['budgets']]
                summary['connections'] = [dict(fiscalYear=fy, entityCount=len({e['id'] for l in p['links'] if l['fiscalYear'] == fy for e in l['entities']})) for fy in coverage]
                index.append(summary)
                shards[p['shard']][p['id']] = p
            fiscal_years = sorted({b['fiscalYear'] for p in index for b in p['budgets']} | {int(fy) for p in index for fy in p['accountsByYear']})
            linked = sum(bool(p['links']) for p in projects.values())
            report = dict(reviewYear=year, organizationRows=len(org_rows), projects=len(index), linked=linked,
                unlinked=len(index)-linked, linkGroups=source_link_count, duplicateTotalGroups=sum(len(v)>1 for v in totals.values()),
                byFiscalYear=[dict(fiscalYear=fy, linked=sum(any(l['fiscalYear']==fy for l in p['links']) for p in projects.values()),
                    unlinked=sum(not any(l['fiscalYear']==fy for l in p['links']) for p in projects.values())) for fy in coverage])
            reports.append(report)
            mof['write'](output/f'{year}.json.gz', dict(schemaVersion=1, reviewYear=year, archiveSha256=archive_hash,
                fiscalYears=fiscal_years, linkFiscalYears=coverage, summary=report, projects=index))
            for shard, data in shards.items():
                mof['write'](output/str(year)/f'{shard}.json.gz', data)
            print(json.dumps(report, ensure_ascii=False))
        mof['write'](output/'manifest.json.gz', dict(schemaVersion=1, reviewYears=review_years, summaries=reports, archiveSha256=archive_hash))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=pathlib.Path, default=pathlib.Path('data/pipeline-v2-full-output.zip'))
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('public/budget-flow-v2/rs'))
    args = parser.parse_args()
    build(args.archive, args.output)
