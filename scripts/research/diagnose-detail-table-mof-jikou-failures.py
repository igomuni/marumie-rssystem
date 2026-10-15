#!/usr/bin/env python3
"""明細表 DETAIL 行 ↔ MOF budget-jikou の J1 未突合（0件）・複数候補（2+件）の failure isolation（P1、事前登録どおり。read-only）。

  python3 -I scripts/research/diagnose-detail-table-mof-jikou-failures.py [MOF normalized fy2024 dir]

J1 は P0-A から変更しない。U2〜U5・K3 は診断で join には使わない。標準出力は JSON。
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


def nfkc(s): return unicodedata.normalize('NFKC', s)


def strip_pzs(s): return ''.join(c for c in nfkc(s) if unicodedata.category(c)[0] not in 'PSZ')


def differing(cands, J):
    d = [f for f in FIELDS if len({J[i][f] for i in cands}) > 1]
    return '+'.join(d) if d else 'none (identical rows)'


def main():
    print(f'input hashes verified: {verify_inputs()} source CSVs + manifest + budget-jikou', file=sys.stderr)
    J = [json.loads(l) for l in open(f'{M}/budget-jikou.jsonl', encoding='utf-8')]
    by_min_name = collections.defaultdict(list); by_name = collections.defaultdict(list); by_min = collections.defaultdict(list)
    for i, j in enumerate(J):
        by_min_name[(j['ministry'], j['jikouName'])].append(i); by_name[j['jikouName']].append(i); by_min[j['ministry']].append(i)
    E = []
    for f in sorted(glob.glob(D + '*.csv')):
        R = list(csv.DictReader(open(f, encoding='utf-8')))
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        if ctx is None or re.match(r'^[0-9]{4}\s', ctx): continue
        m = MIN.match(ctx)
        if not m: continue
        for r in R:
            if r['row_type'] != 'DETAIL': continue
            d = DET.match(r['事項'])
            if d: E.append({'ministry': m.group(1), 'code': r['事項'][:5], 'suffix': d.group(2), 'name': d.group(3)})
    dup = collections.Counter((e['ministry'], e['name']) for e in E)
    out = {'eligible_rows': len(E)}
    U, Mu = [], []
    for e in E:
        c = by_min_name.get((e['ministry'], e['name']), [])
        (U if not c else Mu if len(c) > 1 else []).append((e, c))
    out['U_rows'], out['M_rows'] = len(U), len(Mu)
    ucls, ucount, uk3, ulist = collections.Counter(), {}, collections.Counter(), []
    for e, _ in U:
        n = e['name']; same = by_min[e['ministry']]
        other = [i for i in by_name.get(n, []) if J[i]['ministry'] != e['ministry']]
        r2 = [i for i in same if nfkc(J[i]['jikouName']) == nfkc(n)]
        r3 = [i for i in same if strip_pzs(J[i]['jikouName']) == strip_pzs(n)]
        r4 = [i for i in same if J[i]['jikouName'] != n and min(len(J[i]['jikouName']), len(n)) >= 4 and (J[i]['jikouName'].startswith(n) or n.startswith(J[i]['jikouName']))]
        r5 = [i for i in same if i not in r4 and min(len(J[i]['jikouName']), len(n)) >= 4 and (J[i]['jikouName'] in n or n in J[i]['jikouName'])]
        for k, rel in (('U1 other-ministry exact name', other), ('U2 NFKC-equal (same ministry)', r2), ('U3 equal without P/S/Z (same ministry)', r3),
                       ('U4 prefix (same ministry)', r4), ('U5 substring (same ministry)', r5)):
            if rel: break
        else: k, rel = 'U6 none', []
        k3 = cls(sum(1 for i in same if J[i]['col4Raw'] == e['suffix']))
        ucls[k] += 1; uk3[k3] += 1
        ulist.append({'ministry': e['ministry'], 'code': e['code'], 'name': n, 'class': k, 'related_mof_rows': len(rel), 'same_ministry_col4Raw_match': k3})
    out['U_classes'] = dict(sorted(ucls.items())); out['U_K3_same_ministry_col4Raw_match'] = dict(sorted(uk3.items())); out['U_rows_list'] = ulist
    m1, m2, m2rest, m3, bymin, bal = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter), collections.Counter()
    for e, c in Mu:
        m1[differing(c, J)] += 1
        k = [i for i in c if J[i]['col4Raw'] == e['suffix']]
        m2[cls(len(k))] += 1; bymin[e['ministry']][cls(len(k))] += 1
        if len(k) > 1: m2rest[differing(k, J)] += 1
        d = dup[(e['ministry'], e['name'])]; m3[f'd={d},m={len(c)}'] += 1; bal['d == m' if d == len(c) else 'd != m'] += 1
    out['M1_fields_differing_among_candidates'] = dict(sorted(m1.items()))
    out['M2_K3_candidates_with_suffix_eq_col4Raw'] = dict(sorted(m2.items()))
    out['M2_remaining_when_2plus_fields_differing'] = dict(sorted(m2rest.items()))
    out['M2_by_ministry'] = {k: dict(sorted(v.items())) for k, v in sorted(bymin.items())}
    out['M3_detail_dup_d_vs_mof_candidates_m'] = dict(sorted(m3.items())); out['M3_balance'] = dict(bal)
    print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))


main()
