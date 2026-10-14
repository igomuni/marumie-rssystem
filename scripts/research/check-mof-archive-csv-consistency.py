#!/usr/bin/env python3
"""FY2024 一般会計の 項・目・事項 の CSV の、構造だけの整合を確かめる（記述のみ。read-only。対応づけは使わない）。

  python3 -I scripts/research/check-mof-archive-csv-consistency.py <out.json>

契約: docs/tasks/20261015_0822_MOF_Archive_CSV_Primitives_Contract.md の「確認」。
(1) 項の一致: jikou-general.csv の項の集合と kou-general.csv の項の集合。
(2) 金額の整合（記述）: 項ごとの 事項の当年度金額の合計と、目の当年度金額の合計。
(3) 提出時と成立後（FY2025）: kou/moku の行のキーの差と、金額が違う行の数。
(4) 説明欄の確認: XML の列 11（説明）が、事項の行にどう入っているか（空/非空、複数行にまたがるか）。
"""
import collections, csv, hashlib, io, json, os, re, sys

F = 'tests/fixtures/mof-archive-csv'
XML = 'data/download/mof.go.jp/archive/2024/2024/xml'


def read(p): return list(csv.DictReader(open(p, encoding='utf-8')))


def sha(p):
    with open(p, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def main(out):
    kou = read(f'{F}/2024/kou-general.csv'); jik = read(f'{F}/2024/jikou-general.csv'); moku = read(f'{F}/2024/moku-general.csv')
    kk = {(r['所管'], r['組織'], r['項コード'], r['項名']) for r in kou}
    jk = {(r['所管'], r['組織'], r['項コード'], r['項名']) for r in jik}
    res = {'inputs': {os.path.relpath(p): sha(p) for p in (f'{F}/2024/kou-general.csv', f'{F}/2024/jikou-general.csv', f'{F}/2024/moku-general.csv')} | {'script_sha256': sha(__file__)}}
    res['kou_match'] = {'kou_csv': len(kk), 'jikou_csv': len(jk), 'both': len(kk & jk), 'only_kou_csv': sorted(kk - jk)[:5], 'only_jikou_csv': sorted(jk - kk)[:5]}

    cur_h = [h for h in kou[0] if h.endswith('の合計')][0]
    moku_sum = {(r['所管'], r['組織'], r['項コード'], r['項名']): int(r[cur_h]) for r in kou}
    jik_sum = collections.defaultdict(int); jik_n = collections.Counter()
    for r in jik:
        k = (r['所管'], r['組織'], r['項コード'], r['項名']); jik_sum[k] += int(r['令和6年度要求額(千円)']); jik_n[k] += 1
    eq = [k for k in kk if k in jik_sum and jik_sum[k] == moku_sum[k]]
    ne = sorted((k for k in kk if k in jik_sum and jik_sum[k] != moku_sum[k]), key=lambda k: -abs(jik_sum[k] - moku_sum[k]))
    res['amount_consistency(当年度, 千円)'] = {'kou_with_jikou': sum(1 for k in kk if k in jik_sum), 'equal': len(eq), 'not_equal': len(ne),
        'total_moku': sum(moku_sum.values()), 'total_jikou': sum(jik_sum.values()),
        'not_equal_examples': [{'項': list(k), '目の合計': moku_sum[k], '事項の合計': jik_sum[k], '事項の数': jik_n[k]} for k in ne[:8]],
        'not_equal_by_jikou_count': dict(sorted(collections.Counter(jik_n[k] for k in ne).items()))}

    # (3) 提出時と成立後
    def keyrows(v, acct):
        rows = read(f'{F}/{v}/moku-{acct}.csv'); H = list(rows[0].keys())
        cur = H[len(H) - 4]   # source_row の前の3列の先頭 = 当年度
        return rows, H, cur
    cmpres = {}
    for acct in ('general', 'special'):
        a, Ha, ca = keyrows('2025', acct); b, Hb, cb = keyrows('2025_teishutsu', acct)
        ka = [tuple(r[h] for h in Ha[:len(Ha) - 4]) for r in a]; kb = [tuple(r[h] for h in Hb[:len(Hb) - 4]) for r in b]
        da, db = collections.Counter(ka), collections.Counter(kb)
        diff = [i for i in range(min(len(a), len(b))) if ka[i] == kb[i] and a[i][ca] != b[i][cb]]
        cmpres[acct] = {'rows': [len(a), len(b)], 'same_key_sequence': ka == kb, 'keys_only_in_enacted': sum((da - db).values()), 'keys_only_in_teishutsu': sum((db - da).values()),
                        'rows_with_different_current_amount': len(diff), 'sum_current(千円)': [sum(int(r[ca]) for r in a), sum(int(r[cb]) for r in b)]}
    res['fy2025_enacted_vs_teishutsu'] = cmpres

    # (4) 説明欄（列 11）
    clm = re.compile(r'<clm id="p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)"[^>]*>(.*?)</clm>', re.S)
    cdata = re.compile(r'<!\[CDATA\[(.*?)\]\]>', re.S)
    desc_rows = collections.defaultdict(list)   # row key -> list of non-empty col-11 texts
    files = sorted({r['source_file'] for r in jik})
    for f in files:
        t = open(f'{XML}/{f}', 'rb').read().decode('cp932', errors='replace')
        for m in clm.finditer(t):
            page, row, n, col, sub, body = m.groups()
            if col != '11': continue
            text = ''.join(cdata.findall(body)).strip()
            if text: desc_rows[(f, f'p{page}-{row}.{n}')].append(text)
    own = sum(1 for r in jik if desc_rows.get((r['source_file'], r['source_row'])))
    cont = [k for k in desc_rows if k not in {(r['source_file'], r['source_row']) for r in jik}]
    multi_in_row = sum(1 for k, v in desc_rows.items() if len(v) > 1)
    res['description_column(列11)'] = {'jikou_rows': len(jik), 'jikou_rows_with_nonempty_description_in_the_same_row': own,
        'jikou_rows_without': len(jik) - own, 'other_rows_with_description_text(continuation or other)': len(cont),
        'rows_with_more_than_one_description_cell': multi_in_row,
        'continuation_examples': [{'file': k[0], 'row': k[1], 'text': desc_rows[k][0][:40]} for k in sorted(cont)[:3]]}
    json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2, sort_keys=True); open(out, 'a').write('\n')
    print(json.dumps(res, ensure_ascii=False, indent=2, sort_keys=True))


main(sys.argv[1])
