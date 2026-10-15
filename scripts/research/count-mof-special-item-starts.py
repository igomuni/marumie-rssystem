#!/usr/bin/env python3
"""特別会計 歳出事項別内訳 の項の開始行を、XML を木として読んで数え、公式 CSV の項の数（kou-special.csv）と比べる（記述のみ。read-only）。

  python3 -I scripts/research/count-mof-special-item-starts.py <out.json>

項の開始行 = 直接の行（data の直下の clm）のうち、列 2.1（項名）と 4.1（事項名）を持ち、列 1.1 か 1.4（項コード）を持つ行。
説明欄に入れ子の表がある場合も、入れ子の中の clm は数えない（木の直下だけ）。ElementTree は DTD を読まないので、DOCTYPE と XML 宣言は取り除く。
"""
import collections, csv, json, re, sys, xml.etree.ElementTree as ET

A = 'data/download/mof.go.jp/archive'
BASE = {'2024': '2024/2024', '2025': '2025/2025', '2025_teishutsu': '2025/2025_teishutsu'}
txt = lambda e: re.sub(r'\s+', '', ''.join(e.itertext()))


def main(out):
    inv = [r for r in csv.DictReader(open('tests/fixtures/mof-xml-structure-inventory/files.csv', encoding='utf-8')) if r['title_for_list'] == '歳出事項別内訳']
    res = {}
    for v in BASE:
        starts, nested_cells, per_file = [], 0, collections.Counter()
        for r in (x for x in inv if x['version'] == v):
            t = open(f"{A}/{BASE[v]}/xml/{r['file']}", 'rb').read().decode('cp932')
            root = ET.fromstring(re.sub(r'<\?xml[^>]*\?>|<!DOCTYPE[^>]*>', '', t))
            rows = collections.OrderedDict()
            for b in root.findall('body'):
                for tb in b.findall('table'):
                    for d in tb.findall('data'):
                        for c in d.findall('clm'):
                            m = re.match(r'p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)$', c.get('id'))
                            if c.find('.//table') is not None: nested_cells += 1; per_file[r['file']] += 1
                            rows.setdefault((m[1], m[2], m[3]), {})[f'{m[4]}.{m[5]}'] = txt(c)
            for k, c in rows.items():
                if '2.1' in c and '4.1' in c and ('1.1' in c or '1.4' in c): starts.append((r['file'], c.get('1.1', c.get('1.4')), c['2.1']))
        kou = list(csv.DictReader(open(f'tests/fixtures/mof-archive-csv/{v}/kou-special.csv', encoding='utf-8')))
        cs = collections.Counter((x['項コード'], re.sub(r'\s+', '', x['項名'])) for x in kou)
        xs = collections.Counter((c, n) for _, c, n in starts)
        res[v] = {'xml_item_start_rows': len(starts), 'official_csv_kou': len(kou), 'csv_only': sorted(map(list, (cs - xs).elements())), 'xml_only': sorted(map(list, (xs - cs).elements())),
                  'cells_with_nested_table': nested_cells, 'files_with_nested_table': dict(per_file)}
    json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(out, 'a').write('\n')
    print({v: (r['xml_item_start_rows'], r['official_csv_kou'], len(r['csv_only']), len(r['xml_only'])) for v, r in res.items()})


main(sys.argv[1])
