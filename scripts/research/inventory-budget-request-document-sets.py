#!/usr/bin/env python3
"""概算要求 PDF の文書セット（TOC を持つ source と総表・明細表だけを持つ source の分割）の記述。記述のみ。

  python3 -I scripts/research/inventory-budget-request-document-sets.py <out-dir>
契約: docs/tasks/*_BudgetRequest_Document_Sets_Inventory_Contract.md
"""
import collections, csv, glob, json, os, re, sys

OUT = sys.argv[1]
ns = lambda s: re.sub(r'[\s　]+', '', s or '')
ld = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
R3 = re.compile(r'^(\d{3})\s*(.+)$')
HEAD = re.compile(r'^（項）\s*(\S+)\s+(.+)$')
os.makedirs(OUT, exist_ok=True)
src_rows, fam_rows, loc_rows = [], [], []
summary = {}
for year in ('2024', '2025'):
    B = f'tests/fixtures/budget-request-csv/{year}'
    corpus = {}
    cf = f'tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze.json'
    if os.path.exists(cf):
        for d in json.load(open(cf))['documents']:
            slug = d['localPdfPath'].replace('data/download/', '').replace('.pdf', '').replace('/', '__')
            corpus[slug] = (d.get('role') or '', d.get('account') or '', d.get('pageCount'))
    data = {}
    for kind in ('toc', 'total-table', 'detail-table'):
        for f in sorted(glob.glob(f'{B}/{kind}/sources/*.csv')):
            data.setdefault(os.path.basename(f)[:-4], {})[kind] = ld(f)
    info = {}
    for slug, k in sorted(data.items()):
        kous = [(m[1], ns(m[2])) for r in k.get('toc', []) if (m := HEAD.match(r['区分']))]
        tot3 = [(m[1], ns(m[2])) for r in k.get('total-table', []) if r['row_type'] == 'CODE3' and (m := R3.match(r['区分']))]
        det3 = [(m[1], ns(m[2])) for r in k.get('detail-table', []) if r['row_type'] == 'CODE3' and (m := R3.match(r['事項']))]
        ctx = next((r['事項'] for r in k.get('detail-table', []) if r['row_type'] == 'CONTEXT'), '')
        moku = sum(1 for r in k.get('detail-table', []) if r['row_type'] == 'CODE_5_4_2_4')
        fam = re.sub(r'[_\-]?\d+$', '', slug)
        role, account, pages = corpus.get(slug, ('', '', ''))
        info[slug] = dict(fam=fam, kous=kous, tot3=set(tot3), det3=set(det3), ctx=ctx)
        src_rows.append([year, slug, fam, int('toc' in k), int('total-table' in k), int('detail-table' in k), len(kous), len(tot3), len(det3), int(bool(ctx)), ctx, moku, role, account, pages])
    fams = collections.defaultdict(list)
    for slug, i in info.items(): fams[i['fam']].append(slug)
    for fam, members in sorted(fams.items()):
        comp = collections.Counter(('T' if 'toc' in data[s] else '-') + ('S' if 'total-table' in data[s] else '-') + ('D' if 'detail-table' in data[s] else '-') for s in members)
        fam_rows.append([year, fam, len(members), ' '.join(f'{k}:{v}' for k, v in sorted(comp.items()))])
    # TOC の項の所在（同じファミリー内）
    stats = collections.Counter()
    for slug, i in info.items():
        if not i['kous']: continue
        for code, name in i['kous']:
            where = [s for s in fams[i['fam']] if (code, name) in info[s]['det3'] or (code, name) in info[s]['tot3']]
            own = slug in where; other = [s for s in where if s != slug]
            cat = ('own_only' if own and not other else 'own_and_other' if own else 'other_only' if other else 'none')
            stats[cat] += 1
            loc_rows.append([year, slug, code, name, cat, len(where), ';'.join(other[:3])])
    # TOC のない source の CODE3 が、同じファミリーの TOC の項に一致する割合
    notoc = collections.Counter()
    for slug, i in info.items():
        if i['kous']: continue
        tocs = [s for s in fams[i['fam']] if info[s]['kous']]
        keys = i['det3'] | i['tot3']
        hit = {k for k in keys if any(k in set(info[t]['kous']) for t in tocs)}
        notoc['sources_without_toc'] += 1; notoc['family_has_toc_source'] += bool(tocs)
        notoc['code3_keys'] += len(keys); notoc['code3_keys_matching_a_family_toc_kou'] += len(hit)
    summary[year] = dict(sources=len(info), sources_with_toc=sum(1 for i in info.values() if i['kous']), families=len(fams), families_with_multiple_sources=sum(1 for v in fams.values() if len(v) > 1),
                         toc_kou_location=dict(stats), sources_without_toc=dict(notoc))
w = lambda name, h, rows: csv.writer(open(f'{OUT}/{name}', 'w', encoding='utf-8', newline=''), lineterminator='\n').writerows([h] + rows)
w('sources.csv', ['year', 'source', 'family', 'has_toc', 'has_total', 'has_detail', 'toc_kou', 'total_code3', 'detail_code3', 'has_context', 'first_context', 'detail_moku_rows', 'corpus_role', 'corpus_account', 'corpus_pages'], src_rows)
w('families.csv', ['year', 'family', 'sources', 'composition(T=toc S=total D=detail)'], fam_rows)
w('toc-kou-location.csv', ['year', 'toc_source', 'code3', 'name', 'location', 'n_sources_where_found', 'other_sources'], loc_rows)
json.dump(summary, open(f'{OUT}/summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False, indent=1))
