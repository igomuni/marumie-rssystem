#!/usr/bin/env python3
"""独立GT用: candidates.csv の31ページを、元PDFからそのまま PNG にする（機械的な準備のみ）。

  python3 -I scripts/research/render-detail-table-window-gt-pages.py [PNG出力ディレクトリ]

PNG は既定で data/work/gt-render/window-gt/（Git管理しない）。
render-manifest.json（コミットする）に、コマンド・DPI・pdftoppm/Poppler のバージョン・PDF/PNG の SHA-256 を固定する。
crop・強調・注釈なし。PDF の SHA-256 が candidates-manifest.json と違う、ページが無い、のいずれかなら STOP。
"""
import csv, hashlib, json, os, re, subprocess, sys

FIX = 'tests/fixtures/budget-request-detail-table-window-gt/2024'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/work/gt-render/window-gt'
DPI = 150


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for c in iter(lambda: f.read(1 << 20), b''): h.update(c)
    return h.hexdigest()


def main():
    cm = json.load(open(f'{FIX}/candidates-manifest.json', encoding='utf-8'))
    assert not cm['problems']
    rows = list(csv.DictReader(open(f'{FIX}/candidates.csv', encoding='utf-8')))
    assert sha(f'{FIX}/candidates.csv') == cm['candidates_csv_sha256'], 'candidates.csv changed'
    ver = subprocess.run(['pdftoppm', '-v'], capture_output=True, text=True).stderr.splitlines()[0]
    os.makedirs(OUT, exist_ok=True)
    pages = sorted({(r['source_file'].split('/')[-1][:-4], int(r['source_page'])) for r in rows})
    items = []
    for slug, pg in pages:
        pdf = cm['pdfs'][slug]['pdf']
        if sha(pdf) != cm['pdfs'][slug]['sha256']: sys.exit(f'STOP: PDF hash mismatch {pdf}')
        if pg > cm['pdfs'][slug]['pages']: sys.exit(f'STOP: page out of range {pdf} {pg}')
        name = f'{slug}__p{pg:04d}.png'
        cmd = ['pdftoppm', '-r', str(DPI), '-png', '-f', str(pg), '-l', str(pg), '-singlefile', pdf, os.path.join(OUT, name[:-4])]
        subprocess.run(cmd, check=True)
        items.append({'source_file': slug, 'source_page': pg, 'pdf_sha256': cm['pdfs'][slug]['sha256'],
                      'png': name, 'png_sha256': sha(os.path.join(OUT, name))})
    man = {'tool': ver, 'dpi': DPI, 'command_template': f'pdftoppm -r {DPI} -png -f N -l N -singlefile <pdf> <out-without-extension>',
           'candidates_csv_sha256': cm['candidates_csv_sha256'], 'pages': len(items), 'items': items}
    json.dump(man, open(f'{FIX}/render-manifest.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2, sort_keys=True)
    # annotator に渡す対象一覧（窓の判定結果・候補列・算術は含まない）
    seen, out = {}, []
    for i, r in enumerate(sorted(rows, key=lambda r: (r['source_file'], int(r['source_line_start']))), 1):
        key = (r['source_file'], r['source_page'], r['raw_text'].strip())
        seen[key] = seen.get(key, 0) + 1
        slug = r['source_file'].split('/')[-1][:-4]
        out.append({'target_id': f'T{i:03d}', 'png': f"{slug}__p{int(r['source_page']):04d}.png", 'source_file': r['source_file'],
                    'source_page': r['source_page'], 'source_line_start': r['source_line_start'],
                    'nth_identical_text_on_page_from_top': seen[key], 'raw_text': r['raw_text']})
    with open(f'{FIX}/annotation-targets.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]), lineterminator='\n'); w.writeheader(); w.writerows(out)
    print(json.dumps({'pages': len(items), 'tool': ver}, ensure_ascii=False))


main()
