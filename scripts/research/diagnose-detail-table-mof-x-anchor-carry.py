#!/usr/bin/env python3
"""immediate X の無い DETAIL に、immediate X を持つ直近の先行 DETAIL（anchor）の項を持ち越した X_anchor と MOF の sectionName の exact 関係（development preregistration どおり。read-only）。

  python3 -I scripts/research/diagnose-detail-table-mof-x-anchor-carry.py [MOF normalized fy2024 dir]

J1 は P0-A/P1 から変更しない。X_anchor は診断で join には使わない。MOF の値は anchor の探索に使わない。development evidence であり confirmatory validation ではない。標準出力は JSON。
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


def b_det(n): return None if n is None else ('1' if n == 1 else '2' if n == 2 else '3-5' if n <= 5 else '6+')


def b_dist(n): return None if n is None else ('1-5' if n <= 5 else '6-20' if n <= 20 else '21-100' if n <= 100 else '101+')


def main():
    print(f'input hashes verified: {verify_inputs()} source CSVs + manifest + budget-jikou', file=sys.stderr)
    J = [json.loads(l) for l in open(f'{M}/budget-jikou.jsonl', encoding='utf-8')]
    by_min_name = collections.defaultdict(list)
    for i, j in enumerate(J): by_min_name[(j['ministry'], j['jikouName'])].append(i)

    def imm(R, n):
        if n and R[n - 1]['row_type'] in ('CODE3', 'CODE2'):
            sm = SEC.match(R[n - 1]['事項'])
            if sm: return sm.group(2)
        return None

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
            e = {'ministry': m.group(1), 'code': r['事項'][:5], 'suffix': d.group(2), 'name': d.group(3), 'immediate': imm(R, n) is not None,
                 'Xa': None, 'ndet': None, 'dist': None, 'between': collections.Counter(), 'between_sections': 0}
            if not e['immediate']:
                ndet = 0
                for k in range(n - 1, -1, -1):
                    if R[k]['row_type'] != 'DETAIL': continue
                    ndet += 1
                    x = imm(R, k)
                    if x is not None:
                        e['Xa'], e['ndet'], e['dist'] = x, ndet, n - (k - 1)
                        for q in range(k, n):
                            t = R[q]['row_type']
                            e['between'][t if t in ('DETAIL', 'CODE_5_4_2_4', 'CODE_NN_NNNN', 'CODE3', 'CODE2') else 'other'] += 1
                            if t in ('CODE3', 'CODE2') and SEC.match(R[q]['事項']): e['between_sections'] += 1
                        break
            E.append(e)
    out = {'eligible_rows': len(E)}
    for label, want in (('single_220_development', 1), ('multi_121_development', 2)):
        S = [(e, by_min_name.get((e['ministry'], e['name']), [])) for e in E]
        S = [(e, c) for e, c in S if not e['immediate'] and (len(c) == 1 if want == 1 else len(c) > 1)]
        o = {'rows': len(S), 'anchor_found': sum(1 for e, _ in S if e['Xa'] is not None), 'anchor_not_found': sum(1 for e, _ in S if e['Xa'] is None),
             'anchor_DETAIL_count': dict(sorted(collections.Counter(b_det(e['ndet']) for e, _ in S).items(), key=lambda kv: str(kv[0]))),
             'anchor_row_distance': dict(sorted(collections.Counter(b_dist(e['dist']) for e, _ in S).items(), key=lambda kv: str(kv[0]))),
             'rows_between_by_type_total': dict(sorted(sum((e['between'] for e, _ in S), collections.Counter()).items())),
             'section_like_rows_between_total': sum(e['between_sections'] for e, _ in S)}
        res = collections.Counter(); bymin = collections.defaultdict(collections.Counter); ex = collections.defaultdict(list); k3 = collections.Counter()
        for e, c in S:
            b = b_det(e['ndet'])
            if want == 1:
                ok = e['Xa'] is not None and J[c[0]]['sectionName'] == e['Xa']
                res[(b, 'sectionName == X_anchor' if ok else 'sectionName != X_anchor')] += 1; bymin[e['ministry']]['==' if ok else '!='] += 1
                if not ok and e['Xa'] is not None and len(ex[b]) < 5: ex[b].append({'ministry': e['ministry'], 'code': e['code'], 'X_anchor': e['Xa'], 'sectionName': J[c[0]]['sectionName']})
            else:
                h = [i for i in c if e['Xa'] is not None and J[i]['sectionName'] == e['Xa']]
                res[(b, cls(len(h)))] += 1; bymin[e['ministry']][cls(len(h))] += 1
                if len(h) == 1: k3['col4Raw == suffix' if J[h[0]]['col4Raw'] == e['suffix'] else 'col4Raw != suffix'] += 1
                if not h and e['Xa'] is not None and len(ex[b]) < 5: ex[b].append({'ministry': e['ministry'], 'code': e['code'], 'X_anchor': e['Xa'], 'candidate_sectionNames': sorted({J[i]['sectionName'] for i in c})})
        o['result_by_anchor_DETAIL_count'] = {f'{k[0]} | {k[1]}': v for k, v in sorted(res.items(), key=lambda kv: (str(kv[0][0]), kv[0][1]))}
        o['result_by_ministry'] = {k: dict(sorted(v.items())) for k, v in sorted(bymin.items())}
        if want == 2: o['single_vs_K3'] = dict(sorted(k3.items()))
        o['mismatch_examples'] = dict(ex)
        out[label] = o
    print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))


main()
