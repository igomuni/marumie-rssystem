#!/usr/bin/env python3
"""明細表 DETAIL 行 ↔ MOF budget-jikou の exact 突合の測定（P0-A、事前登録どおり。read-only）。

  python3 -I scripts/research/measure-detail-table-mof-jikou-exact.py [MOF normalized fy2024 dir]

J0=名称の exact 一致、J1=所管＋名称の exact 一致。正規化・部分一致・金額・親子復元は使わない。標準出力は JSON。
"""
import collections, csv, glob, hashlib, json, os, re, sys

D = 'data/work/budget-request-csv/2024/detail-table/sources/'
M = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024')
# 入力 provenance guard（分析条件ではない。実際に使った入力の bytes を固定する）
FROZEN_JIKOU_SHA = 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e'
FROZEN_MANIFEST_SHA = '7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e'
MANIFEST = 'data/work/budget-request-csv/2024/detail-table/output-manifest.json'


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def verify_inputs():
    if sha(f'{M}/budget-jikou.jsonl') != FROZEN_JIKOU_SHA: sys.exit('STOP: budget-jikou.jsonl SHA-256 mismatch')
    if sha(MANIFEST) != FROZEN_MANIFEST_SHA: sys.exit('STOP: output-manifest.json SHA-256 mismatch')
    man = json.load(open(MANIFEST, encoding='utf-8'))
    files = sorted(glob.glob(D + '*.csv'))
    actual = {os.path.relpath(f, os.path.dirname(MANIFEST)) for f in files}
    listed = {k for k in man if k.startswith('sources/') and k.endswith('.csv')}
    if actual != listed: sys.exit(f'STOP: sources/*.csv set differs from manifest (missing={sorted(listed - actual)}, extra={sorted(actual - listed)})')
    for f in files:
        key = os.path.relpath(f, os.path.dirname(MANIFEST))
        if key not in man: sys.exit(f'STOP: {key} not in manifest')
        if sha(f) != man[key]: sys.exit(f'STOP: {key} SHA-256 differs from manifest')
    return len(files)


HY = '[‑-]'
DET = re.compile(rf'^([0-9]{{2}}){HY}([0-9]{{2}}) (.*)$')
MIN = re.compile(r'^[0-9]{2}\s+(.+?)所管')


def cls(n): return '0 (unmatched)' if n == 0 else ('1 (single)' if n == 1 else '2+ (multi)')


def main():
    print(f'input hashes verified: {verify_inputs()} source CSVs + manifest + budget-jikou', file=sys.stderr)
    J = [json.loads(l) for l in open(f'{M}/budget-jikou.jsonl', encoding='utf-8')]
    by_name = collections.defaultdict(list); by_min_name = collections.defaultdict(list)
    for i, j in enumerate(J):
        by_name[j['jikouName']].append(i); by_min_name[(j['ministry'], j['jikouName'])].append(i)
    rows = []
    for f in sorted(glob.glob(D + '*.csv')):
        R = list(csv.DictReader(open(f, encoding='utf-8')))
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        if ctx is None: scope, ministry = 'context unavailable (no CONTEXT row)', None
        elif re.match(r'^[0-9]{4}\s', ctx): scope, ministry = 'out-of-scope (会計 CONTEXT)', None
        else:
            m = MIN.match(ctx)
            scope, ministry = ('eligible', m.group(1)) if m else ('context unavailable (ministry not extractable)', None)
        for r in R:
            if r['row_type'] != 'DETAIL': continue
            m = DET.match(r['事項'])
            if not m: rows.append({'scope': scope, 'parsed': False}); continue
            rows.append({'scope': scope, 'parsed': True, 'ministry': ministry, 'suffix': m.group(2), 'name': m.group(3), 'ctx': ctx})
    out = {'detail_rows': len(rows), 'unparsed_detail_rows': sum(1 for r in rows if not r['parsed']), 'scope_counts': dict(collections.Counter(r['scope'] for r in rows))}
    P = [r for r in rows if r['parsed']]
    j0 = collections.defaultdict(collections.Counter)
    for r in P: j0[r['scope']][cls(len(by_name.get(r['name'], [])))] += 1
    out['J0_name_only'] = {k: dict(v) for k, v in sorted(j0.items())}
    E = [r for r in P if r['scope'] == 'eligible']
    j1, j1min, k3, hit = collections.Counter(), collections.defaultdict(collections.Counter), collections.Counter(), collections.defaultdict(set)
    for n, r in enumerate(E):
        c = by_min_name.get((r['ministry'], r['name']), [])
        j1[cls(len(c))] += 1; j1min[r['ministry']][cls(len(c))] += 1
        for i in c: hit[i].add(n)
        if len(c) == 1: k3['suffix == col4Raw' if r['suffix'] == J[c[0]]['col4Raw'] else 'suffix != col4Raw'] += 1
    out['J1_ministry_and_name_eligible'] = {'rows': len(E), 'classes': dict(j1), 'by_ministry': {k: dict(v) for k, v in sorted(j1min.items())}}
    out['K3_structural_diagnostic_on_J1_single'] = dict(k3)
    rev, revmin = collections.Counter(), collections.defaultdict(collections.Counter)
    for i, j in enumerate(J):
        k = 'no DETAIL candidate' if i not in hit else ('1 DETAIL row' if len(hit[i]) == 1 else '2+ DETAIL rows')
        rev[k] += 1; revmin[j['ministry']][k] += 1
    out['reverse_coverage_J1'] = {'jikou_rows': len(J), 'classes': dict(rev), 'by_ministry': {k: dict(v) for k, v in sorted(revmin.items())}}
    out['descriptive'] = {'jikouName_with_whitespace': sum(1 for j in J if re.search(r'\s', j['jikouName'])),
                          'detail_ministries_extracted': sorted({r['ministry'] for r in E}), 'mof_ministries': sorted({j['ministry'] for j in J})}
    print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))


main()
