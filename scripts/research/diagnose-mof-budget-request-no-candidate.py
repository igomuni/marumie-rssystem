#!/usr/bin/env python3
"""突合の NO_CANDIDATE（M1 項・M2 事項）が一致しなかった理由を固定の分類で数える（記述のみ）。
python3 -I scripts/research/diagnose-mof-budget-request-no-candidate.py <out-dir>
契約: docs/tasks/*_MOF_x_BudgetRequest_NoCandidate_Diagnosis_Contract.md"""
import collections, csv, json, os, re, sys, unicodedata

OUT = sys.argv[1]
M = 'tests/fixtures/mof-budget-request-match'; A = 'tests/fixtures/mof-archive-csv'
ns = lambda s: re.sub(r'[\s　]+', '', s or '')
nn = lambda s: re.sub(r'[\s　（）()「」『』・、，,．.‐-―\-]+', '', unicodedata.normalize('NFKC', s or ''))
ld = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
rows_out, counts = [], collections.Counter()
for v in ('2024', '2025_teishutsu'):
    kou = {a: ld(f'{A}/{v}/kou-{a}.csv') for a in ('general', 'special')}
    jik = {a: ld(f'{A}/{v}/jikou-{a}.csv') for a in ('general', 'special')}
    kjk = lambda r, a: (tuple(ns(r[c]) for c in ('所管', '組織', '項コード', '項名')) if a == 'general' else tuple(ns(r[c]) for c in ('特別会計', '勘定', '項コード', '項名')))
    # M1 の範囲 → 項名の集合
    scope_kou = collections.defaultdict(set)
    all_kou = {a: collections.defaultdict(set) for a in kou}
    for a in kou:
        for r in kou[a]:
            sc = '|'.join([ns(r['所管']), ns(r['組織'])] if a == 'general' else [ns(r['特別会計']), ns(r['勘定'])])
            scope_kou[sc].add(ns(r['項名'])); all_kou[a][ns(r['項名'])].add(sc)
    # M2: kou 行 id → 事項名の集合
    jik_by_kou = {a: collections.defaultdict(set) for a in jik}
    all_jik = {a: collections.defaultdict(set) for a in jik}
    for a in jik:
        for r in jik[a]:
            jik_by_kou[a][kjk(r, a)].add(ns(r['事項名'])); all_jik[a][ns(r['事項名'])].add('|'.join(kjk(r, a)[:2]))
    def classify(name, pool, elsewhere):
        n = ns(name)
        if elsewhere: return 'exact_elsewhere', '; '.join(sorted(elsewhere)[:3])
        k = nn(name)
        for p in sorted(pool):
            if nn(p) == k and p != n: return 'variant_in_scope', p
        if len(k) >= 4:
            for p in sorted(pool):
                q = nn(p)
                if len(q) >= 4 and (q.startswith(k) or k.startswith(q)): return 'prefix_in_scope', p
        return 'absent', ''
    for layer, f in (('M1', 'm1-kou.csv'), ('M2', 'm2-jikou.csv')):
        for r in ld(f'{M}/{v}/{f}'):
            if r['status'] != 'NO_CANDIDATE': continue
            name = r['request_name']
            if layer == 'M1':
                sc = r['request_scope']; a = 'general' if any(sc == '|'.join([ns(x['所管']), ns(x['組織'])]) for x in kou['general'][:0]) else None
                a = 'general' if sc in {'|'.join([ns(x['所管']), ns(x['組織'])]) for x in kou['general']} else 'special'
                pool = scope_kou.get(sc, set()); el = all_kou[a].get(ns(name), set()) - {sc}
            else:
                kid = r['mof_kou_row']; t, i = kid.split(':'); a = t.split('-')[1]; krow = kou[a][int(i) - 1]
                # kou 行 → jikou の索引キー（所管,組織,項コード,項名 ／ 特別会計,勘定,項コード,項名）
                key = kjk(krow, a); pool = jik_by_kou[a].get(key, set()); sc = '|'.join(key[:2]); el = all_jik[a].get(ns(name), set()) - {sc}
            cat, near = classify(name, pool, el)
            counts[(v, layer, cat)] += 1
            rows_out.append([v, layer, r['request_source'], name, sc, cat, near])
os.makedirs(OUT, exist_ok=True)
csv.writer(open(f'{OUT}/no-candidate-diagnosis.csv', 'w', encoding='utf-8', newline=''), lineterminator='\n').writerows([['mof_version', 'layer', 'request_source', 'request_name', 'scope', 'category', 'nearest_or_elsewhere']] + rows_out)
js = collections.defaultdict(dict)
for (v, l, c), n in sorted(counts.items()): js[f'{v}/{l}'][c] = n
json.dump(js, open(f'{OUT}/no-candidate-diagnosis.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(js, ensure_ascii=False, indent=1))
