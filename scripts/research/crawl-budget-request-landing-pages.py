#!/usr/bin/env python3
"""財務省のリンク先一覧に載る掲載ページ（landing page）を取得し、ページ上に実際に現れる PDF のリンクを列挙する（記述のみ。PDF 本体は取得しない）。

  python3 -I scripts/research/crawl-budget-request-landing-pages.py <year> <out-dir>  # 入力: docs/inventory/budget-request-sources/fy{year}-{general,special}-link-list.csv

各 URL は 1 秒の間隔で取得する。HTTP 状態・応答の SHA-256・Content-Type を記録する。一覧の URL が直接 PDF なら、そのまま PDF の候補として記録する。
掲載ページが、年度ごとのページや分割したページへのリンクだけを持つことがある（例: 内閣官房）ため、掲載ページから HTML のリンクを最大 MAX_DEPTH 階層までたどる。
たどるリンクの条件: 同じ host の https の HTML、リンクの文字・URL に「概算要求・要求書・歳出・予算・gaisan・yokyu・youkyu・yosan・budget」のいずれかがある（またはリンクの文字が対象年度を含む。例: 「令和8年度」）、かつ他の年度（lib_budget_request_discovery.is_other_year）でない。掲載ページ 1 つあたり最大 MAX_PAGES ページ。
深くたどったページの「一覧での府省」は、もとの掲載ページと同じにする。
出力: pages.csv（ページごと: URL・HTTP 状態・SHA-256・PDF リンクの数・一覧での府省）、pdf-links.csv（PDF リンクごと: ページ・URL・リンクの文字）。
"""
import csv, hashlib, os, re, subprocess, sys, time
from urllib.parse import urljoin, urlparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_budget_request_discovery import is_other_year, reiwa_years

MAX_DEPTH, MAX_PAGES = 3, 25
FOLLOW = re.compile(r'概算要求|要求書|歳出|予算|gaisan|yokyu|youkyu|yosan|budget', re.I)
SKIP_EXT = re.compile(r'\.(pdf|zip|xlsx?|docx?|pptx?|csv|png|jpe?g|gif|css|js)(\?|$)', re.I)

year, out = sys.argv[1:3]
D = 'docs/inventory/budget-request-sources'
urls = {}
for k in ('general', 'special'):
    for r in csv.DictReader(open(f'{D}/fy{year}-{k}-link-list.csv', encoding='utf-8')):
        for u in r['links'].split():
            urls.setdefault(u.strip(), []).append(f"{k}:{r['authority']}")
pages, pdfs = [], []
N = int(year) - 2018
host = lambda u: (urlparse(u).hostname or '').lower().removeprefix('www.')


def fetch(u):
    time.sleep(1)
    p = subprocess.run(['curl', '-sL', '-m', '40', '-A', 'Mozilla/5.0', '-w', '\n%{http_code}\n%{content_type}', u], capture_output=True)
    parts = p.stdout.rsplit(b'\n', 2)
    body, code, ctype = parts[0], parts[1].decode(errors='replace'), parts[2].decode(errors='replace')
    t = body.decode('utf-8', errors='replace')
    if '�' in t[:20000] and not re.search(r'charset=utf-?8', t[:2000], re.I):
        for enc in ('shift_jis', 'euc-jp'):
            try: t = body.decode(enc); break
            except UnicodeDecodeError: pass
    anchors = []
    for h, txt in re.findall(r'<a\s[^>]*?href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', t, re.S | re.I):
        h = h.strip().split('#')[0]
        if not h or h.startswith(('mailto:', 'javascript:', 'tel:')): continue
        anchors.append((urljoin(u, h), re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', txt)).replace('&nbsp;', ' ').strip()[:80]))
    return body, code, ctype.split(';')[0], anchors


visited = set()
for u, who in sorted(urls.items()):
    if u.lower().endswith('.pdf'):
        pages.append([u, 'direct_pdf', '', '', '', 1, ' ; '.join(who)]); pdfs.append([u, u, '(一覧に直接載る PDF)']); continue
    queue, n_seed = [(u, 0)], 0   # 掲載ページごとに幅優先でたどる
    while queue and n_seed < MAX_PAGES:
        cur, depth = queue.pop(0)
        if cur in visited: continue
        visited.add(cur); n_seed += 1
        body, code, ctype, anchors = fetch(cur)
        uniq, seen = [], set()
        for h, txt in anchors:
            if re.search(r'\.pdf(\?|$)', h, re.I) and h not in seen: seen.add(h); uniq.append((h, txt))
        pages.append([cur, code, ctype, hashlib.sha256(body).hexdigest(), len(body), len(uniq), ' ; '.join(who)])
        pdfs += [[cur, h, txt] for h, txt in uniq]
        if depth >= MAX_DEPTH or code != '200' or 'html' not in ctype: continue
        for h, txt in anchors:
            if urlparse(h).scheme != 'https' or host(h) != host(u) or SKIP_EXT.search(h) or h in visited: continue
            s = txt + ' ' + h
            # リンクの文字が対象年度だけ（例: 「令和8年度」）の年別一覧にも対応する
            if (FOLLOW.search(s) or N in reiwa_years(txt)) and not is_other_year(s, N): queue.append((h, depth + 1))
with open(f'{out}/pages.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['landing_url', 'http', 'content_type', 'sha256', 'bytes', 'pdf_links', 'listed_for']); w.writerows(pages)
with open(f'{out}/pdf-links.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['landing_url', 'pdf_url', 'link_text']); w.writerows(pdfs)
print(len(pages), 'pages;', sum(1 for p in pages if p[1] == '200'), 'HTTP 200;', len(pdfs), 'pdf links')
