#!/usr/bin/env python3
"""財務省の「各府省の概算要求書…公開ページへのリンク先一覧」ページを取得し、府省ごとの掲載ページ（landing page）を CSV にする（記述のみ。PDF は取得しない）。

  python3 -I scripts/research/fetch-mof-budget-request-link-list.py <year> <list-page-url> <out.csv>
URL は検索で確認した実在のページを渡す（推測しない）。応答の HTTP 状態と SHA-256 を標準出力に出す。
"""
import csv, hashlib, re, subprocess, sys

year, url, out = sys.argv[1:4]
body = subprocess.run(['curl', '-sL', '-m', '30', '-A', 'Mozilla/5.0', '-w', '\n%{http_code}', url], capture_output=True).stdout
status = body.rsplit(b'\n', 1)[-1].decode(); html = body.rsplit(b'\n', 1)[0]
print(json := {'year': year, 'url': url, 'http': status, 'bytes': len(html), 'sha256': hashlib.sha256(html).hexdigest()})
if status != '200': sys.exit(f'STOP: HTTP {status}')
t = html.decode('utf-8', errors='replace')
title = re.findall(r'<title>(.*?)</title>', t, re.S)[0].strip()
rows = []
for r in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
    cells = [re.sub(r'<[^>]+>', '', c).replace('&nbsp;', ' ').strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', r, re.S)]
    links = []
    for h in re.findall(r'href="([^"]+)"', r):
        h = h.strip()
        if h not in links: links.append(h)
    if links and cells and cells[0]: rows.append([year, cells[0], ' / '.join(c for c in cells[1:] if c), ' '.join(links)])
with open(out, 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['year', 'authority', 'marks', 'links']); w.writerows(rows)
print(title, '| rows', len(rows))
