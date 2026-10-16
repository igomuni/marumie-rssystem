#!/usr/bin/env python3
"""FY2023（令和5年度）の概算要求書 PDF の掲載元を、各府省サイトから再構成する（記述のみ。PDF 本体は取得しない）。
財務省のリンク先一覧（fy2023）は現在 404 のため、FY2026 の掲載ページ（fy2026-landing-pages.csv）を入口にする。

  python3 -I scripts/research/crawl-budget-request-fy2023-sources.py
入口ごとに (a) 年度表記を令和8→5 などに置き換えた URL、(b) 入口ページ上で令和5年度のしるしを持つリンク、を最大 3 階層までたどる（同一ホスト・https のみ・1 秒間隔・入口あたり最大 40 ページ）。
出力（docs/inventory/budget-request-sources/）: fy2023-landing-pages.csv（取得したページ）、fy2023-pdf-links.csv（ページ上の PDF リンク）。
FY2026 以前と同じ列。「令和5年度の歳出概算要求書か」の判定は fetch-and-classify-budget-request-pdfs.py が PDF の先頭 2 ページで行う。
"""
import csv, hashlib, re, subprocess, time, unicodedata
from urllib.parse import urljoin, urlparse

D = 'docs/inventory/budget-request-sources'
nf = lambda s: unicodedata.normalize('NFKC', s)
MARK = re.compile(r'令和5年度|令和5|R5|r5|r05|R05|2023|fy2023|(?<!\d)5(?:youkyu|yokyu|年度)|平成|令和\d年度', re.I)
MARK5 = re.compile(r'令和5|R0?5|r0?5(?!\d)|2023|fy2023|(?<!\d)5(?:youkyu|yokyu|年度)', re.I)
TOPIC = re.compile(r'概算要求|要求書|予算|yosan|gaisan|youkyu|yokyu|budget', re.I)
SWAPS = [(r'令和8', '令和5'), (r'r08', 'r05'), (r'R08', 'R05'), (r'(?<![0-9a-z])r8', 'r5'), (r'(?<![0-9A-Za-z])R8', 'R5'), (r'fy2026', 'fy2023'), (r'(?<!\d)8youkyuu', '5youkyuu'), (r'26syokan', '23syokan'), (r'2026', '2023'), (r'_R8', '_R5')]
MAX_PAGES, MAX_DEPTH = 40, 3

seeds = {}
for r in csv.DictReader(open(f'{D}/fy2026-landing-pages.csv', encoding='utf-8')):
    u = r['landing_url']
    if u.lower().endswith('.pdf'): continue
    seeds.setdefault(urlparse(u).hostname, []).append(u)


def fetch(u):
    time.sleep(1)
    p = subprocess.run(['curl', '-sL', '-m', '40', '-A', 'Mozilla/5.0', '-w', '\n%{http_code}\n%{content_type}', u], capture_output=True)
    body, code, ctype = p.stdout.rsplit(b'\n', 2)
    t = body.decode('utf-8', errors='replace')
    if '�' in t[:20000] and not re.search(r'charset=utf-?8', t[:2000], re.I):
        for enc in ('shift_jis', 'euc-jp'):
            try: t = body.decode(enc); break
            except UnicodeDecodeError: pass
    return t, body, code.decode(errors='replace'), ctype.decode(errors='replace').split(';')[0]


def links_of(t, base):
    out = []
    for h, txt in re.findall(r'<a\s[^>]*?href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', t, re.S | re.I):
        h = h.strip().split('#')[0]
        if not h or h.startswith(('mailto:', 'javascript:')): continue
        out.append((urljoin(base, h), re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', txt)).replace('&nbsp;', ' ').strip()[:80]))
    return out


pages, pdfs, seen = [], [], set()
for host, urls in sorted(seeds.items()):
    queue = []
    for u in urls:
        queue.append((u, 0, 'seed'))
        g = u
        for a, b in SWAPS: g = re.sub(a, b, g)
        if g != u: queue.append((g, 0, 'swap'))
    n = 0
    while queue and n < MAX_PAGES:
        u, depth, how = queue.pop(0)
        if u in seen or urlparse(u).scheme != 'https' or (urlparse(u).hostname or '') != host: continue
        seen.add(u); n += 1
        t, body, code, ctype = fetch(u)
        ls = links_of(t, u) if code == '200' and 'html' in ctype else []
        pl = [(h, x) for h, x in ls if re.search(r'\.pdf(\?|$)', h, re.I)]
        uniq = []; s2 = set()
        for h, x in pl:
            if h not in s2: s2.add(h); uniq.append((h, x))
        pages.append([u, code, ctype, hashlib.sha256(body).hexdigest(), len(body), len(uniq), f'{how}:{host}'])
        pdfs += [[u, h, x] for h, x in uniq]
        if depth < MAX_DEPTH:
            for h, x in ls:
                if re.search(r'\.pdf(\?|$)', h, re.I) or (urlparse(h).hostname or '') != host: continue
                s = nf(x) + ' ' + h
                if MARK5.search(s) and TOPIC.search(s): queue.append((h, depth + 1, 'link'))
    print(host, n, 'pages', flush=True)
with open(f'{D}/fy2023-landing-pages.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['landing_url', 'http', 'content_type', 'sha256', 'bytes', 'pdf_links', 'listed_for']); w.writerows(pages)
with open(f'{D}/fy2023-pdf-links.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['landing_url', 'pdf_url', 'link_text']); w.writerows(pdfs)
print(len(pages), 'pages;', sum(1 for p in pages if p[1] == '200'), 'HTTP 200;', len(pdfs), 'pdf links')
