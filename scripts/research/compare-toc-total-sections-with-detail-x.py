#!/usr/bin/env python3
"""TOC＋総表の項候補（resolve-detail-sections-via-toc-total.py の出力）と、明細表の source-only X（immediate X / anchor carry、#452 の規則）を DETAIL 行ごとに比べる（read-only、記述のみ）。

  python3 -I scripts/research/compare-toc-total-sections-with-detail-x.py <section-candidates.csv> [--year=2024]

明細表は tests/fixtures/budget-request-csv/{year}/detail-table（output-manifest の SHA-256 を照合）。MOF は使わない。標準出力は JSON。
"""
import collections, csv, glob, hashlib, json, os, re, sys

FROZEN = {
    2024: {'detail_manifest': '7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e',
           'candidates': '94306354bae037b5fd3f72ac7bb839d3fc5ed59699ee6ff6509b68e03ec6ce1a'},
    2025: {'detail_manifest': '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7',
           'candidates': 'cd5ea2aeae50c36a9bd3811b249e7037236df44e48afb724166d6540e4802d86'},
}
SEC = re.compile(r'^([0-9]{2,3}) (.+)$')


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def scope_of(rows):
    ctx = next((r['事項'] for r in rows if r['row_type'] == 'CONTEXT'), None)
    if ctx is None: return 'no_context'
    if re.match(r'^[0-9]{4}\s', ctx): return 'special'
    return 'general' if re.match(r'^[0-9]{2}\s+(.+?)所管', ctx) else 'other'


def detail_x(rows):
    def imm(k):
        if k > 0 and rows[k - 1]['row_type'] in ('CODE3', 'CODE2'):
            m = SEC.match(rows[k - 1]['事項'])
            if m: return m.group(1), m.group(2)
        return None
    out = {}
    for n, r in enumerate(rows):
        if r['row_type'] != 'DETAIL': continue
        x, src = imm(n), 'immediate'
        if x is None:
            src = 'anchor'
            for k in range(n - 1, -1, -1):
                if rows[k]['row_type'] == 'DETAIL':
                    x = imm(k)
                    if x: break
        out[r['row_index']] = (src if x else 'none', x)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--year=')]
    year = int(next((a[7:] for a in sys.argv[1:] if a.startswith('--year=')), '2024'))
    cand_path, frozen = args[0], FROZEN[year]
    DETAIL = f'tests/fixtures/budget-request-csv/{year}/detail-table'
    if sha(os.path.join(DETAIL, 'output-manifest.json')) != frozen['detail_manifest']: sys.exit('STOP: detail-table output-manifest mismatch')
    if sha(cand_path) != frozen['candidates']: sys.exit('STOP: section-candidates.csv mismatch')
    X, scope = {}, {}
    for f in sorted(glob.glob(os.path.join(DETAIL, 'sources', '*.csv'))):
        s = os.path.basename(f)[:-4]
        rows = list(csv.DictReader(open(f, encoding='utf-8')))
        sc = scope_of(rows)
        for idx, v in detail_x(rows).items(): X[(s, idx)] = v; scope[(s, idx)] = sc
    cands = list(csv.DictReader(open(cand_path, encoding='utf-8')))
    res = collections.Counter(); diffs = []
    for c in cands:
        k = (c['source'], c['detail_row_index']); src, x = X[k]; sc = scope[k]
        if c['status'] != 'CANDIDATE_CSV_CONSISTENT':
            res[f'{sc} | toc:none | X:{"yes" if x else "none"}'] += 1; continue
        if x is None: res[f'{sc} | toc:yes | X:none'] += 1; continue
        name_ok = re.sub(r'\s+', '', c['section_name']) == x[1]; code_ok = c['section_code'] == x[0]
        tag = 'agree' if name_ok and code_ok else 'name_only' if name_ok else 'code_only' if code_ok else 'differ'
        res[f'{sc} | toc:yes | {src}:{tag}'] += 1
        if tag != 'agree':
            diffs.append({'source': c['source'], 'detail_row_index': c['detail_row_index'], 'item': c['item'],
                          'toc_total': [c['section_code'], c['section_name']], 'detail_x': list(x), 'x_source': src})
    both = sum(v for k, v in res.items() if '| toc:yes |' in k and 'X:none' not in k)
    agree = sum(v for k, v in res.items() if k.endswith(':agree'))
    print(json.dumps({'fiscalYear': year, 'inputs': {'detailOutputManifest': frozen['detail_manifest'], 'sectionCandidates': frozen['candidates'], 'script_sha256': sha(__file__)},
                      'detailRows': len(cands), 'bothHaveSection': both, 'agreeCodeAndName': agree,
                      'byScopeAndOutcome': dict(sorted(res.items())), 'disagreements': diffs}, ensure_ascii=False, indent=1))


main()
