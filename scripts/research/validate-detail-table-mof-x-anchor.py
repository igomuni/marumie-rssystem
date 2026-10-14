#!/usr/bin/env python3
"""明細表 DETAIL の X（immediate X / anchor carry の X_anchor）と MOF の sectionName の exact 一致 — held-out validation（事前登録どおり。read-only）。

  python3 -I scripts/research/validate-detail-table-mof-x-anchor.py 2024 [MOF fy2024 dir]   # development の再現確認（#452 と同じ数になること）
  python3 -I scripts/research/validate-detail-table-mof-x-anchor.py 2025 <result.json>      # one-shot。result.json が既にあれば実行しない

J1・eligible・immediate X・anchor carry は #452 の diagnose-detail-table-mof-x-anchor-carry.py と同じ規則（コードを写しただけ）。
MOF の値は anchor の探索に使わない。正規化・部分一致・金額・K3・O による救済はしない。標準出力は JSON。
"""
import collections, csv, glob, hashlib, json, math, os, re, sys

CFG = {
    2024: {'detail': 'data/work/budget-request-csv/2024/detail-table',
           'manifest_sha': '7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e',
           'mof_file': 'budget-jikou.jsonl', 'mof_sha': 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e'},
    2025: {'detail': 'data/work/budget-request-csv/2025/detail-table',
           'manifest_sha': '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7',
           'mof_path': 'data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl',
           'mof_sha': '9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38'},
}
GO_THRESHOLD = 0.95
MIN_EVALUABLE = 50
HY = '[‑-]'
DET = re.compile(rf'^([0-9]{{2}}){HY}([0-9]{{2}}) (.*)$')
MIN = re.compile(r'^[0-9]{2}\s+(.+?)所管')
SEC = re.compile(r'^([0-9]{2,3}) (.+)$')


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def verify(cfg, mof_path):
    man_path = os.path.join(cfg['detail'], 'output-manifest.json')
    if sha(man_path) != cfg['manifest_sha']: sys.exit('STOP: detail-table output-manifest.json SHA-256 mismatch')
    if sha(mof_path) != cfg['mof_sha']: sys.exit('STOP: MOF jikou SHA-256 mismatch')
    man = json.load(open(man_path, encoding='utf-8'))
    files = sorted(glob.glob(os.path.join(cfg['detail'], 'sources', '*.csv')))
    actual = {os.path.relpath(f, cfg['detail']) for f in files}
    listed = {k for k in man if k.startswith('sources/') and k.endswith('.csv')}
    if actual != listed: sys.exit(f'STOP: sources/*.csv set differs from manifest (missing={sorted(listed - actual)}, extra={sorted(actual - listed)})')
    for f in files:
        if sha(f) != man[os.path.relpath(f, cfg['detail'])]: sys.exit(f'STOP: {f} SHA-256 differs from manifest')
    return files


def imm(R, n):
    if n and R[n - 1]['row_type'] in ('CODE3', 'CODE2'):
        sm = SEC.match(R[n - 1]['事項'])
        if sm: return sm.group(2)
    return None


def wilson(k, n, z=1.959963984540054):
    if n == 0: return None
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - h) / d, 4), round((c + h) / d, 4)]


def run(year, mof_path):
    cfg = CFG[year]
    files = verify(cfg, mof_path)
    J = [json.loads(l) for l in open(mof_path, encoding='utf-8') if l.strip()]
    by_min_name = collections.defaultdict(list)
    for i, j in enumerate(J): by_min_name[(j['ministry'], j['jikouName'])].append(i)

    excl = collections.Counter()
    E = []
    for f in files:
        R = list(csv.DictReader(open(f, encoding='utf-8')))
        ndet = sum(1 for r in R if r['row_type'] == 'DETAIL')
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        if ctx is None: excl['source_without_CONTEXT (DETAIL rows)'] += ndet; continue
        if re.match(r'^[0-9]{4}\s', ctx): excl['special_account_CONTEXT (DETAIL rows)'] += ndet; continue
        m = MIN.match(ctx)
        if not m: excl['CONTEXT_not_2digit_ministry (DETAIL rows)'] += ndet; continue
        for n, r in enumerate(R):
            if r['row_type'] != 'DETAIL': continue
            d = DET.match(r['事項'])
            if not d: excl['DETAIL_code_pattern_mismatch'] += 1; continue
            x = imm(R, n); xa = None
            if x is None:
                for k in range(n - 1, -1, -1):
                    if R[k]['row_type'] != 'DETAIL': continue
                    xa = imm(R, k)
                    if xa is not None: break
            E.append({'ministry': m.group(1), 'code': r['事項'][:5], 'name': d.group(3), 'X': x, 'Xa': xa,
                      'cand': by_min_name.get((m.group(1), d.group(3)), [])})

    single = [e for e in E if len(e['cand']) == 1]
    multi = [e for e in E if len(e['cand']) > 1]
    sn = lambda e: J[e['cand'][0]]['sectionName']

    prim = [e for e in single if e['X'] is None and e['Xa'] is not None]
    prim_ok = sum(1 for e in prim if sn(e) == e['Xa'])
    imm_s = [e for e in single if e['X'] is not None]
    imm_ok = sum(1 for e in imm_s if sn(e) == e['X'])
    multi_cls = collections.Counter()
    for e in multi:
        xx = e['X'] if e['X'] is not None else e['Xa']
        if xx is None: multi_cls['no X (no immediate X, no anchor)'] += 1; continue
        h = sum(1 for i in e['cand'] if J[i]['sectionName'] == xx)
        multi_cls[('immediate' if e['X'] is not None else 'anchor') + ' | ' + ('0' if h == 0 else '1' if h == 1 else '2+')] += 1

    rate = prim_ok / len(prim) if prim else None
    decision = 'INCONCLUSIVE' if len(prim) < MIN_EVALUABLE else ('GO' if rate >= GO_THRESHOLD else 'STOP')
    mism = [{'ministry': e['ministry'], 'code': e['code'], 'X_anchor': e['Xa'], 'sectionName': sn(e)} for e in prim if sn(e) != e['Xa']]
    return {
        'fiscalYear': year,
        'inputs': {'detailOutputManifest': cfg['manifest_sha'], 'mofJikou': cfg['mof_sha'], 'sourceCsvs': len(files), 'mofRecords': len(J),
                   'script_sha256': sha(__file__)},
        'population': {
            'eligible_DETAIL_rows': len(E), 'excluded': dict(sorted(excl.items())),
            'J1_0_candidates': sum(1 for e in E if not e['cand']), 'J1_single': len(single), 'J1_multi': len(multi),
            'J1_single_immediate_X': len(imm_s), 'J1_single_no_immediate_X': len(single) - len(imm_s),
            'J1_single_no_immediate_X_anchor_not_found': sum(1 for e in single if e['X'] is None and e['Xa'] is None),
        },
        'primary': {'definition': 'J1 単一・immediate X なし・anchor 取得可の行で sectionName == X_anchor（exact）',
                    'n': len(prim), 'agree': prim_ok, 'rate': None if rate is None else round(rate, 4), 'wilson95': wilson(prim_ok, len(prim)),
                    'threshold': GO_THRESHOLD, 'min_evaluable': MIN_EVALUABLE, 'decision': decision},
        'secondary': {
            'J1_single_immediate_X': {'n': len(imm_s), 'agree': imm_ok, 'rate': round(imm_ok / len(imm_s), 4) if imm_s else None},
            'J1_single_source_only_X_combined': {'n': len(imm_s) + len(prim), 'agree': imm_ok + prim_ok,
                                                 'rate': round((imm_ok + prim_ok) / (len(imm_s) + len(prim)), 4) if imm_s or prim else None},
            'J1_multi_candidates_after_X': dict(sorted(multi_cls.items())),
        },
        'primary_mismatches': mism,
    }


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['2024']:
        mdir = a[1] if len(a) > 1 else os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024')
        print(json.dumps(run(2024, os.path.join(mdir, CFG[2024]['mof_file'])), ensure_ascii=False, indent=1, sort_keys=True))
    elif a[:1] == ['2025'] and len(a) == 2:
        if os.path.exists(a[1]): sys.exit(f'STOP: {a[1]} already exists (one-shot)')
        out = json.dumps(run(2025, CFG[2025]['mof_path']), ensure_ascii=False, indent=1, sort_keys=True) + '\n'
        with open(a[1], 'w', encoding='utf-8') as fh: fh.write(out)
        sys.stdout.write(out)
    else: sys.exit(__doc__)
