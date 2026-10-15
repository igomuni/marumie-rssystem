#!/usr/bin/env python3
"""inventory の files.csv から、一般会計 FY2025 の source set（target / nonTarget と SHA-256）を作る。parser の出力は使わない。

  python3 -I scripts/research/make-mof-xml-source-set.py <document> <version> <out.json>
"""
import csv, json, sys

doc, version, out = sys.argv[1:4]
rows = [r for r in csv.DictReader(open('tests/fixtures/mof-xml-structure-inventory/files.csv', encoding='utf-8')) if r['document'] == doc and r['version'] == version]
pick = lambda keep: [{'file': r['file'], 'sha256': r['sha256']} for r in sorted(rows, key=lambda r: r['file']) if keep(r)]
targets = pick(lambda r: r['title_for_list'] == '〔組織別事項別内訳〕')
non = pick(lambda r: r['title_for_list'] != '〔組織別事項別内訳〕')
json.dump({'schema': 'mof-xml-source-set/v1', 'document': doc, 'version': version, 'source': 'tests/fixtures/mof-xml-structure-inventory/files.csv',
           'xmlFiles': len(rows), 'targetTableFiles': len(targets), 'nonTargetFiles': len(non), 'targets': targets, 'nonTargets': non},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open(out, 'a').write('\n')
print(doc, version, len(rows), len(targets), len(non))
