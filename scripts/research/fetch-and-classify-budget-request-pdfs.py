#!/usr/bin/env python3
"""掲載ページに現れた PDF の候補を取得し、先頭 2 ページの本文で概算要求書かどうかを分類する（記述のみ）。

  python3 -I scripts/research/fetch-and-classify-budget-request-pdfs.py <year> <out.csv>
候補 = (a) リンクの文字か URL に「概算要求・歳出・要求書・総表・明細・gaisan・yokyu」と年度のしるし（令和8・R8・2026 など）がある PDF、
       (b) 上の条件に当たる PDF が 1 つもない掲載ページ（リンクが 90 本以下）のすべての PDF、(c) 一覧に直接載る PDF。
取得先は data/download/{domain}/{URL の path}（既存ファイルは再取得しない。1 秒間隔）。各 PDF について HTTP 状態・bytes・SHA-256・%PDF の有無・頁数と、
先頭 2 ページの本文に現れる印（年度・概算要求・歳出・総表・明細表・目次）を記録する。判定（目録に入れるか）はしない。
"""
import csv, hashlib, os, re, subprocess, sys, time, unicodedata
from urllib.parse import urlparse, unquote

year, out = sys.argv[1:3]
D = 'docs/inventory/budget-request-sources'
links = list(csv.DictReader(open(f'{D}/fy{year}-pdf-links.csv', encoding='utf-8')))
pages = {r['landing_url']: r for r in csv.DictReader(open(f'{D}/fy{year}-landing-pages.csv', encoding='utf-8'))}
nf = lambda s: unicodedata.normalize('NFKC', s)
K = re.compile(r'概算要求|歳出|要求書|総表|明細|gaisan|yokyu|youkyu', re.I)
Y = re.compile(r'令和8|R8|r8|fy2026|2026|8年度|r08', re.I)
by_page = {}
for l in links: by_page.setdefault(l['landing_url'], []).append(l)
cand = {}
for u, ls in by_page.items():
    hit = [l for l in ls if K.search(nf(l['link_text']) + ' ' + l['pdf_url']) and Y.search(nf(l['link_text']) + ' ' + l['pdf_url'])]
    for l in hit: cand.setdefault(l['pdf_url'], (u, 'keyword'))
    if not hit and len(ls) <= 90:
        for l in ls: cand.setdefault(l['pdf_url'], (u, 'page_without_keyword_hit'))
    if pages.get(u, {}).get('http') == 'direct_pdf':
        for l in ls: cand.setdefault(l['pdf_url'], (u, 'direct'))
rows = []
for i, (pu, (landing, why)) in enumerate(sorted(cand.items())):
    p = urlparse(pu); host = p.netloc.removeprefix('www.')
    local = os.path.join('data', 'download', host, *[unquote(s).replace('%', '%25').replace('$', '%24') for s in p.path.split('/') if s])
    code = 'cached'
    if not os.path.exists(local):
        time.sleep(1); os.makedirs(os.path.dirname(local), exist_ok=True)
        r = subprocess.run(['curl', '-sL', '-m', '120', '-A', 'Mozilla/5.0', '-o', local + '.part', '-w', '%{http_code}', pu], capture_output=True)
        code = r.stdout.decode(errors='replace')
        if code == '200': os.replace(local + '.part', local)
        elif os.path.exists(local + '.part'): os.remove(local + '.part')
    ok = os.path.exists(local)
    size = os.path.getsize(local) if ok else 0
    head = open(local, 'rb').read(5) if ok else b''
    pdf = head.startswith(b'%PDF')
    pages_n = ''; marks = ''; first = ''
    if pdf:
        info = subprocess.run(['pdfinfo', local], capture_output=True, text=True).stdout
        m = re.search(r'Pages:\s+(\d+)', info); pages_n = m.group(1) if m else ''
        txt = subprocess.run(['pdftotext', '-layout', '-f', '1', '-l', '2', local, '-'], capture_output=True, text=True).stdout
        t = nf(re.sub(r'\s+', '', txt))
        yr = re.search(r'令和(\d+)年度', t)
        marks = ';'.join(k for k, pat in (('歳出概算要求', '歳出概算要求'), ('概算要求', '概算要求'), ('総表', '総表'), ('明細表', '明細表'), ('目次', '目次'), ('歳入概算', '歳入')) if re.search(pat, t))
        first = (yr.group(0) if yr else '') + '|' + ' '.join(l.strip() for l in txt.split('\n') if l.strip())[:60]
        if not txt.strip(): marks = 'no_text_layer'
    rows.append([pu, landing, why, code if not ok else (code if code != 'cached' else 'cached'), size, hashlib.sha256(open(local, 'rb').read()).hexdigest() if ok else '', int(pdf), pages_n, marks, first])
    if i % 20 == 0: print(i, len(cand), flush=True)
with open(out, 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['pdf_url', 'landing_url', 'why_candidate', 'http', 'bytes', 'sha256', 'is_pdf', 'pages', 'page_marks', 'year_and_first_line']); w.writerows(rows)
print(len(rows), 'candidates;', sum(r[6] for r in rows), 'are PDFs')
