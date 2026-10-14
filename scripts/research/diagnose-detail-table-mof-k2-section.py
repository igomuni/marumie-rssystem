#!/usr/bin/env python3
"""明細表 DETAIL 行 → 項・組織 と MOF の sectionName / organization の exact 関係（K2 feasibility、事前登録どおり。read-only）。

  python3 -I scripts/research/diagnose-detail-table-mof-k2-section.py [MOF normalized fy2024 dir]

J1 は P0-A/P1 から変更しない。K2 は診断で join には使わない。標準出力は JSON。
"""
import collections, csv, glob, hashlib, json, os, re, sys, unicodedata

D = 'data/work/budget-request-csv/2024/detail-table/sources/'
M = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024')
FROZEN_JIKOU_SHA = 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e'
FROZEN_MANIFEST_SHA = '7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e'
MANIFEST = 'data/work/budget-request-csv/2024/detail-table/output-manifest.json'
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


def differing(cands, J):
    d = [f for f in FIELDS if len({J[i][f] for i in cands}) > 1]
    return '+'.join(d) if d else 'none (identical on the 4 fields)'


def main():
    print(f'input hashes verified: {verify_inputs()} source CSVs + manifest + budget-jikou', file=sys.stderr)
    J = [json.loads(l) for l in open(f'{M}/budget-jikou.jsonl', encoding='utf-8')]
    by_min_name = collections.defaultdict(list); orgs = collections.defaultdict(set)
    for i, j in enumerate(J):
        by_min_name[(j['ministry'], j['jikouName'])].append(i); orgs[j['ministry']].add(j['organization'])
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
            X = Xcode = O = None; prev_type = R[n - 1]['row_type'] if n else 'none'
            if n and R[n - 1]['row_type'] in ('CODE3', 'CODE2'):
                sm = SEC.match(R[n - 1]['事項'])
                if sm: Xcode, X = sm.group(1), sm.group(2)
                else: prev_type = R[n - 1]['row_type'] + ' (not NN/NNN name)'
                for k in range(n - 2, -1, -1):
                    if R[k]['row_type'] in ('CODE3', 'CODE2'):
                        sk = SEC.match(R[k]['事項'])
                        if sk and sk.group(2) in orgs[m.group(1)]: O = sk.group(2); break
            E.append({'ministry': m.group(1), 'suffix': d.group(2), 'name': d.group(3), 'X': X, 'Xcode': Xcode, 'O': O, 'prev': prev_type if X is None else 'section row'})
    out = {'eligible_rows': len(E)}
    for label, want in (('single_694', 1), ('multi_215', 2)):
        S = [(e, by_min_name.get((e['ministry'], e['name']), [])) for e in E]
        S = [(e, c) for e, c in S if (len(c) == 1 if want == 1 else len(c) > 1)]
        o = {'rows': len(S), 'X_present': sum(1 for e, _ in S if e['X'] is not None), 'O_present': sum(1 for e, _ in S if e['O'] is not None),
             'prev_row_kind_when_no_X': dict(sorted(collections.Counter(e['prev'] for e, _ in S if e['X'] is None).items()))}
        k2a, k2b, rest, k3in, bymin = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter)
        sec_eq = org_eq = code_eq = both = 0
        for e, c in S:
            a = [i for i in c if e['X'] is not None and J[i]['sectionName'] == e['X']]
            b = [i for i in a if e['O'] is not None and J[i]['organization'] == e['O']]
            k2a[cls(len(a))] += 1; k2b[cls(len(b))] += 1; bymin[e['ministry']][cls(len(b))] += 1
            if want == 1:
                j = J[c[0]]; s1 = e['X'] == j['sectionName']; o1 = e['O'] == j['organization']
                sec_eq += s1; org_eq += o1; both += s1 and o1; code_eq += e['Xcode'] is not None and e['Xcode'] == j['sectionCode']
            else:
                if len(b) > 1: rest[differing(b, J)] += 1
                if len(b) == 1: k3in['col4Raw == suffix' if J[b[0]]['col4Raw'] == e['suffix'] else 'col4Raw != suffix'] += 1
        o['K2a_sectionName_eq_X'] = dict(sorted(k2a.items())); o['K2b_and_organization_eq_O'] = dict(sorted(k2b.items()))
        if want == 1: o['single_control'] = {'sectionName_eq_X': sec_eq, 'organization_eq_O': org_eq, 'both': both, 'Xcode_eq_sectionCode': code_eq}
        else:
            o['K2b_remaining_2plus_fields_differing'] = dict(sorted(rest.items())); o['K2b_single_vs_K3'] = dict(sorted(k3in.items()))
            o['K2b_by_ministry'] = {k: dict(sorted(v.items())) for k, v in sorted(bymin.items())}
        out[label] = o
    print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))


main()
