#!/usr/bin/env python3
"""特別会計 歳出事項別内訳 の行の種類（列の構成）ごとに、件数・ファイル数・実例を列挙する（記述のみ。read-only）。

  python3 -I scripts/research/describe-mof-special-row-classes.py <out-dir>

入力: tests/fixtures/mof-xml-structure-inventory/files.csv の title_for_list = 歳出事項別内訳 のファイル（SHA-256 が一致しなければ STOP）。
出力: row-classes.csv（version, signature, rows, files, 実例3つ＝ファイル・行・セルの内容）。セルの内容は空白除去・先頭40文字。
"""
import collections, csv, hashlib, json, os, re, sys

A = 'data/download/mof.go.jp/archive'
BASE = {'2024': '2024/2024', '2025': '2025/2025', '2025_teishutsu': '2025/2025_teishutsu'}
CLM = re.compile(r'<clm id="p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)"[^>]*>(.*?)</clm>', re.S)
CD = re.compile(r'<!\[CDATA\[(.*?)\]\]>', re.S)


def main(out):
    inv = [r for r in csv.DictReader(open('tests/fixtures/mof-xml-structure-inventory/files.csv', encoding='utf-8')) if r['title_for_list'] == '歳出事項別内訳']
    agg = collections.OrderedDict()
    for r in inv:
        b = open(f"{A}/{BASE[r['version']]}/xml/{r['file']}", 'rb').read()
        if hashlib.sha256(b).hexdigest() != r['sha256']: sys.exit(f"STOP: sha mismatch {r['file']}")
        d = re.search(r'<data[^>]*>(.*?)</data>', b.decode('cp932'), re.S).group(1)
        rows = collections.OrderedDict()
        for g in CLM.findall(d):
            rows.setdefault(f'p{g[0]}-{g[1]}.{g[2]}', {})[f'{g[3]}.{g[4]}'] = re.sub(r'\s+', '', ''.join(CD.findall(g[5])))[:40]
        for k, c in rows.items():
            sig = ','.join(sorted(c, key=lambda x: tuple(map(int, x.split('.')))))
            a = agg.setdefault((r['version'], sig), {'rows': 0, 'files': set(), 'ex': []})
            a['rows'] += 1; a['files'].add(r['file'])
            if len(a['ex']) < 3: a['ex'].append({'file': r['file'], 'row': k, 'cells': c})
    os.makedirs(out, exist_ok=True)
    with open(f'{out}/row-classes.csv', 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, lineterminator='\n'); w.writerow(['version', 'signature', 'rows', 'files', 'examples'])
        for (v, sig), a in sorted(agg.items(), key=lambda kv: (kv[0][0], -kv[1]['rows'], kv[0][1])):
            w.writerow([v, sig, a['rows'], len(a['files']), json.dumps(a['ex'], ensure_ascii=False)])
    print({v: sum(1 for k in agg if k[0] == v) for v in BASE})


main(sys.argv[1])
