#!/usr/bin/env python3
"""契約 §5 の確認（項の一致・Σ事項と公式 CSV の項の合計・成立後と提出時の差）。凍結した jikou-special.csv を読むだけ。
python3 -I scripts/research/check-mof-jikou-special.py <fixtures-dir> <out.json>"""
import collections, csv, json, re, sys

F = sys.argv[1]
ld = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
ns = lambda s: re.sub(r'\s+', '', s)
out = {}
for v in ('2024', '2025', '2025_teishutsu'):
    j = ld(f'{F}/{v}/jikou-special.csv'); k = ld(f'tests/fixtures/mof-archive-csv/{v}/kou-special.csv')
    pc = [c for c in j[0] if c.endswith('予定額(千円)')][0]; kc = [c for c in k[0] if c.endswith('予定額の合計') or c.endswith('予定額(千円)の合計')][0]
    key = lambda r, a, b: (r['特別会計'], r['勘定'], r['項コード'], ns(r['項名']))
    jk = collections.OrderedDict()
    for r in j: jk.setdefault((r['特別会計'], r['勘定'], r['項コード'], ns(r['項名']), r['組織']), []).append(r)
    # 公式 CSV の項は (特別会計, 勘定, 項コード, 項名) で比べる。XML 側は組織を除いた同じ4つ組
    jc = collections.Counter(key[:4] for key in jk)
    kcnt = collections.Counter((r['特別会計'], r['勘定'], r['項コード'], ns(r['項名'])) for r in k)
    sums_j = collections.Counter(); 
    for kk, rs in jk.items(): sums_j[kk[:4]] += sum(int(r[pc]) for r in rs)
    sums_k = collections.Counter()
    for r in k: sums_k[(r['特別会計'], r['勘定'], r['項コード'], ns(r['項名']))] += int(r[kc])
    both = set(jc) & set(kcnt)
    out[v] = {'item_jikou': sum(jc.values()), 'item_kou_csv': sum(kcnt.values()), 'only_in_jikou': sorted(map(list, (jc - kcnt).elements()))[:5], 'only_in_kou_csv': sorted(map(list, (kcnt - jc).elements()))[:5],
              'item_sum_equal': sum(1 for x in both if sums_j[x] == sums_k[x]), 'item_sum_unequal': sum(1 for x in both if sums_j[x] != sums_k[x]),
              'jikou_total': sum(int(r[pc]) for r in j), 'kou_total': sum(int(r[kc]) for r in k), 'records': len(j),
              'blank_prev_rows': sum(1 for r in j if r['前年度予算額(千円)'] == '')}
a = {(r['source_file'], r['source_row']): r for r in ld(f'{F}/2025/jikou-special.csv')}
b = {(r['source_file'], r['source_row']): r for r in ld(f'{F}/2025_teishutsu/jikou-special.csv')}
out['seiritsugo_vs_teishutsu'] = {'same_keys': set(a) == set(b), 'rows_with_diff': sum(1 for x in a if x in b and a[x] != b[x])}
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(sys.argv[2], 'a').write('\n')
print(json.dumps(out, ensure_ascii=False, indent=1))
