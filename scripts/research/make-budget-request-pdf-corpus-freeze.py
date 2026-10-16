#!/usr/bin/env python3
"""取得して分類した概算要求 PDF（fy{year}-expenditure-request-pdfs.csv）から、PDF corpus の凍結記録（FY2025 と同じ形式）を作る。

  python3 -I scripts/research/make-budget-request-pdf-corpus-freeze.py <year>
各 PDF の SHA-256・bytes・頁数を実ファイルから取り直し、会計の種類と所管・会計の名前は先頭 2 ページの本文（`NN 〇〇所管`／`NNNN 〇〇特別会計`）から読む。
CSV の sha256 と実ファイルの SHA-256 が違えば STOP。出力: tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze.json
"""
import csv, hashlib, json, os, re, subprocess, sys, unicodedata
from urllib.parse import urlparse, unquote

year = sys.argv[1]
D = 'docs/inventory/budget-request-sources'
rows = list(csv.DictReader(open(f'{D}/fy{year}-expenditure-request-pdfs.csv', encoding='utf-8')))
pages = {r['landing_url']: r for r in csv.DictReader(open(f'{D}/fy{year}-landing-pages.csv', encoding='utf-8'))}
nf = lambda s: unicodedata.normalize('NFKC', re.sub(r'\s+', '', s))
docs = []
for r in rows:
    p = urlparse(r['pdf_url']); host = p.hostname.lower().removeprefix('www.')
    local = os.path.join('data', 'download', host, *[unquote(s).replace('%', '%25').replace('$', '%24') for s in p.path.split('/') if s])
    b = open(local, 'rb').read()
    if hashlib.sha256(b).hexdigest() != r['sha256']: sys.exit(f'STOP: sha mismatch {local}')
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', local], capture_output=True, text=True).stdout).group(1))
    txt = nf(subprocess.run(['pdftotext', '-layout', '-f', '1', '-l', '2', local, '-'], capture_output=True, text=True).stdout)
    sp = re.search(r'(\d{4})([^\d（(]{2,24}特別会計)', txt)
    ge = re.search(r'(?<!\d)(\d{2})([^\d（(]{1,12})所管', txt)
    if sp: acct_type, account, header = 'special', sp.group(2), sp.group(1) + sp.group(2)
    elif ge: acct_type, account, header = 'general', '一般会計', ge.group(1) + ge.group(2)
    else: acct_type, account, header = 'unknown', '', ''
    who = pages[r['landing_url']]['listed_for'].split(' ; ')[0].split(':', 1)[-1]
    docs.append({'publisherAuthority': who, 'publisherDomain': host, 'logicalAuthority': header[2:] if acct_type == 'general' else (header[4:] if header else None), 'accountType': acct_type, 'account': account,
                 'sourceUrl': r['pdf_url'], 'localPdfPath': local.replace(os.sep, '/'), 'bytes': len(b), 'pdfSha256': hashlib.sha256(b).hexdigest(), 'pageCount': n, 'acquisition': 'pipeline-fetch'})
docs.sort(key=lambda d: d['localPdfPath'])
for i, d in enumerate(docs): d['targetIndex'] = i; d['kind'] = 'document'; d['role'] = None
digest = hashlib.sha256('\n'.join(f"{d['localPdfPath']} {d['pdfSha256']}" for d in docs).encode()).hexdigest()
out = f'tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze.json'
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({'schema': 'budget-request-pdf-corpus-freeze/v0', 'scope': f'FY{year} 概算要求 PDF の取得集合（財務省のリンク先一覧から辿り、先頭 2 ページで「令和{int(year)-2018}年度」「歳出概算要求」を確認した PDF。text 抽出・意味付け・照合は含まない）',
           'frozenInput': {'targets': len(docs), 'physicalPages': sum(d['pageCount'] for d in docs), 'acquisition': {'pipeline-fetch': len(docs)}, 'unknownAccountType': sum(1 for d in docs if d['accountType'] == 'unknown'),
                           'pdfinfoVersion': subprocess.run(['pdfinfo', '-v'], capture_output=True, text=True).stderr.split('\n')[0], 'corpusDigestRule': 'sha256(各 target について "{localPdfPath} {pdfSha256}" を改行連結。localPdfPath の昇順)', 'corpusDigestSha256': digest},
           'documents': docs}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open(out, 'a').write('\n')
import collections
print(len(docs), 'targets;', sum(d['pageCount'] for d in docs), 'pages;', dict(collections.Counter(d['accountType'] for d in docs)))
