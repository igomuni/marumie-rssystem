#!/usr/bin/env python3
"""明細表 CSV と MOF 正規化データの「キー」の棚卸し（read-only。突合・match率は計算しない）。

  python3 -I scripts/research/inventory-detail-table-mof-keys.py [MOF normalized fy2024 dir]

両側の値の分布を別々に数えるだけで、両側の共通部分（積集合）は取らない。標準出力は JSON。
入力: data/work/budget-request-csv/2024/detail-table/sources/*.csv、
      <MOF dir>/budget-jikou.jsonl・budget-items.jsonl（既定 ~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024）
"""
import collections, csv, glob, json, os, re, sys

D = 'data/work/budget-request-csv/2024/detail-table/sources/'
M = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024')
HY = '[‑-]'
C4 = re.compile(rf'^([0-9 ]{{1,5}}){HY}([0-9 ]{{1,4}}){HY}([0-9]{{2}}){HY}([0-9]{{4}})(?:\s|$)')
DT = re.compile(rf'^([0-9]{{2}}){HY}([0-9]{{2}})\s')


def main():
    rows_by_type, ctx_rows, no_ctx_sources, rows_by_ctx = collections.Counter(), collections.Counter(), 0, collections.Counter()
    seg, c4_total, c4_damaged, c4_other_damage, dsuf = collections.Counter(), 0, 0, 0, collections.Counter()
    per_ctx_forms = collections.Counter()
    for f in sorted(glob.glob(D + '*.csv')):
        ctx, seen = None, False
        for r in csv.DictReader(open(f, encoding='utf-8')):
            t = r['row_type']; rows_by_type[t] += 1
            if t == 'CONTEXT':
                m = re.match(r'^([0-9]+)', r['事項']); ctx = '会計コード(4桁)' if m and len(m.group(1)) == 4 else '所管コード(2桁)'
                ctx_rows[ctx] += 1; seen = True; continue
            rows_by_ctx[(ctx or 'CONTEXT行なし（source内に所管・会計の行がない）', t)] += 1
            if t == 'CODE_5_4_2_4':
                m = C4.match(r['事項']); c4_total += 1
                if not m: c4_other_damage += 1; continue
                seg[m.group(3)] += 1
                damaged = ' ' in m.group(1).strip() or ' ' in m.group(2).strip() or len(m.group(1).strip()) != 5 or len(m.group(2).strip()) != 4
                c4_damaged += damaged
                if len(m.group(1).strip()) != 5: c4_other_damage += 0
            if t == 'DETAIL':
                m = DT.match(r['事項']); dsuf[m.group(2) if m else '(不明)'] += 1
        if not seen: no_ctx_sources += 1
    # セグメント別の欠け: どの区画が欠けるか
    seg_dmg = collections.Counter()
    for f in sorted(glob.glob(D + '*.csv')):
        for r in csv.DictReader(open(f, encoding='utf-8')):
            if r['row_type'] != 'CODE_5_4_2_4': continue
            m = C4.match(r['事項'])
            if not m: continue
            a, b = m.group(1), m.group(2)
            seg_dmg['第1区画（5桁）に空白または桁不足'] += (' ' in a.strip() or len(a.strip()) != 5)
            seg_dmg['第2区画（4桁）に空白または桁不足'] += (' ' in b.strip() or len(b.strip()) != 4)
    out = {'detail': {'rows_by_type': dict(rows_by_type), 'context_rows': dict(ctx_rows), 'sources_without_context_row': no_ctx_sources,
                      'rows_by_context_and_type': {f'{k[0]} / {k[1]}': v for k, v in sorted(rows_by_ctx.items())},
                      'code_5_4_2_4': {'total': c4_total, 'not_matching_pattern': c4_other_damage, 'segment_damage': dict(seg_dmg),
                                       'third_segment_values_top': seg.most_common(12), 'third_segment_distinct': len(seg)},
                      'detail_suffix_top': dsuf.most_common(10), 'detail_suffix_distinct': len(dsuf)}}
    J = [json.loads(l) for l in open(f'{M}/budget-jikou.jsonl', encoding='utf-8')]
    I = [json.loads(l) for l in open(f'{M}/budget-items.jsonl', encoding='utf-8')]
    ini = [r for r in I if r['phase'] == 'initial']
    out['mof'] = {'jikou': {'rows': len(J), 'accountType': dict(collections.Counter(j['accountType'] for j in J)), 'ministries': sorted({j['ministry'] for j in J}),
                            'distinct_jikouName': len({j['jikouName'] for j in J}), 'col4Raw_top': collections.Counter(j['col4Raw'] for j in J).most_common(10),
                            'sectionCode_len': dict(collections.Counter(len(j['sectionCode']) for j in J)),
                            'amount_columns': J[0]['sourceAmountColumns']},
                  'items_initial': {'rows': len(ini), 'by_account': dict(collections.Counter(r['accountType'] for r in ini)),
                                    'sectionCode_len_by_account': {f'{k[0]}:{k[1]}': v for k, v in collections.Counter((r['accountType'], len(r['sectionCode'])) for r in ini).items()},
                                    'subItemCode_len': dict(collections.Counter(len(r['subItemCode'] or '') for r in ini)),
                                    'subItemCode_empty': sum(1 for r in ini if not r['subItemCode']),
                                    'phases_in_file': dict(collections.Counter(r['phase'] for r in I))}}
    g = collections.defaultdict(collections.Counter)
    for r in ini:
        if r['subItemCode']: g[r['subItemCode']][r['subItemName']] += 1
    out['mof']['items_initial']['subItemName_examples'] = {c: g[c].most_common(2) for c in ['05', '09', '14', '16'] if c in g}
    print(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True))


main()
