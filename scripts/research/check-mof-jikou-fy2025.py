#!/usr/bin/env python3
"""契約 §3 の確認（項の一致・Σ事項とΣ項の合計・成立後と提出時の差）。凍結した出力を読むだけ。python3 -I scripts/research/check-mof-jikou-fy2025.py"""
import csv, sys, json, collections
def load(p): return list(csv.DictReader(open(p, encoding='utf-8')))
out = {}
for v in ('2025', '2025_teishutsu'):
    j = load(f'tests/fixtures/mof-xml-parser-general/{v}/jikou-general.csv'); k = load(f'tests/fixtures/mof-archive-csv/{v}/kou-general.csv')
    yc = '令和7年度要求額(千円)'; kc = [c for c in k[0] if c.startswith('令和7年度要求額')][0]
    jk = collections.OrderedDict()
    for r in j: jk.setdefault((r['所管'], r['組織'], r['項コード'], r['項名']), []).append(r)
    ks = {(r['所管'], r['組織'], r['項コード'], r['項名']): r for r in k}
    only_j = sorted(set(jk) - set(ks)); only_k = sorted(set(ks) - set(jk))
    sum_eq = sum(1 for key, rs in jk.items() if key in ks and sum(int(r[yc]) for r in rs) == int(ks[key][kc]))
    out[v] = {'kou_jikou': len(jk), 'kou_csv': len(ks), 'only_in_jikou': len(only_j), 'only_in_kou_csv': len(only_k), 'examples': [only_j[:2], only_k[:2]],
              'kou_sum_equal': sum_eq, 'kou_sum_unequal': len(set(jk) & set(ks)) - sum_eq,
              'jikou_total': sum(int(r[yc]) for r in j), 'kou_total': sum(int(r[kc]) for r in k)}
a = {(r['source_file'], r['source_row']): r for r in load(f'tests/fixtures/mof-xml-parser-general/2025/jikou-general.csv')}
b = {(r['source_file'], r['source_row']): r for r in load(f'tests/fixtures/mof-xml-parser-general/2025_teishutsu/jikou-general.csv')}
out['seiritsugo_vs_teishutsu'] = {'same_keys': set(a) == set(b), 'rows_with_diff': sum(1 for x in a if x in b and a[x] != b[x])}
print(json.dumps(out, ensure_ascii=False, indent=1))
