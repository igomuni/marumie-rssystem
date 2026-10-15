#!/usr/bin/env python3
"""明細表の行の並びから階層（項・勘定・会計）を決める 3 つの規則を、TOC の見出しを正解として評価する（記述のみ）。
python3 -I scripts/research/evaluate-budget-request-hierarchy-rules-detail.py <out-dir>
契約: docs/tasks/*_BudgetRequest_Hierarchy_From_Detail_Contract.md"""
import collections, csv, glob, json, os, re, sys, unicodedata

OUT = sys.argv[1]
fold = lambda s: re.sub(r'[｡-ﾟ]+', lambda m: unicodedata.normalize('NFKC', m[0]), re.sub(r'[！-～]', lambda m: chr(ord(m[0]) - 0xFEE0), s or ''))
ns = lambda s: re.sub(r'[\s　]+', '', fold(s))
ld = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
TOC = re.compile(r'^（([^）]*)）\s*(\S+)\s+(.+)$'); CODE = re.compile(r'^(\d+)\s*(.+)$')
res, errs = {}, []
for year, ver in (('2024', '2024'), ('2025', '2025_teishutsu')):
    accounts = {ns(r['特別会計']) for r in ld(f'tests/fixtures/mof-archive-csv/{ver}/kou-special.csv')}
    B = f'tests/fixtures/budget-request-csv/{year}'
    tp, fn, fp = (collections.Counter() for _ in range(3)); sources = 0; skipped = collections.Counter()
    for f in sorted(glob.glob(f'{B}/toc/sources/*.csv')):
        slug = os.path.basename(f)[:-4]; df = f'{B}/detail-table/sources/{slug}.csv'
        if not os.path.exists(df): skipped['no_detail_table'] += 1; continue
        sources += 1
        truth = collections.defaultdict(set)
        for r in ld(f):
            m = TOC.match(r['区分'])
            if m and m[1] in ('項', '勘定', '会計'): truth[m[1]].add((m[2], ns(m[3])))
        rows = ld(df); cand = collections.defaultdict(set)
        for i, r in enumerate(rows):
            t = r['row_type']; nxt = rows[i + 1]['row_type'] if i + 1 < len(rows) else None
            m = CODE.match(r['事項'])
            if not m: continue
            key = (m[1], ns(m[2]))
            if t == 'CODE3' and nxt == 'DETAIL': cand['項'].add(key)
            if t == 'CODE1': cand['勘定'].add(key)
            if t == 'CODE2' and len(m[1]) == 2 and ns(m[2]) in accounts: cand['会計'].add(key)
        for k in ('項', '勘定', '会計'):
            tp[k] += len(truth[k] & cand[k]); fn[k] += len(truth[k] - cand[k]); fp[k] += len(cand[k] - truth[k])
            for x in sorted(truth[k] - cand[k]): errs.append([year, slug, k, 'fn', x[0], x[1]])
            for x in sorted(cand[k] - truth[k]): errs.append([year, slug, k, 'fp', x[0], x[1]])
    res[year] = {'sources_evaluated': sources, 'skipped': dict(skipped), 'rules': {k: {'tp': tp[k], 'fn': fn[k], 'fp': fp[k]} for k in ('項', '勘定', '会計')}}
os.makedirs(OUT, exist_ok=True)
json.dump(res, open(f'{OUT}/rule-evaluation.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
csv.writer(open(f'{OUT}/rule-errors.csv', 'w', encoding='utf-8', newline=''), lineterminator='\n').writerows([['year', 'source', 'level', 'kind', 'code', 'name']] + errs)
print(json.dumps(res, ensure_ascii=False, indent=1))
