#!/usr/bin/env python3
"""J1 複数のうち K2 で1候補になる FY2025 の DETAIL 行（147行）の blind visual GT 用に、候補集合を凍結し、頁を render する（機械的な準備のみ）。

  python3 -I scripts/research/build-j1-multi-k2-visual-gt.py

出力（コミット）: tests/fixtures/detail-table-j1-multi-k2-visual-gt/2025/
  candidates.csv          target ごとの source_file, source_page, source_line_start, raw_text（X・MOF 候補・x_source は含めない）
  candidates-manifest.json 入力 hash、元 PDF の SHA-256 と頁数、選定規則
  render-manifest.json    PNG ごとの PDF/PNG SHA-256、コマンド、DPI
  annotation-targets.csv  annotator に渡す表（target_id, target_png, window_pngs, …）
PNG: data/work/budget-request-csv/2025/j1-multi-gt-render/（git 管理外）。窓は対象頁と、その前の WINDOW 頁（同じ PDF の中、対象ごとに変えない）。
"""
import collections, csv, hashlib, json, os, subprocess, sys, zipfile

MATCH = 'data/work/budget-request-csv/2025/detail-table-mof-match'
MATCH_MANIFEST_SHA = '5b17a565e3a3f2666edf6399a547ad5f61043385d9e90b35f833921c2b0956a1'
DETAIL = 'data/work/budget-request-csv/2025/detail-table'
DETAIL_MANIFEST_SHA = '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7'
ZIP = 'data/work/budget-request-plain-text-2025.zip'
ZIP_SHA = '11909d768c38c025c70178755dea1f84280e85c124575f380af3e786a28889f2'
CORPUS = 'tests/fixtures/budget-request-pdf-corpus/2025/pdf-corpus-freeze.json'
OUT = 'tests/fixtures/detail-table-j1-multi-k2-visual-gt/2025'
RENDER = 'data/work/budget-request-csv/2025/j1-multi-gt-render'
WINDOW = 5
DPI = 150


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def main():
    for path, want in ((f'{MATCH}/output-manifest.json', MATCH_MANIFEST_SHA), (f'{DETAIL}/output-manifest.json', DETAIL_MANIFEST_SHA), (ZIP, ZIP_SHA)):
        if sha(path) != want: sys.exit(f'STOP: {path} SHA-256 mismatch')
    man = json.load(open(f'{MATCH}/output-manifest.json'))
    for rel, h in man.items():
        if sha(f'{MATCH}/{rel}') != h: sys.exit(f'STOP: {rel} SHA-256 differs from manifest')

    sel = [r for r in csv.DictReader(open(f'{MATCH}/matches.csv', encoding='utf-8'))
           if r['status'] == 'AMBIGUOUS_J1_MULTI' and r['k2_candidates'] == '1']
    z = zipfile.ZipFile(ZIP)
    texts, details = {}, {}
    rows = []
    for r in sel:
        s = r['source']
        if s not in texts:
            texts[s] = z.read(f'budget-request-plain-text/2025/{s}.txt').decode('utf-8').split('\n')
            details[s] = {d['row_index']: d for d in csv.DictReader(open(f'{DETAIL}/sources/{s}.csv', encoding='utf-8'))}
        d = details[s][r['row_index']]
        line = int(d['source_line_start'])
        rows.append((f'budget-request-plain-text/2025/{s}.txt', int(d['source_page']), line, texts[s][line - 1].replace('\f', '')))
    rows.sort()

    corpus = {d['localPdfPath']: d for d in json.load(open(CORPUS))['documents']}
    os.makedirs(OUT, exist_ok=True); os.makedirs(RENDER, exist_ok=True)
    with open(f'{OUT}/candidates.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(['source_file', 'source_page', 'source_line_start', 'raw_text']); w.writerows(rows)

    pdfs = {}
    for src, *_ in rows:
        slug = src.split('/')[-1][:-4]
        pdf = 'data/download/' + '/'.join(slug.split('__')) + '.pdf'
        if pdf not in corpus or sha(pdf) != corpus[pdf]['pdfSha256']: sys.exit(f'STOP: {pdf} not in frozen corpus or SHA-256 mismatch')
        pdfs[slug] = pdf
    json.dump({
        'selection': 'FY2025 detail-table-mof-match: status == AMBIGUOUS_J1_MULTI and k2_candidates == 1（全件。追加・削除しない）',
        'inputs': {'matchOutputManifest': MATCH_MANIFEST_SHA, 'detailOutputManifest': DETAIL_MANIFEST_SHA, 'plainTextZip': ZIP_SHA, 'pdfCorpus': sha(CORPUS)},
        'candidates': len(rows), 'candidates_csv_sha256': sha(f'{OUT}/candidates.csv'),
        'window': {'pagesBeforeTarget': WINDOW, 'rule': '対象頁と、同じ PDF のその前の WINDOW 頁（1頁未満は切る）。対象ごとに変えない'},
        'pdfs': {s: {'path': p, 'sha256': corpus[p]['pdfSha256'], 'pageCount': corpus[p]['pageCount']} for s, p in sorted(pdfs.items())},
    }, open(f'{OUT}/candidates-manifest.json', 'w'), ensure_ascii=False, indent=2)

    ver = subprocess.run(['pdftoppm', '-v'], capture_output=True, text=True).stderr.splitlines()[0]
    need = sorted({(src.split('/')[-1][:-4], q) for src, p, *_ in rows for q in range(max(1, p - WINDOW), p + 1)})
    items = []
    for slug, pg in need:
        name = f'{slug}__p{pg:04d}.png'
        if not os.path.exists(os.path.join(RENDER, name)):
            subprocess.run(['pdftoppm', '-r', str(DPI), '-png', '-f', str(pg), '-l', str(pg), '-singlefile', pdfs[slug], os.path.join(RENDER, name[:-4])], check=True)
        items.append({'source_file': slug, 'source_page': pg, 'pdf_sha256': sha(pdfs[slug]), 'png': name, 'png_sha256': sha(os.path.join(RENDER, name))})
    json.dump({'tool': ver, 'dpi': DPI, 'command_template': f'pdftoppm -r {DPI} -png -f N -l N -singlefile <pdf> <out-without-extension>',
               'candidates_csv_sha256': sha(f'{OUT}/candidates.csv'), 'renderDir': RENDER, 'pngs': len(items), 'items': items},
              open(f'{OUT}/render-manifest.json', 'w'), ensure_ascii=False, indent=2)

    seen = collections.Counter()
    with open(f'{OUT}/annotation-targets.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['target_id', 'target_png', 'window_pngs', 'source_file', 'source_page', 'source_line_start', 'nth_identical_text_on_page_from_top', 'raw_text'])
        for i, (src, p, line, raw) in enumerate(rows, 1):
            slug = src.split('/')[-1][:-4]
            seen[(src, p, raw)] += 1
            win = ';'.join(f'{slug}__p{q:04d}.png' for q in range(max(1, p - WINDOW), p + 1))
            w.writerow([f'T{i:03d}', f'{slug}__p{p:04d}.png', win, src, p, line, seen[(src, p, raw)], raw])
    print(json.dumps({'candidates': len(rows), 'pngs': len(items), 'sources': len(pdfs)}, ensure_ascii=False))


main()
