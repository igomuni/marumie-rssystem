#!/usr/bin/env python3
"""第 2 ラウンド（契約の追補）。項コード K0 と、目のコードの候補 H1/H3/H4 の一致を数える（記述のみ）。

  python3 -I scripts/research/inventory-mof-budget-request-codes-round2.py <out-dir>
"""
import collections, csv, glob, json, os, re, sys

OUT = sys.argv[1]
REQ, MOF = 'data/work/budget-request-csv', 'tests/fixtures/mof-archive-csv'
PAIRS = [('2024', '2024'), ('2025', '2025_teishutsu'), ('2025', '2025')]
ns = lambda s: re.sub(r'[\s　]+', '', s or '')
ld = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
R_CONTEXT = re.compile(r'^(\d+)\s*(.+)$'); R_CODE3 = re.compile(r'^(\d{3})\s*(.+)$'); R_MOKU = re.compile(r'^(\d{5})‑\s*(\d+)‑\s*(\d+)‑\s*(\d+)\s*(.+)$')


def requests(year, kind):
    for f in sorted(glob.glob(f'{REQ}/{year}/{kind}/sources/*.csv')):
        for r in ld(f): yield os.path.basename(f)[:-4], r


out = {}
for year, ver in PAIRS:
    b = f'{MOF}/{ver}'
    pool = {a: collections.defaultdict(lambda: {'kou': [], 'moku': []}) for a in ('general', 'special')}
    for r in ld(f'{b}/kou-general.csv'): pool['general'][ns(r['所管'])]['kou'].append((r['項コード'], ns(r['項名'])))
    for r in ld(f'{b}/kou-special.csv'): pool['special'][ns(r['特別会計'])]['kou'].append((r['項コード'], ns(r['項名'])))
    for r in ld(f'{b}/moku-general.csv'): pool['general'][ns(r['所管'])]['moku'].append(dict(m=r['主要経費別分類コード'], p=r['目的別分類コード'], z=r['財政法公債金対象非対象別分類コード'], e=r['経済性質別分類コード'], u=r['使途別分類コード'], k=r['目別分類コード'], n=ns(r['目名'])))
    for r in ld(f'{b}/moku-special.csv'): pool['special'][ns(r['特別会計'])]['moku'].append(dict(m=r['主要経費別分類コード'], p=r['目的別分類コード'], z=None, e=r['経済性質別分類コード'], u=r['使途別分類コード'], k=r['目別分類コード'], n=ns(r['目名'])))
    ctx = {}
    for slug, r in requests(year, 'detail-table'):
        if r['row_type'] != 'CONTEXT' or slug in ctx: continue
        m = R_CONTEXT.match(r['事項'])
        if not m: continue
        name = ns(m[2]); acct = 'general' if len(m[1]) == 2 else 'special'
        key = name.split('所管')[0] if acct == 'general' else re.sub(r'特別会計.*$', '', name)
        if key in pool[acct]: ctx[slug] = (acct, key)
    res = collections.Counter()
    for kind in ('detail-table', 'total-table'):
        for slug, r in requests(year, kind):
            t = r['row_type']; txt = r['事項'] if kind == 'detail-table' else r['区分']
            if slug not in ctx: continue
            acct, key = ctx[slug]; P = pool[acct][key]; tag = f'{kind}:{acct}'
            if t == 'CODE3':
                m = R_CODE3.match(txt)
                if not m: continue
                cands = [c for c, n in P['kou'] if n == ns(m[2])]
                if cands:
                    res[f'{tag}:K0:name_match'] += 1
                    res[f'{tag}:K0:code3=kou_code'] += any(m[1] == c for c in cands)
            elif t == 'CODE_5_4_2_4' and kind == 'detail-table':
                m = R_MOKU.match(txt)
                if not m: continue
                cands = [c for c in P['moku'] if c['n'] == ns(m[5])]
                if not cands: continue
                c1, x, yy = m[1], m[2], m[3]; L = len(x)
                res[f'{tag}:moku:x_len={L}:name_match'] += 1
                H = {'H1': lambda c: x == c['u'], 'H3': lambda c: x == c['e'] + c['u'], 'H4': lambda c: c['z'] is not None and x == c['z'] + c['e'] + c['u']}
                base = lambda c: (c1[:2], c1[2:], yy) == (c['m'], c['p'], c['k'])
                for h, f in H.items():
                    if h == 'H4' and acct == 'special': continue
                    res[f'{tag}:moku:x_len={L}:{h}'] += any(base(c) and f(c) for c in cands)
    out[f'request{year}__mof{ver}'] = dict(res)
os.makedirs(OUT, exist_ok=True)
json.dump(out, open(f'{OUT}/cross-relations-round2.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok')
