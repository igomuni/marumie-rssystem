#!/usr/bin/env python3
"""明細表の空欄列問題: 「表頭の窓だけで列が一意に決まる」140行の candidate 集合を固定する。

  python3 -I scripts/research/build-detail-table-window-gt-candidates.py [出力ディレクトリ]

出力（既定 tests/fixtures/budget-request-detail-table-window-gt/2024/）:
  candidates.csv   source_file, source_page, source_line_start, raw_text（窓の判定結果・列は含めない）
  candidates-manifest.json   件数、candidates.csv の SHA-256、元PDFの存在・SHA-256・ページ数の一致
入力: data/work/budget-request-plain-text.zip, data/work/budget-request-csv/2024/detail-table/unresolved.csv,
      data/download/<host>/<path>.pdf（スラッグ host__path__file → host/path/file.pdf）
窓の規則は scripts/research/isolate-detail-table-failures.py と同じ。annotator には窓の判定も候補列も渡さない。
"""
import csv, hashlib, json, os, re, subprocess, sys, zipfile

ZIP = 'data/work/budget-request-plain-text.zip'
UNRES = 'data/work/budget-request-csv/2024/detail-table/unresolved.csv'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures/budget-request-detail-table-window-gt/2024'
comp = lambda s: re.sub(r'\s+', '', s)
HY = '[‑-]'
CODE = (rf'(?:[0-9]{{5}}{HY}\s*[0-9]{{1,4}}{HY}[0-9]{{2}}{HY}[0-9]{{4}}|[0-9]{{2}}{HY}[0-9]{{4}}|[0-9]{{2}}{HY}[0-9]{{2}}|[0-9]{{1,3}})')
HEAD = re.compile(rf'^(\s*)(?:([0-9]{{1,3}})\s+(?=[0-9]{{2}}{HY}[0-9]{{2}}\s))?({CODE})\s+(\S.*)$')
NUM = r'(?:△\s*)?[0-9][0-9,]*'
HEADER_2 = re.compile(r'番\s*号.*予\s*算\s*額.*比\s*較')
WORDS = [(r'予\s*算\s*額', (-4, 5)), (r'概算要求額', (-2, 16)), (r'比\s*較\s*(?:増\s*△?\s*減?)?', (0, 16))]


def geometry(page):
    lines = page.split('\n')
    first = next((i for i, l in enumerate(lines) if '事項' in comp(l) and '前年度' in comp(l) and '備考' in comp(l) and 0 < l.find('前') < l.find('備')), None)
    if first is None: return None
    end = next((i for i, l in enumerate(lines) if i >= first and HEADER_2.search(l)), None)
    return None if end is None else (lines[first].find('備'), end)


def windows(page, b, end):
    line = page.split('\n')[end]; out = []
    for pat, (lo, hi) in WORDS:
        m = re.search(pat, line)
        if not m: return None
        out.append((min(m.end() + lo, b), min(m.end() + hi, b)))
    return out


def split_tail(rest):
    for m in re.finditer(r'\s{2,}|(?<=\S)\s(?=△)', rest):
        mm = re.match(rf'((?:{NUM})(?:\s*(?:{NUM}))*)(?=\s|$)(.*)$', rest[m.end():])
        if mm: return rest[:m.start()].strip(), re.findall(NUM, mm.group(1))
    mm = re.search(rf'\s((?:{NUM})(?:\s*(?:{NUM}))+)(?=\s|$)(.*)$', rest)
    return (rest[:mm.start()].strip(), re.findall(NUM, mm.group(1))) if mm else (rest.strip(), [])


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for c in iter(lambda: f.read(1 << 20), b''): h.update(c)
    return h.hexdigest()


def main():
    z = zipfile.ZipFile(ZIP); cache = {}
    def pages(slug):
        if slug not in cache:
            t = z.read(f'budget-request-plain-text/2024/{slug}.txt').decode('utf-8'); P = t.split('\f')
            if t.endswith('\f'): P.pop()
            cache[slug] = P
        return cache[slug]
    rows = []
    for u in csv.DictReader(open(UNRES, encoding='utf-8')):
        if u['reason'] != 'BLANK_CELL_COLUMN_UNDETERMINED': continue
        slug = u['source_file'].split('/')[-1][:-4]; page = pages(slug)[int(u['source_page']) - 1]
        g = geometry(page); w = windows(page, g[0], g[1])
        h = HEAD.match(u['raw_text']); name, toks = split_tail(h.group(4)); base = h.start(4) + len(name)
        ends = [base + m.end() for m in re.finditer(NUM, u['raw_text'][base:])][:len(toks)]
        cols = []
        for e in ends:
            near = [k for k in range(3) if w[k][0] <= e <= w[k][1]]
            cols.append(near[0] if len(near) == 1 else -1)
        if -1 not in cols and len(set(cols)) == len(cols):
            rows.append((u['source_file'], int(u['source_page']), int(u['source_line_start']), u['raw_text']))
    rows.sort(key=lambda r: (r[0], r[2]))
    os.makedirs(OUT, exist_ok=True)
    cp = os.path.join(OUT, 'candidates.csv')
    with open(cp, 'w', encoding='utf-8', newline='') as f:
        wr = csv.writer(f, lineterminator='\n'); wr.writerow(['source_file', 'source_page', 'source_line_start', 'raw_text']); wr.writerows(rows)
    pdfs, problems = {}, []
    for slug in sorted({r[0].split('/')[-1][:-4] for r in rows}):
        pdf = 'data/download/' + '/'.join(slug.split('__')) + '.pdf'
        if not os.path.exists(pdf): problems.append(f'PDF not found: {pdf}'); continue
        info = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout
        n = int(re.search(r'^Pages:\s+(\d+)', info, re.M).group(1))
        if n != len(pages(slug)): problems.append(f'page count mismatch: {pdf} pdf={n} text={len(pages(slug))}')
        pdfs[slug] = {'pdf': pdf, 'sha256': sha(pdf), 'pages': n}
    man = {'targets': len(rows), 'candidates_csv_sha256': sha(cp), 'sources': len(pdfs),
           'pages': len({(r[0], r[1]) for r in rows}), 'pdfs': pdfs, 'problems': problems}
    json.dump(man, open(os.path.join(OUT, 'candidates-manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2, sort_keys=True)
    print(json.dumps({k: v for k, v in man.items() if k != 'pdfs'}, ensure_ascii=False))


main()
