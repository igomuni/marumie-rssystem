#!/usr/bin/env python3
"""凍結済みの PDF corpus に後から取得した PDF を、補遺（pdf-corpus-freeze-supplement-{name}.json）として記録する。凍結記録そのものは変更しない。

  python3 -I scripts/research/make-budget-request-pdf-corpus-supplement.py <year> <name> <results.csv>
入力: 取得結果の CSV（missing-pdfs-retrieval-results.csv。列 fiscal_year, authority, account, category, pdf_url, local_path, status）。
対象: fiscal_year == <year>、status == SAVED の行と、category が A で始まる EXISTING の行（取得済みだが補遺にまだ無いもの）。SHA-256・bytes・頁数は実ファイルから取り直す（CSV の sha256 と違えば STOP）。URL は https の .go.jp のみ。
"""
import csv, hashlib, json, os, re, subprocess, sys
from urllib.parse import urlparse, unquote

year, name, results = sys.argv[1:4]
docs = []
for r in csv.DictReader(open(results, encoding='utf-8')):
    if r['fiscal_year'] != year or not (r['status'] == 'SAVED' or (r['status'] == 'EXISTING' and r['category'].startswith('A'))): continue
    p = urlparse(r['pdf_url']); host = (p.hostname or '').lower().removeprefix('www.')
    segs = [unquote(s) for s in p.path.split('/') if s]
    if p.scheme != 'https' or not host.endswith('.go.jp') or any(s in ('.', '..') or re.search(r'[/\\\0]', s) for s in segs): sys.exit(f'STOP: unsafe url {r["pdf_url"]}')
    local = os.path.join('data', 'download', host, *[s.replace('%', '%25').replace('$', '%24') for s in segs])
    b = open(local, 'rb').read()
    if hashlib.sha256(b).hexdigest() != r['sha256']: sys.exit(f'STOP: sha mismatch {local}')
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', local], capture_output=True, text=True).stdout).group(1))
    docs.append({'publisherAuthority': r['authority'], 'publisherDomain': host, 'logicalAuthority': None, 'accountType': 'special' if '特別会計' in r['account'] else 'general', 'account': r['account'],
                 'sourceUrl': r['pdf_url'], 'localPdfPath': local.replace(os.sep, '/'), 'bytes': len(b), 'pdfSha256': hashlib.sha256(b).hexdigest(), 'pageCount': n, 'acquisition': 'manual', 'retrievalNote': r.get('note', '')})
docs.sort(key=lambda d: d['localPdfPath'])
for i, d in enumerate(docs): d['targetIndex'] = i; d['kind'] = 'document'; d['role'] = None
digest = hashlib.sha256('\n'.join(f"{d['localPdfPath']} {d['pdfSha256']}" for d in docs).encode()).hexdigest()
out = f'tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze-supplement-{name}.json'
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({'schema': 'budget-request-pdf-corpus-freeze-supplement/v0', 'scope': f'FY{year} の凍結済み PDF corpus に、後から取得した PDF の補遺。凍結記録は変更していない。',
           'addedAfterFreeze': True, 'frozenInput': {'targets': len(docs), 'physicalPages': sum(d['pageCount'] for d in docs), 'corpusDigestRule': 'sha256(各 target について "{localPdfPath} {pdfSha256}" を改行連結。localPdfPath の昇順)', 'corpusDigestSha256': digest},
           'documents': docs}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open(out, 'a').write('\n')
print(len(docs), 'targets;', sum(d['pageCount'] for d in docs), 'pages ->', out)
