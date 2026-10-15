#!/usr/bin/env python3
"""MOF 予算書 XML の構造 inventory（記述のみ。parser は通さない。read-only）。

  python3 -I scripts/research/inventory-mof-xml-structure.py <out-dir>

契約: docs/tasks/20261015_0919_MOF_XML_Structure_Inventory_Contract.md。
<out-dir> に files.csv, summary.json, menu-chains.csv, documents.json を書く。
目次（menu）が列挙する XML の集合と、ディスク上の XML の集合が一致しなければ STOP する。
"""
import collections, csv, hashlib, json, os, re, sys

A = 'data/download/mof.go.jp/archive'
DOCS = [  # (document, version, 置き場)
    ('202411001', '2024', '2024/2024'), ('202412001', '2024', '2024/2024'),
    ('202511001', '2025', '2025/2025'), ('202512001', '2025', '2025/2025'),
    ('202511001', '2025_teishutsu', '2025/2025_teishutsu'), ('202512001', '2025_teishutsu', '2025/2025_teishutsu'),
]
CLM = re.compile(r'<clm id="p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)"[^>]*>(.*?)</clm>', re.S)
CDATA = re.compile(r'<!\[CDATA\[(.*?)\]\]>', re.S)
LINEOUT = re.compile(r'LineOut\((\d+),(\d+),"([^"]*)","([^"]*)","[^"]*"\)')


def sha(b): return hashlib.sha256(b).hexdigest()


def sect(t, tag):
    m = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', t, re.S)
    return m.group(1) if m else None


def ctext(s): return re.sub(r'\s+', '', ''.join(CDATA.findall(s or '')))


def main(out):
    files, menu_rows, documents = [], [], []
    for doc, version, base in DOCS:
        root = f'{A}/{base}'
        main_p, menu_p = f'{root}/html/{doc}Main.html', f'{root}/html/{doc}menu.html'
        if not (os.path.exists(main_p) and os.path.exists(menu_p)): sys.exit(f'STOP: {doc}/{version} Main or menu missing')
        menu_b = open(menu_p, 'rb').read(); menu = menu_b.decode('euc-jp')
        chain, chains, listed = [], {}, []
        for m in LINEOUT.finditer(menu):
            level = int(m.group(1)); del chain[level - 1:]; chain.append(m.group(3))
            f = m.group(4).split('#')[0]
            if f.endswith('.xml') and f not in chains: chains[f] = list(chain); listed.append(f)
        on_disk = sorted(f for f in os.listdir(f'{root}/xml') if f.startswith(doc) and f.endswith('.xml'))
        if sorted(listed) != on_disk: sys.exit(f'STOP: {doc}/{version} menu lists {len(listed)} xml, disk has {len(on_disk)} (diff {sorted(set(listed) ^ set(on_disk))[:3]})')
        total = 0
        for f in sorted(listed):
            b = open(f'{root}/xml/{f}', 'rb').read(); total += len(b)
            t = b.decode('cp932', errors='strict')  # WHATWG の Shift_JIS（parser の TextDecoder）は cp932 と同じ
            enc = (re.search(r'<\?xml[^>]*encoding="([^"]*)"', t) or [None, ''])[1]
            dt = (re.search(r'<!DOCTYPE([^>]*)>', t) or [None, ''])[1].strip()
            rt = (re.search(r'<(\w+)[\s>]', re.sub(r'<\?.*?\?>|<!DOCTYPE[^>]*>|<!--.*?-->', '', t, flags=re.S)) or [None, ''])[1]
            header = sect(t, 'header'); data = sect(t, 'data')
            # header の id は p{頁}-{行}.{n}-{列}.{m}。n が 1 = 見出し、2 = 下位見出し（parser v0 と同じ読み方）
            hs = ';'.join(f'{g[2]}.{g[3]}={ctext(g[5])}' for g in CLM.findall(header or ''))
            rows = collections.OrderedDict()
            for g in CLM.findall(data or ''):
                rows.setdefault(f'p{g[0]}-{g[1]}.{g[2]}', []).append(f'{g[3]}.{g[4]}')
            sigs = collections.Counter(','.join(sorted(set(c), key=lambda x: (int(x.split('.')[0]), int(x.split('.')[1])))) for c in rows.values())
            files.append({'document': doc, 'version': version, 'file': f, 'sha256': sha(b), 'bytes': len(b), 'encoding_declared': enc, 'doctype': dt, 'root': rt,
                          'title_for_list': ctext(sect(t, 'title_for_list')), 'running_title': ctext(sect(t, 'running_title')), 'table_count': len(re.findall(r'<table[\s>]', t)),
                          'header_signature': hs, 'row_class_signature': '|'.join(f'{k}:{v}' for k, v in sorted(sigs.items())), '_rows': len(rows)})
            menu_rows.append([doc, version, f, ' > '.join(chains[f])])
        documents.append({'document': doc, 'version': version, 'main_sha256': sha(open(main_p, 'rb').read()), 'menu_sha256': sha(menu_b), 'xml_files': len(listed), 'xml_bytes': total})
    os.makedirs(out, exist_ok=True)
    cols = ['document', 'version', 'file', 'sha256', 'bytes', 'encoding_declared', 'doctype', 'root', 'title_for_list', 'running_title', 'table_count', 'header_signature', 'row_class_signature']
    with open(f'{out}/files.csv', 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, lineterminator='\n'); w.writerow(cols); w.writerows([[f[c] for c in cols] for f in files])
    with open(f'{out}/menu-chains.csv', 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, lineterminator='\n'); w.writerow(['document', 'version', 'file', 'chain']); w.writerows(menu_rows)
    summary = {}
    for doc, version, _ in DOCS:
        fs = [f for f in files if f['document'] == doc and f['version'] == version]
        by_title = collections.defaultdict(list)
        for f in fs: by_title[f['title_for_list']].append(f)
        summary[f'{doc}/{version}'] = {
            'files': len(fs), 'doctypes': dict(collections.Counter(f['doctype'] for f in fs)), 'encodings': dict(collections.Counter(f['encoding_declared'] for f in fs)),
            'title_for_list': dict(collections.Counter(f['title_for_list'] for f in fs).most_common()),
            'by_title': {t: {'files': len(g), 'header_signatures': dict(collections.Counter(f['header_signature'] for f in g)),
                             'row_class_sets': sorted({s.rsplit(':', 1)[0] for f in g for s in f['row_class_signature'].split('|') if s}),
                             'rows': sum(f['_rows'] for f in g), 'table_counts': dict(collections.Counter(f['table_count'] for f in g))} for t, g in sorted(by_title.items())}}
    json.dump(summary, open(f'{out}/summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True); open(f'{out}/summary.json', 'a').write('\n')
    json.dump(documents, open(f'{out}/documents.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1); open(f'{out}/documents.json', 'a').write('\n')
    print(json.dumps({k: {'files': v['files'], 'titles': v['title_for_list']} for k, v in summary.items()}, ensure_ascii=False)[:1500])


main(sys.argv[1])
