#!/usr/bin/env python3
"""取得して分類した候補 PDF（fy{year}-pdf-candidates.csv）から、令和N年度の歳出概算要求書と確認できたものを選び、fy{year}-expenditure-request-pdfs.csv を作る。

  python3 -I scripts/research/select-expenditure-request-pdfs.py <year>
選ぶ条件（先頭 2 頁の本文。fetch-and-classify-budget-request-pdfs.py が記録した印）:
  (a) 令和N年度で、「歳出概算要求」の印がある
  (b) 表題のない続きの頁から始まる明細表の PDF: 「明細継続」の印（表の見出しに「要求事項・前年度・N年度・概算要求額」）がある
      ただし (b) は、同じ掲載ページに (a) で選ばれた PDF があるものだけ（無関係な資料の表を拾わないため）
出力の列は append-manual-budget-request-pdfs.py と同じ: pdf_url, landing_url, pages, sha256, first_line。
"""
import csv, sys

year = sys.argv[1]
D = 'docs/inventory/budget-request-sources'
rows = list(csv.DictReader(open(f'{D}/fy{year}-pdf-candidates.csv', encoding='utf-8')))
n = f'令和{int(year) - 2018}年度'
a = [r for r in rows if r['year_and_first_line'].startswith(n) and '歳出概算要求' in r['page_marks']]
pages_a = {r['landing_url'] for r in a}
b = [r for r in rows if r not in a and '明細継続' in r['page_marks'] and r['landing_url'] in pages_a]
with open(f'{D}/fy{year}-expenditure-request-pdfs.csv', 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh, lineterminator='\n'); w.writerow(['pdf_url', 'landing_url', 'pages', 'sha256', 'first_line'])
    for r in sorted(a + b, key=lambda r: r['pdf_url']):
        w.writerow([r['pdf_url'], r['landing_url'], r['pages'], r['sha256'], r['year_and_first_line'] if r in a else '継続頁|' + r['year_and_first_line']])
print(len(a), 'PDFs (title found) +', len(b), 'continuation PDFs ->', f'{D}/fy{year}-expenditure-request-pdfs.csv')
