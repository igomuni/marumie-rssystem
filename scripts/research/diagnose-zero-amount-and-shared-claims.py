#!/usr/bin/env python3
"""事後の記述診断（post-hoc。分類・昇格の判断には使わない）: FY2025 の母集団 957 事項について、
(1) 概算要求の事項が金額ゼロ（事項の行と、次の事項の行までの行の前年度・要求額がすべて空欄か 0）か、
(2) 同じ (所管, 項名, 事項名) を指す概算要求の行が複数あるか、を #461 の status 別に数える。

  python3 -I scripts/research/diagnose-zero-amount-and-shared-claims.py <out.json>

SECTION_MISMATCH 5行の failure isolation で、MLIT の4行が「金額ゼロの事項」だったことが分かったため、同じ型が 142 行や 680 行にどれだけあるかを見る。
入力: #466 の triple-match.csv（`2be288bc…`）と明細表（`0bdeeb37…`）。MOF は使わない。
"""
import collections, csv, hashlib, json, os, re, sys

D = 'tests/fixtures/budget-request-csv/2025/detail-table'
MATCH = 'tests/fixtures/detail-table-mof-section-match/2025/triple-match.csv'
FROZEN = {MATCH: '2be288bc3d6d50f63345d87b58b453a5556fda112114e05845f928d8b8322dc6',
          f'{D}/output-manifest.json': '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7'}
NUM = re.compile(r'^△?[0-9,]+$')


def sha(p):
    with open(p, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def nonzero(cell):
    return bool(cell) and NUM.match(cell) is not None and int(cell.replace(',', '').replace('△', '')) != 0


def main(out):
    for p, h in FROZEN.items():
        if sha(p) != h: sys.exit(f'STOP: {p} SHA-256 mismatch')
    pop = list(csv.DictReader(open(MATCH, encoding='utf-8')))
    cache, zero = {}, {}
    for r in pop:
        s = r['source']
        if s not in cache:
            cache[s] = list(csv.DictReader(open(f'{D}/sources/{s}.csv', encoding='utf-8')))
        R = cache[s]
        n = next(i for i, x in enumerate(R) if x['row_index'] == r['row_index'])
        k = n + 1
        while k < len(R) and R[k]['row_type'] != 'DETAIL': k += 1
        block = R[n:k]
        zero[(s, r['row_index'])] = not any(nonzero(x['前年度予算額']) or nonzero(x['６年度概算要求額']) for x in block)
    claims = collections.Counter((r['ministry'], r['confirmed_section_name'], r['detail_name']) for r in pop)
    by_status = collections.defaultdict(collections.Counter)
    examples = collections.defaultdict(list)
    for r in pop:
        key = (r['source'], r['row_index'])
        st = f"{r['prev_status']} | triple:{'0' if r['triple_candidates'] == '0' else '1' if r['triple_candidates'] == '1' else '2+'}"
        by_status[st]['rows'] += 1
        by_status[st]['request_item_is_zero_amount'] += int(zero[key])
        by_status[st]['request_rows_sharing_the_same_triple(>=2)'] += int(claims[(r['ministry'], r['confirmed_section_name'], r['detail_name'])] >= 2)
        if zero[key] and len(examples[st]) < 8: examples[st].append({'source': r['source'][:30], 'code': r['detail_code'], 'name': r['detail_name'][:24], 'section': r['confirmed_section_name']})
    res = {'scope': 'post-hoc descriptive diagnostic; not used for classification or promotion',
           'inputs': {os.path.relpath(p): h for p, h in FROZEN.items()} | {'script_sha256': sha(__file__)},
           'population': len(pop), 'byStatus': {k: dict(v) for k, v in sorted(by_status.items())},
           'zeroAmountExamples': dict(examples)}
    json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


main(sys.argv[1])
