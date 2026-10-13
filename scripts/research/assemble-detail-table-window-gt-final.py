#!/usr/bin/env python3
"""窓GT: A/B の一致 126 行＋目視 adjudication 14 行から final GT candidate を機械的に組み立てる。

  python3 -I scripts/research/assemble-detail-table-window-gt-final.py

A/B は上書きしない。一致した行は A/B の値をそのまま採用（根拠の文面は A）。不一致 14 行は ADJ（ChatGPT の独立目視、
window の候補は見ていない）の採否に従い、採用した側の行をそのまま写す。T013 は B（AMBIGUOUS、3列空欄）。
"""
import csv, hashlib, json, os
FIX = 'tests/fixtures/budget-request-detail-table-window-gt/2024'
ADJ = {13: 'B', 17: 'B', 18: 'B', 29: 'A', 58: 'A', 59: 'A', **{i: 'A' for i in range(76, 84)}}
rd = lambda p: list(csv.DictReader(open(p, encoding='utf-8')))
A, B = rd(f'{FIX}/annotation-a/gt.csv'), rd(f'{FIX}/annotation-b/gt.csv')
T = rd(f'{FIX}/annotation-targets.csv')
L = lambda x: (x['状態'], x['第1金額の列'], x['第2金額の列'], x['空欄列'])
out, src = [], {}
for i, (a, b) in enumerate(zip(A, B), 1):
    assert [a[k] for k in list(a)[:4]] == [b[k] for k in list(b)[:4]] == [T[i - 1][k] for k in list(a)[:4]]
    if L(a) == L(b):
        assert i not in ADJ; out.append(a); src[i] = 'A=B'
    else:
        assert i in ADJ, i; out.append({'A': a, 'B': b}[ADJ[i]]); src[i] = ADJ[i]
assert sorted(ADJ) == sorted(i for i in src if src[i] != 'A=B') and len(out) == 140
os.makedirs(f'{FIX}/final', exist_ok=True)
p = f'{FIX}/final/gt.csv'
with open(p, 'w', encoding='utf-8', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(A[0]), lineterminator='\n'); w.writeheader(); w.writerows(out)
st = {}
for x in out: st[x['状態']] = st.get(x['状態'], 0) + 1
print(json.dumps({'rows': len(out), 'states': st, 'agree': sum(1 for v in src.values() if v == 'A=B'),
                  'adjudicated': len(ADJ), 'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest()}, ensure_ascii=False))
