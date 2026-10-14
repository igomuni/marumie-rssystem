#!/usr/bin/env python3
"""FY2025: TOC＋総表で確認できた項（明細表の X と一致したもの）を使い、明細表の事項を MOF と (所管, 項名, 事項名) の exact で照合する（記述のみ。read-only）。

  python3 -I scripts/research/match-detail-table-mof-by-confirmed-section.py <out-dir>

事前登録どおり。母集団・照合キー・STOP 条件は
docs/tasks/20261015_0640_FY2025_Confirmed_Section_MOF_Match_Preregistration.md。
正規化・部分一致・金額・組織・K3・O は使わない。J1 複数の行は1候補になっても昇格しない。<out-dir> に triple-match.csv と summary.json を書く。
"""
import collections, csv, glob, hashlib, json, os, re, sys

D = 'data/work/budget-request-csv/2025'
SECTIONS = 'tests/fixtures/detail-table-toc-total-sections/2025/section-candidates.csv'
MOF = 'data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl'
FROZEN = {
    f'{D}/detail-table/output-manifest.json': '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7',
    f'{D}/detail-table-mof-match/output-manifest.json': '5b17a565e3a3f2666edf6399a547ad5f61043385d9e90b35f833921c2b0956a1',
    SECTIONS: 'cd5ea2aeae50c36a9bd3811b249e7037236df44e48afb724166d6540e4802d86',
    MOF: '9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38',
}
EXPECTED_POPULATION = 957
SEC = re.compile(r'^([0-9]{2,3}) (.+)$')
DET = re.compile(r'^([0-9]{2})[‑-]([0-9]{2}) (.*)$')
MIN = re.compile(r'^[0-9]{2}\s+(.+?)所管')
MOF_ID = ('organization', 'sectionCode', 'sectionName', 'jikouName', 'col4Raw')


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def cls(n): return '0' if n == 0 else '1' if n == 1 else '2+'


def detail_x(rows):
    """#452 の規則: immediate X、無ければ immediate X を持つ直近の先行 DETAIL の X。MOF は見ない"""
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


def main(out_dir):
    for path, want in FROZEN.items():
        if sha(path) != want: sys.exit(f'STOP: {path} SHA-256 mismatch')
    match_dir = f'{D}/detail-table-mof-match'
    for rel, h in json.load(open(f'{match_dir}/output-manifest.json')).items():
        if sha(f'{match_dir}/{rel}') != h: sys.exit(f'STOP: {rel} differs from its manifest')
    prev = {(r['source'], r['row_index']): r for r in csv.DictReader(open(f'{match_dir}/matches.csv', encoding='utf-8'))}
    sections = {(r['source'], r['detail_row_index']): r for r in csv.DictReader(open(SECTIONS, encoding='utf-8'))}
    mof = [json.loads(l) for l in open(MOF, encoding='utf-8') if l.strip()]
    by_triple = collections.defaultdict(list)
    for m in mof: by_triple[(m['ministry'], m['sectionName'], m['jikouName'])].append(m)

    excl = collections.Counter(); rows = []
    for f in sorted(glob.glob(f'{D}/detail-table/sources/*.csv')):
        s = os.path.basename(f)[:-4]
        R = list(csv.DictReader(open(f, encoding='utf-8')))
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        ndet = sum(1 for r in R if r['row_type'] == 'DETAIL')
        if ctx is None: excl['OUT_OF_SCOPE_NO_CONTEXT'] += ndet; continue
        if re.match(r'^[0-9]{4}\s', ctx): excl['OUT_OF_SCOPE_SPECIAL_ACCOUNT'] += ndet; continue
        m = MIN.match(ctx)
        if not m: excl['OUT_OF_SCOPE_CONTEXT_NOT_MINISTRY'] += ndet; continue
        ministry = m.group(1)
        X = detail_x(R)
        for r in R:
            if r['row_type'] != 'DETAIL': continue
            d = DET.match(r['事項'])
            if not d: excl['OUT_OF_SCOPE_DETAIL_CODE_PATTERN'] += 1; continue
            sec = sections[(s, r['row_index'])]
            src, x = X[r['row_index']]
            if sec['status'] != 'CANDIDATE_CSV_CONSISTENT': excl['no_section_from_toc_total'] += 1; continue
            if x is None: excl['section_from_toc_total_but_no_X'] += 1; continue
            if not (sec['section_code'] == x[0] and sec['section_name'] == x[1]): excl['X_disagrees_with_toc_total'] += 1; continue
            p = prev[(s, r['row_index'])]
            cands = by_triple.get((ministry, sec['section_name'], d[3]), [])
            rows.append({'source': s, 'row_index': r['row_index'], 'detail_code': r['事項'][:5], 'detail_name': d[3], 'ministry': ministry,
                         'x_source': src, 'confirmed_section_code': sec['section_code'], 'confirmed_section_name': sec['section_name'],
                         'prev_status': p['status'], 'prev_j1_candidates': int(p['j1_candidates']),
                         'prev_k2_candidates': p['k2_candidates'], 'triple_candidates': len(cands),
                         'triple_mof': cands[0] if len(cands) == 1 else None, 'prev': p})
    if len(rows) != EXPECTED_POPULATION: sys.exit(f'STOP: population {len(rows)} != {EXPECTED_POPULATION}')

    # acceptance checks (STOP conditions fixed in the preregistration)
    k2_bad = []; identity_bad = []
    for r in rows:
        if r['prev_status'] == 'K2_SUPPORTED':
            same = r['triple_mof'] is not None and all(str(r['triple_mof'][k]) == r['prev']['mof_' + k] for k in MOF_ID)
            if r['triple_candidates'] != 1 or not same: k2_bad.append((r['source'], r['row_index'], r['triple_candidates']))
        if str(r['triple_candidates']) != r['prev_k2_candidates']: identity_bad.append((r['source'], r['row_index'], r['triple_candidates'], r['prev_k2_candidates']))

    os.makedirs(out_dir, exist_ok=True)
    cols = ['source', 'row_index', 'detail_code', 'detail_name', 'ministry', 'x_source', 'confirmed_section_code', 'confirmed_section_name',
            'prev_status', 'prev_j1_candidates', 'prev_k2_candidates', 'triple_candidates',
            'mof_organization', 'mof_sectionCode', 'mof_sectionName', 'mof_jikouName', 'mof_col4Raw']
    with open(f'{out_dir}/triple-match.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(cols)
        for r in rows:
            mm = r['triple_mof']
            w.writerow([r[c] for c in cols[:12]] + ([mm['organization'], mm['sectionCode'], mm['sectionName'], mm['jikouName'], mm['col4Raw']] if mm else [''] * 5))
    cross = collections.Counter((r['prev_status'], cls(r['triple_candidates'])) for r in rows)
    cross_x = collections.Counter((r['prev_status'], r['x_source'], cls(r['triple_candidates'])) for r in rows)
    multi_all = [p for p in prev.values() if p['status'] == 'AMBIGUOUS_J1_MULTI' and p['k2_candidates'] == '1']
    in_pop = {(r['source'], r['row_index']) for r in rows}
    summary = {
        'fiscalYear': 2025,
        'inputs': {**{os.path.relpath(k): v for k, v in FROZEN.items()}, 'script_sha256': sha(__file__)},
        'population': len(rows), 'excluded': dict(sorted(excl.items())),
        'byPrevStatusAndTripleCandidates': {f'{a} | {b}': v for (a, b), v in sorted(cross.items())},
        'byPrevStatusXSourceAndTripleCandidates': {f'{a} | {b} | {c}': v for (a, b, c), v in sorted(cross_x.items())},
        'j1MultiRowsWithOneK2Candidate': {'total': len(multi_all),
                                         'inPopulation(section independently confirmed)': sum(1 for p in multi_all if (p['source'], p['row_index']) in in_pop),
                                         'notInPopulation': sum(1 for p in multi_all if (p['source'], p['row_index']) not in in_pop)},
        'acceptance': {'k2SupportedRowsInPopulation': sum(1 for r in rows if r['prev_status'] == 'K2_SUPPORTED'),
                       'k2SupportedViolations': k2_bad, 'candidateCountEqualsPrevK2Candidates': not identity_bad, 'identityViolations': identity_bad},
        'promotion': 'none (J1-multi rows stay AMBIGUOUS even when the triple key returns one candidate)',
    }
    open(f'{out_dir}/summary.json', 'w', encoding='utf-8').write(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if k2_bad or identity_bad: sys.exit('STOP: acceptance check violated (see summary)')


main(sys.argv[1])
