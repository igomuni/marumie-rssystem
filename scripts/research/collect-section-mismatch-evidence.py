#!/usr/bin/env python3
"""SECTION_MISMATCH 5行の failure isolation の証拠を機械的に集める（read-only、記述のみ。分類はしない）。

  python3 -I scripts/research/collect-section-mismatch-evidence.py <fy2024-section-candidates.csv> <out.json>

事前登録: docs/tasks/20261015_0656_Section_Mismatch_5_Failure_Isolation_Preregistration.md。
金額は join key にせず、補助の診断（E5）としてだけ集める。a1/a2/b1/b2 のフラグも機械的に計算するが、
分類（A〜D）は Coordinator が規則を適用して行う（c1・c2 は画像と原典 XML の確認が要る）。
"""
import csv, glob, hashlib, json, os, re, sys

D25, D24 = 'tests/fixtures/budget-request-csv/2025', 'tests/fixtures/budget-request-csv/2024'
MOF25 = 'data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl'
MOF24 = os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024/budget-jikou.jsonl')
MATCH = 'tests/fixtures/detail-table-mof-section-match/2025/triple-match.csv'
SEC25 = 'tests/fixtures/detail-table-toc-total-sections/2025/section-candidates.csv'
FROZEN = {
    f'{D25}/detail-table/output-manifest.json': '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7',
    f'{D24}/detail-table/output-manifest.json': '7989885b0d2ee0907d2389f71bc2642bada070120a06283c89d2f6d6634f226e',
    MOF25: '9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38',
    MOF24: 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e',
    MATCH: '2be288bc3d6d50f63345d87b58b453a5556fda112114e05845f928d8b8322dc6',
    SEC25: 'cd5ea2aeae50c36a9bd3811b249e7037236df44e48afb724166d6540e4802d86',
}
SEC24_SHA = '94306354bae037b5fd3f72ac7bb839d3fc5ed59699ee6ff6509b68e03ec6ce1a'
TARGETS = [('mlit.go.jp__page__content__001762903', '2177'), ('mlit.go.jp__page__content__001762903', '2798'),
           ('mlit.go.jp__page__content__001762903', '2820'), ('mlit.go.jp__page__content__001762903', '2822'),
           ('npa.go.jp__policies__budget__r7__gaisanyokyu__ippankaikei', '472')]
DET = re.compile(r'^([0-9]{2})[‑-]([0-9]{2}) (.*)$')
MIN = re.compile(r'^[0-9]{2}\s+(.+?)所管')


def sha(p):
    with open(p, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def yen(s): return int(s.replace(',', '').replace('△', '-')) * 1000 if re.fullmatch(r'△?[0-9,]+', s or '') else None


def general_rows(year_dir):
    """一般会計（2桁の所管の CONTEXT）の DETAIL 行: (source, row, ministry, name, request_no, prev千円)"""
    out = []
    for f in sorted(glob.glob(f'{year_dir}/detail-table/sources/*.csv')):
        s = os.path.basename(f)[:-4]
        R = list(csv.DictReader(open(f, encoding='utf-8')))
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        if ctx is None or re.match(r'^[0-9]{4}\s', ctx): continue
        m = MIN.match(ctx)
        if not m: continue
        for r in R:
            if r['row_type'] != 'DETAIL': continue
            d = DET.match(r['事項'])
            if d: out.append({'source': s, 'row_index': r['row_index'], 'ministry': m.group(1), 'name': d[3], 'code': r['事項'][:5],
                              'request_no': r['要求番号'], 'prev_amount_yen': yen(r['前年度予算額']), 'page': r['source_page']})
    return out


def main(sec24_path, out):
    for p, h in FROZEN.items():
        if sha(p) != h: sys.exit(f'STOP: {p} SHA-256 mismatch')
    if sha(sec24_path) != SEC24_SHA: sys.exit('STOP: FY2024 section-candidates mismatch')
    sec25 = {(r['source'], r['detail_row_index']): r for r in csv.DictReader(open(SEC25, encoding='utf-8'))}
    sec24 = {(r['source'], r['detail_row_index']): r for r in csv.DictReader(open(sec24_path, encoding='utf-8'))}
    mof25 = [json.loads(l) for l in open(MOF25, encoding='utf-8') if l.strip()]
    mof24 = [json.loads(l) for l in open(MOF24, encoding='utf-8') if l.strip()]
    prev = {(r['source'], r['row_index']): r for r in csv.DictReader(open(f'{D25}/detail-table-mof-match/matches.csv', encoding='utf-8'))}
    rows25, rows24 = general_rows(D25), general_rows(D24)
    triple = {(r['source'], r['row_index']): r for r in csv.DictReader(open(MATCH, encoding='utf-8'))}
    rec = lambda m: {**{k: m[k] for k in ('sectionCode', 'sectionName', 'jikouName', 'col4Raw', 'previousAmountYen', 'amountYen')}, 'page': m['page'] if 'page' in m else m['sourceLocator']['page']}  # FY2024 V2 は page が sourceLocator の中
    result = []
    for key in TARGETS:
        t = triple[key]
        assert t['prev_status'] == 'UNRESOLVED_SECTION_MISMATCH', key
        m, n, s_r = t['ministry'], t['detail_name'], t['confirmed_section_name']
        me = next(r for r in rows25 if (r['source'], r['row_index']) == key)
        mof_r = [x for x in mof25 if x['ministry'] == m and x['jikouName'] == n]
        assert len(mof_r) == 1, key
        r = mof_r[0]
        e1 = [{**x, 'confirmed_section': (sec25[(x['source'], x['row_index'])]['section_code'] + ' ' + sec25[(x['source'], x['row_index'])]['section_name'])
               if sec25[(x['source'], x['row_index'])]['status'] == 'CANDIDATE_CSV_CONSISTENT' else None,
               'prev_status': prev[(x['source'], x['row_index'])]['status']}
              for x in rows25 if x['ministry'] == m and x['name'] == n]
        sec_in25 = sorted({(x['sectionCode'], x['sectionName']) for x in mof25 if x['ministry'] == m and x['sectionName'] == s_r})
        sec_items25 = [{'jikouName': x['jikouName'], 'previousAmountYen': x['previousAmountYen']} for x in mof25 if x['ministry'] == m and x['sectionName'] == s_r]
        e3 = [rec(x) for x in mof24 if x['ministry'] == m and x['jikouName'] == n]
        sec_in24 = sorted({(x['sectionCode'], x['sectionName']) for x in mof24 if x['ministry'] == m and x['sectionName'] == s_r})
        e4 = [{**x, 'confirmed_section': (sec24[(x['source'], x['row_index'])]['section_code'] + ' ' + sec24[(x['source'], x['row_index'])]['section_name'])
               if sec24[(x['source'], x['row_index'])]['status'] == 'CANDIDATE_CSV_CONSISTENT' else None}
              for x in rows24 if x['ministry'] == m and x['name'] == n]
        amts = [x['prev_amount_yen'] for x in e1]
        total = sum(a for a in amts if a is not None) if all(a is not None for a in amts) else None
        target_amt = me['prev_amount_yen']
        other_named = [{'jikouName': x['jikouName'], 'sectionName': x['sectionName'], 'previousAmountYen': x['previousAmountYen']}
                       for x in mof25 if x['ministry'] == m and x['jikouName'] != n and target_amt not in (None, 0) and x['previousAmountYen'] == target_amt]
        flags = {
            'a1_amount_supports_identity': bool(r['previousAmountYen']) and (target_amt == r['previousAmountYen'] or total == r['previousAmountYen']),
            'a1_detail': {'target_prev_yen': target_amt, 'sum_of_same_name_request_rows_prev_yen': total, 'mof_previousAmountYen': r['previousAmountYen']},
            'a2_confirmed_section_exists_in_mof_fy2025_or_fy2024': bool(sec_in25 or sec_in24),
            'b1_amount_does_not_support_identity': not (target_amt == r['previousAmountYen'] or total == r['previousAmountYen']),
            'b2_other_named_mof_record_with_equal_previous_amount': other_named,
        }
        result.append({'target': {'source': key[0], 'row_index': key[1], 'code': me['code'], 'request_no': me['request_no'], 'page': me['page'],
                                  'ministry': m, 'name': n, 'confirmed_section': f"{t['confirmed_section_code']} {s_r}"},
                       'E2_mof_fy2025_record': rec(r), 'E1_request_fy2025_same_name_rows': e1,
                       'E2_confirmed_section_in_mof_fy2025': {'sections': sec_in25, 'items': sec_items25},
                       'E3_mof_fy2024_same_name_records': e3, 'E3_confirmed_section_in_mof_fy2024': sec_in24,
                       'E4_request_fy2024_same_name_rows': e4, 'E5_flags': flags})
    json.dump({'schema': 'section-mismatch-failure-isolation-evidence/v0', 'inputs': {os.path.relpath(p): h for p, h in FROZEN.items()} | {'fy2024-section-candidates': SEC24_SHA},
               'script_sha256': sha(__file__), 'rows': result}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({'rows': len(result), 'out': out}, ensure_ascii=False))


main(sys.argv[1], sys.argv[2])
