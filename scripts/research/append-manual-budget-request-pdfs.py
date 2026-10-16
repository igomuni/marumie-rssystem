#!/usr/bin/env python3
"""自動取得できなかった（403）掲載ページの PDF を、人手（ユーザー操作の別セッション）で data/download/ に置いた後、
fy{year}-expenditure-request-pdfs.csv に追記する。SHA-256・頁数・先頭 2 ページの印を実ファイルから取り、令和N年度と「歳出概算要求」を確認できたものだけを追記する。

  python3 -I scripts/research/append-manual-budget-request-pdfs.py <year> <landing_url> <pdf_url> [<pdf_url> ...]
サーバーが scripted HTTP に 403 を返すため、原本とのバイト同一性は照合できない（先頭 %PDF- と本文の印のみ確認）。
"""
import csv, hashlib, os, re, subprocess, sys, unicodedata
from urllib.parse import urlparse, unquote

year, landing, *urls = sys.argv[1:]
D = 'docs/inventory/budget-request-sources'; path = f'{D}/fy{year}-expenditure-request-pdfs.csv'
rows = list(csv.reader(open(path, encoding='utf-8'))); have = {r[0] for r in rows[1:]}
nf = lambda s: unicodedata.normalize('NFKC', re.sub(r'\s+', '', s))
for u in urls:
    if u in have: print('already listed:', u); continue
    p = urlparse(u); host = p.hostname.lower().removeprefix('www.')
    segs = [unquote(s) for s in p.path.split('/') if s]
    if p.scheme != 'https' or not host.endswith('.go.jp') or any(s in ('.', '..') or re.search(r'[/\\\0]', s) for s in segs): sys.exit(f'STOP: unsafe url {u}')
    local = os.path.join('data', 'download', host, *[s.replace('%', '%25').replace('$', '%24') for s in segs])
    b = open(local, 'rb').read()
    if not b.startswith(b'%PDF-'): sys.exit(f'STOP: not a PDF {local}')
    n = re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', local], capture_output=True, text=True).stdout).group(1)
    txt = subprocess.run(['pdftotext', '-layout', '-f', '1', '-l', '2', local, '-'], capture_output=True, text=True).stdout
    t = nf(txt); yr = re.search(r'令和(\d+)年度', t)
    if not (yr and int(yr.group(1)) == int(year) - 2018 and '歳出概算要求' in t): sys.exit(f'STOP: not the FY{year} expenditure request: {local}')
    rows.append([u, landing, n, hashlib.sha256(b).hexdigest(), yr.group(0) + '|' + ' '.join(l.strip() for l in txt.split('\n') if l.strip())[:60]])
    print('appended', u, n, 'pages')
csv.writer(open(path, 'w', encoding='utf-8', newline=''), lineterminator='\n').writerows(rows)
