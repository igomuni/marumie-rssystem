#!/usr/bin/env python3
"""財務省のリンク先一覧に載る掲載ページ（landing page）を 1 回ずつ取得し、ページ上に実際に現れる PDF のリンクを列挙する（記述のみ。PDF 本体は取得しない）。

  python3 -I scripts/research/crawl-budget-request-landing-pages.py <year> <out-dir>  # 入力: docs/inventory/budget-request-sources/fy{year}-{general,special}-link-list.csv

各 URL は 1 秒の間隔で取得する。HTTP 状態・応答の SHA-256・Content-Type を記録する。一覧の URL が直接 PDF なら、そのまま PDF の候補として記録する。
出力: pages.csv（掲載ページごと: URL・HTTP 状態・SHA-256・PDF リンクの数・一覧での府省）、pdf-links.csv（PDF リンクごと: 掲載ページ・URL・リンクの文字）。
"""
import csv, hashlib, re, subprocess, sys, time
from urllib.parse import urljoin

year, out = sys.argv[1:3]
D = 'docs/inventory/budget-request-sources'
urls = {}
for k in ('general', 'special'):
    for r in csv.DictReader(open(f'{D}/fy{year}-{k}-link-list.csv', encoding='utf-8')):
        for u in r['links'].split():
            urls.setdefault(u.strip(), []).append(f"{k}:{r['authority']}")
pages, pdfs = [], []
for u, who in sorted(urls.items()):
    if u.lower().endswith('.pdf'):
        pages.append([u, 'direct_pdf', '', '', '', 1, ' ; '.join(who)]); pdfs.append([u, u, '(一覧に直接載る PDF)']); continue
    time.sleep(1)
    p = subprocess.run(['curl', '-sL', '-m', '40', '-A', 'Mozilla/5.0', '-w', '\n%{http_code}\n%{content_type}', u], capture_output=True)
    parts = p.stdout.rsplit(b'\n', 2)
    body, code, ctype = parts[0], parts[1].decode(errors='replace'), parts[2].decode(errors='replace')
    t = body.decode('utf-8', errors='replace')
    if '�' in t[:20000] and not re.search(r'charset=utf-?8', t[:2000], re.I):
        for enc in ('shift_jis', 'euc-jp'):
            try: t = body.decode(enc); break
            except UnicodeDecodeError: pass
    links = []
    for h, txt in re.findall(r'<a\s[^>]*?href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', t, re.S | re.I):
        h = h.strip().split('#')[0]
        if re.search(r'\.pdf(\?|$)', h, re.I):
            links.append((urljoin(u, h), re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', txt)).replace('&nbsp;', ' ').strip()[:80]))
    seen = set(); uniq = [x for x in links if not (x[0] in seen or seen.add(x[0]))]
    pages.append([u, code, ctype.split(';')[0], hashlib.sha256(body).hexdigest(), len(body), len(uniq), ' ; '.join(who)])
    pdfs += [[u, h, txt] for h, txt in uniq]
with open(f'{out}/pages.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['landing_url', 'http', 'content_type', 'sha256', 'bytes', 'pdf_links', 'listed_for']); w.writerows(pages)
with open(f'{out}/pdf-links.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['landing_url', 'pdf_url', 'link_text']); w.writerows(pdfs)
print(len(pages), 'pages;', sum(1 for p in pages if p[1] == '200'), 'HTTP 200;', len(pdfs), 'pdf links')
