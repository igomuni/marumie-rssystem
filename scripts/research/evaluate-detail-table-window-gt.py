#!/usr/bin/env python3
"""凍結した GT（final/gt.csv）に対して、表頭の窓による列配置を評価する（preregistration §5）。

  python3 -I scripts/research/evaluate-detail-table-window-gt.py

GT・candidates・plain text zip の SHA-256 が凍結値と違えば STOP。窓の規則は build-detail-table-window-gt-candidates.py と同じ。
1 unit は、第1金額の列・第2金額の列・空欄列の3つ全部が一致して初めて correct。RESOLVED のみが分母。
"""
import csv, hashlib, importlib.util, json, re, sys, zipfile

FIX = 'tests/fixtures/budget-request-detail-table-window-gt/2024'
COLS = ['前年度予算額', '６年度概算要求額', '対前年度比較増△減']
src = open('scripts/research/build-detail-table-window-gt-candidates.py', encoding='utf-8').read().rsplit('\nmain()', 1)[0]
ns = {'__name__': 'cand'}; exec(compile(src, 'cand', 'exec'), ns)
fr = json.load(open(f'{FIX}/final/gt-freeze.json', encoding='utf-8'))
if hashlib.sha256(open(f'{FIX}/final/gt.csv', 'rb').read()).hexdigest() != fr['gt_sha256']: sys.exit('STOP: GT changed after freeze')
if hashlib.sha256(open(f'{FIX}/candidates.csv', 'rb').read()).hexdigest() != fr['candidates_csv_sha256']: sys.exit('STOP: candidates changed')
ZIP_SHA256 = '268f1020957b58362e1b224197b16944855c139efa1524c343a77abdf754e533'  # 評価前に固定した plain text zip
if hashlib.sha256(open(ns['ZIP'], 'rb').read()).hexdigest() != ZIP_SHA256: sys.exit('STOP: plain text zip differs from the frozen input')
gt = list(csv.DictReader(open(f'{FIX}/final/gt.csv', encoding='utf-8')))
z = zipfile.ZipFile(ns['ZIP']); cache = {}
def pages(slug):
    if slug not in cache:
        t = z.read(f'budget-request-plain-text/2024/{slug}.txt').decode('utf-8'); P = t.split('\f')
        if t.endswith('\f'): P.pop()
        cache[slug] = P
    return cache[slug]
HEAD, NUM, split_tail = ns['HEAD'], ns['NUM'], ns['split_tail']
res, wrong = {'RESOLVED': 0, 'correct': 0, 'AMBIGUOUS': 0, 'UNREADABLE': 0}, []
for g in gt:
    slug = g['source_file'].split('/')[-1][:-4]; page = pages(slug)[int(g['source_page']) - 1]
    geo = ns['geometry'](page); w = ns['windows'](page, geo[0], geo[1])
    raw = g['raw_text']; h = HEAD.match(raw); name, toks = split_tail(h.group(4)); base = h.start(4) + len(name)
    ends = [base + m.end() for m in re.finditer(NUM, raw[base:])][:len(toks)]
    cols = []
    for e in ends:
        near = [k for k in range(3) if w[k][0] <= e <= w[k][1]]
        cols.append(near[0] if len(near) == 1 else -1)
    assert -1 not in cols and len(set(cols)) == len(cols) == 2, g['source_line_start']
    pred = (COLS[cols[0]], COLS[cols[1]], COLS[3 - cols[0] - cols[1]])
    if g['状態'] != 'RESOLVED': res[g['状態']] += 1; continue
    res['RESOLVED'] += 1
    truth = (g['第1金額の列'], g['第2金額の列'], g['空欄列'])
    if pred == truth: res['correct'] += 1
    else: wrong.append({'source_file': g['source_file'], 'page': g['source_page'], 'line': g['source_line_start'], 'gt': truth, 'window': pred})
verdict = 'NO EVALUABLE GT / STOP' if res['RESOLVED'] == 0 else ('GO' if not wrong else 'STOP')
print(json.dumps({'gt_sha256': fr['gt_sha256'], **res, 'misplaced': len(wrong), 'verdict': verdict, 'wrong': wrong}, ensure_ascii=False, indent=1))
