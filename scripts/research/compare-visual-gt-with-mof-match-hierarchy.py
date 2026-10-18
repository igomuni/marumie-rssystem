#!/usr/bin/env python3
"""人手の visual GT（事項がどの項に属するか）と、MOF 突合の request 側の階層（事項→項）の一致率を数える（参考値。評価ではない）。

  python3 -I scripts/research/compare-visual-gt-with-mof-match-hierarchy.py <gt.csv> <year>
gt.csv の列: source_file, source_page, source_line_start, 項コード, 項名, 状態（RESOLVED の行だけを使う）。
GT の各行を明細表 CSV の行（source_page・source_line_start）にたどり、事項のコード・名称で m2-jikou の行を探し、その toc_kou_idx から m1-kou の項（request_code3・request_name）を得て、GT の項コード・項名と比べる。
同じコード・名称の事項が 1 つの source に複数あると、親が複数になる（multi-parent。どれか 1 つが一致すれば一致とする）。
"""
import collections, csv, re, sys, unicodedata

gt, year = sys.argv[1:3]
M = f'tests/fixtures/mof-budget-request-match/{year}/'
nz = lambda s: re.sub(r'[‐‑‒–—―−ー－-]', '-', re.sub(r'[\s　]+', '', unicodedata.normalize('NFKC', s or '')))
rd = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
m1, m2 = rd(M + 'm1-kou.csv'), rd(M + 'm2-jikou.csv')
kou = {(r['request_source'], r['toc_kou_idx']): (r['request_code3'], r['request_name']) for r in m1}
by = collections.defaultdict(list)
for r in m2: by[(r['request_source'], nz(r['request_code']), nz(r['request_name']))].append(r)
det = {}
res = collections.Counter(); bad = []
for t in rd(gt):
    if t['状態'] != 'RESOLVED': continue
    slug = t['source_file'].replace(f'budget-request-plain-text/{year}/', '').removesuffix('.txt')
    if slug not in det: det[slug] = rd(f'tests/fixtures/budget-request-csv/{year}/detail-table/sources/{slug}.csv')
    hit = [r for r in det[slug] if r['source_page'] == t['source_page'] and r['source_line_start'] == t['source_line_start']]
    if not hit: res['no_detail_row'] += 1; continue
    mm = re.match(r'^\s*(\d{2}[‑\-]\d{2})\s*(.*)$', hit[0]['事項'])
    if not mm: res['no_code_in_row'] += 1; continue
    code, name = nz(mm.group(1)), nz(mm.group(2))
    cands = by.get((slug, code, name), [])
    if not cands:  # 名称が折り返された行などは、同コードで名称の先頭が一致する行
        cands = [r for (s, c, n), rs in by.items() if s == slug and c == code and (n.startswith(name[:6]) or name.startswith(n[:6])) for r in rs]
    if not cands: res['no_m2_row'] += 1; continue
    parents = {kou[(slug, r['toc_kou_idx'])] for r in cands if (slug, r['toc_kou_idx']) in kou}
    if not parents: res['m2_without_parent'] += 1; continue
    gc, gn = nz(t['項コード']), nz(t['項名'])
    num = lambda s: int(re.sub(r'\D', '', s)) if re.sub(r'\D', '', s) else None
    okc = any(num(p[0]) is not None and num(p[0]) == num(gc) for p in parents)
    okn = any(nz(p[1]) == gn or nz(p[1]).startswith(gn[:8]) or gn.startswith(nz(p[1])[:8]) for p in parents)
    k = 'agree' if okc and okn else 'code_only' if okc else 'name_only' if okn else 'disagree'
    res[k + ('(multi-parent)' if len(parents) > 1 else '')] += 1
    if k != 'agree': bad.append((t.get('target_id'), k, sorted(parents), gc, gn))
total = sum(res.values())
found = total - res['no_m2_row'] - res['m2_without_parent'] - res['no_detail_row'] - res['no_code_in_row']
agree = res['agree'] + res['agree(multi-parent)']
print('RESOLVED rows:', total, dict(res)); print(f'found {found}; agree {agree} ({agree / found:.1%})' if found else 'nothing found')
for b in bad: print(' ', b)
