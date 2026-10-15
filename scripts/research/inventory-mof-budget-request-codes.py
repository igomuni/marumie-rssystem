#!/usr/bin/env python3
"""MOF の CSV と概算要求の CSV のコード体系・文法・一致の件数を数える（記述のみ。選択も判定もしない）。

  python3 -I scripts/research/inventory-mof-budget-request-codes.py <out-dir>

契約: docs/tasks/*_MOF_x_BudgetRequest_Code_System_Inventory_Contract.md。名称は空白を除いた完全一致だけを使う。
出力: request-grammar.csv, context-forms.csv, cross-relations.json, summary.json
"""
import collections, csv, glob, hashlib, json, os, re, sys

OUT = sys.argv[1]
REQ = 'tests/fixtures/budget-request-csv'
MOF = 'tests/fixtures/mof-archive-csv'
PAIRS = [('2024', '2024'), ('2025', '2025_teishutsu'), ('2025', '2025')]  # (概算要求の年度, MOF の版)
ns = lambda s: re.sub(r'[\s　]+', '', s or '')
shape = lambda s: re.sub(r'\d', 'N', s)
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
ld = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
R_CONTEXT = re.compile(r'^(\d+)\s*(.+)$')
R_CODE3 = re.compile(r'^(\d{3})\s*(.+)$')
R_DETAIL = re.compile(r'^(\d{2})‑(\d{2})\s*(.+)$')
R_MOKU = re.compile(r'^(\d{5})‑\s*(\d+)‑\s*(\d+)‑\s*(\d+)\s*(.+)$')


def requests(year, kind):
    for f in sorted(glob.glob(f'{REQ}/{year}/{kind}/sources/*.csv')):
        slug = os.path.basename(f)[:-4]
        for r in ld(f): yield slug, r


def main():
    os.makedirs(OUT, exist_ok=True)
    grammar, forms = [], []
    inputs = {}
    # ---- 1,2: 文法・CONTEXT の形
    for year in ('2024', '2025'):
        for kind, col in (('total-table', '区分'), ('detail-table', '事項')):
            cnt = collections.Counter(); trans = collections.Counter(); shp = collections.Counter(); prev = {}
            ctxforms = collections.Counter(); ex = {}
            for slug, r in requests(year, kind):
                t = r['row_type']; cnt[t] += 1
                trans[(prev.get(slug, '(start)'), t)] += 1; prev[slug] = t
                txt = r[col]
                if t == 'CODE_5_4_2_4':
                    m = R_MOKU.match(txt); code = f'{m[1]}-{m[2]}-{m[3]}-{m[4]}' if m else ns(txt.split(' ')[0])
                else: code = txt.split(' ')[0] if txt else ''
                shp[(t, shape(re.sub(r'‑', '-', code)) if t != 'HIER' else '(name)')] += 1
                if kind == 'detail-table' and t == 'CONTEXT':
                    m = R_CONTEXT.match(txt)
                    form = (len(m[1]) if m else 0, '所管' if m and '所管' in m[2] else '特別会計' if m and '特別会計' in m[2] else 'other')
                    ctxforms[form] += 1; ex.setdefault(form, txt)
            for t, n in sorted(cnt.items()): grammar.append([year, kind, 'row_type', t, '', n])
            for (a, b), n in sorted(trans.items()): grammar.append([year, kind, 'transition', a, b, n])
            for (t, s), n in sorted(shp.items()): grammar.append([year, kind, 'code_shape', t, s, n])
            for (d, k), n in sorted(ctxforms.items()): forms.append([year, d, k, n, ex[(d, k)]])
    with open(f'{OUT}/request-grammar.csv', 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, lineterminator='\n'); w.writerow(['year', 'doc', 'kind', 'a', 'b', 'count']); w.writerows(grammar)
    with open(f'{OUT}/context-forms.csv', 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, lineterminator='\n'); w.writerow(['year', 'code_digits', 'name_kind', 'count', 'example']); w.writerows(forms)

    # ---- 3,4: 名称・コードの一致の件数
    rel = {}
    for year, ver in PAIRS:
        base = f'{MOF}/{ver}'
        for f in ('kou-general', 'kou-special', 'jikou-general', 'jikou-special', 'moku-general', 'moku-special'): inputs[f'{ver}/{f}.csv'] = sha(f'{base}/{f}.csv')
        gen = {'kou': ld(f'{base}/kou-general.csv'), 'jikou': ld(f'{base}/jikou-general.csv'), 'moku': ld(f'{base}/moku-general.csv')}
        spc = {'kou': ld(f'{base}/kou-special.csv'), 'jikou': ld(f'{base}/jikou-special.csv'), 'moku': ld(f'{base}/moku-special.csv')}
        # 範囲（プール）: 一般会計は 所管、特別会計は 特別会計 の名前
        pool = {'general': collections.defaultdict(lambda: collections.defaultdict(list)), 'special': collections.defaultdict(lambda: collections.defaultdict(list))}
        for r in gen['kou']: pool['general'][ns(r['所管'])]['kou'].append((r['項コード'], ns(r['項名'])))
        for r in gen['jikou']: pool['general'][ns(r['所管'])]['jikou'].append((r['項コード'], ns(r['事項名']), r['主要経費別分類コード']))
        for r in gen['moku']: pool['general'][ns(r['所管'])]['moku'].append((r['主要経費別分類コード'], r['目的別分類コード'], r['経済性質別分類コード'], r['使途別分類コード'], r['目別分類コード'], ns(r['目名'])))
        for r in spc['kou']: pool['special'][ns(r['特別会計'])]['kou'].append((r['項コード'], ns(r['項名'])))
        for r in spc['jikou']: pool['special'][ns(r['特別会計'])]['jikou'].append((r['項コード'], ns(r['事項名']), r['分類コード']))
        for r in spc['moku']: pool['special'][ns(r['特別会計'])]['moku'].append((r['主要経費別分類コード'], r['目的別分類コード'], r['経済性質別分類コード'], r['使途別分類コード'], r['目別分類コード'], ns(r['目名'])))
        # 目のキーの重複（経済性質別だけが違う行）: 項単位（事項の列がない）
        dup = {}
        for acct, rows, kcol in (('general', gen['moku'], '所管'), ('special', spc['moku'], '特別会計')):
            g = collections.Counter((r[kcol], r['項コード'], r['主要経費別分類コード'], r['目的別分類コード'], r['使途別分類コード'], r['目別分類コード']) for r in rows)
            dup[acct] = {'moku_keys_without_keizai': len(g), 'keys_with_2plus_rows': sum(1 for n in g.values() if n > 1), 'moku_rows': len(rows)}
        ctx_of = {}   # slug → (account, プール名 or None, 生の CONTEXT)
        res = {'context': collections.Counter(), 'context_unmapped': [], 'kou': collections.Counter(), 'jikou': collections.Counter(), 'moku': collections.Counter(), 'mof_moku_structure': dup}
        for slug, r in requests(year, 'detail-table'):
            if r['row_type'] != 'CONTEXT' or slug in ctx_of: continue
            m = R_CONTEXT.match(r['事項'])
            if not m: res['context']['unparsed'] += 1; continue
            code, name = m[1], ns(m[2])
            if len(code) == 2:
                acct, key = 'general', name.split('所管')[0]
            else:
                acct, key = 'special', re.sub(r'特別会計.*$', '', name)
            ok = key in pool[acct]
            res['context'][f'{acct}:{"mapped" if ok else "unmapped"}'] += 1
            if not ok: res['context_unmapped'].append(r['事項'])
            ctx_of[slug] = (acct, key if ok else None)
        for docname, kind in (('detail', 'detail-table'), ('total', 'total-table')):
            cur = {}
            for slug, r in requests(year, kind):
                t = r['row_type']
                txt = r['事項'] if kind == 'detail-table' else r['区分']
                scope = ctx_of.get(slug)
                if t not in ('CODE3', 'DETAIL', 'CODE_5_4_2_4'): continue
                tag = f'{docname}:{t}'
                if not scope or scope[1] is None: res['kou' if t == 'CODE3' else 'jikou' if t == 'DETAIL' else 'moku'][f'{tag}:no_scope'] += 1; continue
                acct, key = scope; P = pool[acct][key]
                if t == 'CODE3':
                    m = R_CODE3.match(txt)
                    if not m: res['kou'][f'{tag}:unparsed'] += 1; continue
                    cands = [c for c, n in P['kou'] if n == ns(m[2])]
                    st = 'name_no_match' if not cands else ('name_match_1' if len(cands) == 1 else 'name_match_2plus')
                    res['kou'][f'{tag}:{st}'] += 1
                    if cands:
                        c3 = m[1]
                        res['kou'][f'{tag}:code=cand+0'] += any(c3 == c + '0' for c in cands)
                        res['kou'][f'{tag}:code[:2]=cand(not +0)'] += (not any(c3 == c + '0' for c in cands)) and any(c3[:2] == c for c in cands)
                        res['kou'][f'{tag}:code_neither'] += not any(c3[:2] == c for c in cands)
                elif t == 'DETAIL':
                    m = R_DETAIL.match(txt)
                    if not m: res['jikou'][f'{tag}:unparsed'] += 1; continue
                    cands = [(c, k) for c, n, k in P['jikou'] if n == ns(m[3])]
                    st = 'name_no_match' if not cands else ('name_match_1' if len(cands) == 1 else 'name_match_2plus')
                    res['jikou'][f'{tag}:{st}'] += 1
                    if cands:
                        res['jikou'][f'{tag}:first=kou_code'] += any(m[1] == c for c, k in cands)
                        res['jikou'][f'{tag}:second=class_code'] += any(m[2] == k for c, k in cands)
                        res['jikou'][f'{tag}:both_same_cand'] += any(m[1] == c and m[2] == k for c, k in cands)
                else:
                    m = R_MOKU.match(txt)
                    if not m: res['moku'][f'{tag}:unparsed'] += 1; continue
                    cands = [c for c in P['moku'] if c[5] == ns(m[5])]
                    st = 'name_no_match' if not cands else ('name_match_1' if len(cands) == 1 else 'name_match_2plus')
                    res['moku'][f'{tag}:{st}'] += 1
                    c1, c2, c3 = m[1], m[2], m[3]
                    S = lambda c: (c1[:2], c1[2:], c2, c3) == (c[0], c[1], c[3], c[4])
                    G = lambda c: len(c2) == 4 and (c1[:2], c1[2:], c2[:2], c2[2:], c3) == (c[0], c[1], c[2], c[3], c[4])
                    if cands:
                        s, g = any(S(c) for c in cands), any(G(c) for c in cands)
                        res['moku'][f'{tag}:S'] += s; res['moku'][f'{tag}:G'] += g
                        res['moku'][f'{tag}:S_and_G'] += s and g; res['moku'][f'{tag}:neither'] += (not s) and (not g)
        rel[f'request{year}__mof{ver}'] = {k: (dict(v) if isinstance(v, collections.Counter) else v) for k, v in res.items()}
    json.dump(rel, open(f'{OUT}/cross-relations.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump({'mof_inputs': inputs, 'pairs': [list(p) for p in PAIRS]}, open(f'{OUT}/summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('ok', {k: list(v)[:0] or len(v) for k, v in rel.items()})


main()
