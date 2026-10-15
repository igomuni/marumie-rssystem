#!/usr/bin/env python3
"""明細表 DETAIL 行から上方向に走査した項 X* と MOF の sectionName の exact 関係（X carry-forward、事前登録どおり。read-only）。

  python3 -I scripts/research/diagnose-detail-table-mof-x-carry-forward.py [MOF normalized fy2024 dir]

J1 は P0-A/P1 から変更しない。X* は診断で join には使わない。MOF の値は X* の探索に使わない。標準出力は JSON。
"""
import collections, csv, glob, hashlib, json, os, re, sys, unicodedata

D = 'tests/fixtures/budget-request-csv/2024/detail-table/sources/'
M = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024')
FROZEN_JIKOU_SHA = 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e'
FROZEN_MANIFEST_SHA = '7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e'
MANIFEST = 'tests/fixtures/budget-request-csv/2024/detail-table/output-manifest.json'
HY = '[‑-]'
DET = re.compile(rf'^([0-9]{{2}}){HY}([0-9]{{2}}) (.*)$')
MIN = re.compile(r'^[0-9]{2}\s+(.+?)所管')
FIELDS = ['organization', 'sectionCode', 'sectionName', 'col4Raw']
SEC = re.compile(r'^([0-9]{2,3}) (.+)$')


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
        if sha(f) != man[key]: sys.exit(f'STOP: {key} SHA-256 differs from manifest')
    return len(files)


def cls(n): return '0' if n == 0 else ('1' if n == 1 else '2+')


def bucket(d):
    return None if d is None else ('1' if d == 1 else '2' if d == 2 else '3-5' if d <= 5 else '6-20' if d <= 20 else '21+')


def main():
    print(f'input hashes verified: {verify_inputs()} source CSVs + manifest + budget-jikou', file=sys.stderr)
    J = [json.loads(l) for l in open(f'{M}/budget-jikou.jsonl', encoding='utf-8')]
    by_min_name = collections.defaultdict(list)
    for i, j in enumerate(J): by_min_name[(j['ministry'], j['jikouName'])].append(i)
    E = []
    for f in sorted(glob.glob(D + '*.csv')):
        R = list(csv.DictReader(open(f, encoding='utf-8')))
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        if ctx is None or re.match(r'^[0-9]{4}\s', ctx): continue
        m = MIN.match(ctx)
        if not m: continue
        for n, r in enumerate(R):
            if r['row_type'] != 'DETAIL': continue
            d = DET.match(r['事項'])
            if not d: continue
            X = dist = None; skipped = collections.Counter()
            for k in range(n - 1, -1, -1):
                t = R[k]['row_type']
                sk = SEC.match(R[k]['事項']) if t in ('CODE3', 'CODE2') else None
                if sk: X, dist = sk.group(2), n - k; break
                skipped[t if t in ('DETAIL', 'CODE_5_4_2_4', 'CODE_NN_NNNN') else ('CODE3/CODE2 (not NN[N] name)' if t in ('CODE3', 'CODE2') else 'other')] += 1
            E.append({'ministry': m.group(1), 'code': r['事項'][:5], 'suffix': d.group(2), 'name': d.group(3), 'X': X, 'dist': dist, 'skipped': skipped})
    out = {'eligible_rows': len(E)}
    for label, want in (('single_694', 1), ('multi_215', 2)):
        S = [(e, by_min_name.get((e['ministry'], e['name']), [])) for e in E]
        S = [(e, c) for e, c in S if (len(c) == 1 if want == 1 else len(c) > 1)]
        o = {'rows': len(S)}
        for part, sel in (('distance_1', lambda e: e['dist'] == 1), ('carry_distance_2plus', lambda e: e['dist'] is not None and e['dist'] > 1), ('no_X_star', lambda e: e['X'] is None)):
            P = [(e, c) for e, c in S if sel(e)]
            q = {'rows': len(P), 'distance_buckets': dict(sorted(collections.Counter(bucket(e['dist']) for e, _ in P).items(), key=lambda kv: str(kv[0]))),
                 'skipped_rows_by_type_total': dict(sorted(sum((e['skipped'] for e, _ in P), collections.Counter()).items())),
                 'rows_crossing_a_DETAIL': sum(1 for e, _ in P if e['skipped']['DETAIL'] > 0)}
            if want == 1:
                eq = collections.Counter(); ex = collections.defaultdict(list)
                for e, c in P:
                    ok = e['X'] is not None and J[c[0]]['sectionName'] == e['X']
                    eq[(bucket(e['dist']), 'sectionName == X*' if ok else 'sectionName != X*')] += 1
                    if not ok and e['X'] is not None and len(ex[bucket(e['dist'])]) < 5: ex[bucket(e['dist'])].append({'ministry': e['ministry'], 'code': e['code'], 'X*': e['X'], 'sectionName': J[c[0]]['sectionName']})
                q['match_by_distance'] = {f'{k[0]} | {k[1]}': v for k, v in sorted(eq.items(), key=lambda kv: (str(kv[0][0]), kv[0][1]))}
                q['mismatch_examples'] = dict(ex)
            else:
                a = collections.Counter(); k3 = collections.Counter(); ex = collections.defaultdict(list)
                for e, c in P:
                    h = [i for i in c if e['X'] is not None and J[i]['sectionName'] == e['X']]
                    a[(bucket(e['dist']), cls(len(h)))] += 1
                    if len(h) == 1: k3['col4Raw == suffix' if J[h[0]]['col4Raw'] == e['suffix'] else 'col4Raw != suffix'] += 1
                    if not h and e['X'] is not None and len(ex[bucket(e['dist'])]) < 5: ex[bucket(e['dist'])].append({'ministry': e['ministry'], 'code': e['code'], 'X*': e['X'], 'candidate_sectionNames': sorted({J[i]['sectionName'] for i in c})})
                q['candidates_with_sectionName_eq_X_star'] = {f'{k[0]} | {k[1]}': v for k, v in sorted(a.items(), key=lambda kv: (str(kv[0][0]), kv[0][1]))}
                q['single_vs_K3'] = dict(sorted(k3.items())); q['mismatch_examples'] = dict(ex)
            o[part] = q
        out[label] = o
    print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))


main()
