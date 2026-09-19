#!/usr/bin/env python3
"""Small raw-data checker intentionally independent from pipeline_v2 modules.

It re-reads the ZIP/CSV sources directly and checks a few invariants against
validation/report.json. This is meant to catch errors in the reference pipeline
itself, not to replace the main validator.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path


def norm(s: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s or ''))


def exp_rows(path: Path):
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.endswith('.csv'):
                continue
            rows = list(csv.DictReader(io.StringIO(z.read(name).decode('utf-8-sig'))))
            if rows and any('主要経費別分類' in h or '使途別分類' in h for h in rows[0]):
                return rows
    raise RuntimeError(path)


def n(row, col):
    v=(row.get(col) or '').strip().replace(',','')
    return int(float(v)) if v else 0


def section_key(row, typ, include_name=True):
    name = [row.get('項名','')] if include_name else []
    if typ=='general':
        parts=['general',row.get('所管',''),row.get('組織',''),row.get('項コード',''),*name]
    elif typ=='special':
        parts=['special',row.get('所管',''),row.get('特別会計',''),row.get('勘定',''),row.get('項コード',''),*name]
    else:
        parts=['agency',row.get('政府関係機関',''),row.get('業務',''),row.get('項コード',''),*name]
    return '|'.join(norm(x) for x in parts)


def item_semantic_key(row, typ):
    if typ=='general': parts=['general',row.get('所管',''),row.get('組織',''),row.get('項コード',''),row.get('項名',''),row.get('目名','')]
    elif typ=='special': parts=['special',row.get('所管',''),row.get('特別会計',''),row.get('勘定',''),row.get('項コード',''),row.get('項名',''),row.get('目名','')]
    else: parts=['agency',row.get('政府関係機関',''),row.get('業務',''),row.get('項コード',''),row.get('項名',''),row.get('目名','')]
    return '|'.join(norm(x) for x in parts)


def current_col(rows):
    for h in rows[0]:
        if '年度' in h and '前年度' not in h and '比較' not in h and '成立' not in h and not h.startswith('改') and any(x in h for x in ['要求額','予定額','予算額']):
            return h
    raise RuntimeError('amount col')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--raw-root',type=Path,required=True)
    ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args()
    report=json.loads(args.report.read_text(encoding='utf-8'))
    b=args.raw_root/'mof.go.jp'/'archive'/'2024'/'2024'/'csv'
    defs=[('initial','general','DL202411001.zip'),('initial','special','DL202412001.zip'),('initial','agency','DL202413001.zip'),('supplement','general','DL202421001.zip'),('supplement','special','DL202422001.zip'),('settlement','agency','DL202476001.zip'),('settlement','general','DL202477001.zip'),('settlement','special','DL202478001.zip')]
    actual={}
    settlement_rows=[]
    for phase,typ,name in defs:
        rows=exp_rows(b/name)
        actual[(phase,typ)] = (len({section_key(r,typ,True) for r in rows}), len({section_key(r,typ,False) for r in rows}))
        if phase=='settlement': settlement_rows.append((typ,rows))
    report_counts={(x['phase'],x['accountType']):(x['sourcePreservingSectionCount'],x['legacyCodeCentricSectionCount']) for x in report['mof']['2024']['sectionCounts']}
    assert actual == report_counts, (actual, report_counts)

    left=right=0
    for typ,rows in settlement_rows:
        for r in rows:
            if typ=='general':
                lhs=n(r,'歳出予算額(円)')+n(r,'前年度繰越額(円)')+n(r,'予備費使用額(円)')+n(r,'流用等増△減額(円)')+n(r,'予算決定後移替増△減額(円)')
                cur=n(r,'歳出予算現額(円)'); rhs=n(r,'支出済歳出額(円)')+n(r,'翌年度繰越額(円)')+n(r,'不用額(円)')
            elif typ=='special':
                lhs=n(r,'歳出予算額(円)')+n(r,'前年度繰越額(円)')+n(r,'予備費使用額(円)')+n(r,'予算総則の規定による経費増額(円)')+n(r,'流用等増△減額(円)')+n(r,'予算決定後移替増△減額(円)')
                cur=n(r,'歳出予算現額(円)'); rhs=n(r,'支出済歳出額(円)')+n(r,'翌年度繰越額(円)')+n(r,'不用額(円)')
            else:
                lhs=n(r,'支出予算額(円)')+n(r,'前年度繰越額(円)')+n(r,'予備費使用額(円)')+n(r,'予算総則の規定による経費増額(円)')+n(r,'流用等増△減額(円)')
                cur=n(r,'支出予算現額(円)'); rhs=n(r,'支出済額(円)')+n(r,'翌年度繰越額(円)')+n(r,'不用額(円)')
            left += lhs != cur; right += rhs != cur
    eq=report['mof']['2024']['settlementEquations']
    assert (left,right)==(eq['leftEquationMismatchCount'],eq['rightEquationMismatchCount'])

    # FY2025 submitted/enacted amendment check, only account families present on both sides.
    base=args.raw_root/'mof.go.jp'/'archive'/'2025'
    delta=0; changed=0
    for typ,suffix in [('general','11'),('special','12')]:
        s=exp_rows(base/'2025_teishutsu'/'csv'/f'DL2025{suffix}001.zip')
        e=exp_rows(base/'2025'/'csv'/f'DL2025{suffix}001.zip')
        cs=current_col(s); ce=current_col(e)
        sm=defaultdict(int); em=defaultdict(int)
        for r in s: sm[item_semantic_key(r,typ)] += n(r,cs)*1000
        for r in e: em[item_semantic_key(r,typ)] += n(r,ce)*1000
        for k in set(sm)|set(em):
            if sm[k]!=em[k]:
                changed += 1; delta += em[k]-sm[k]
    a=report['mof']['2025']['parliamentaryAmendments']
    assert (changed,delta)==(a['count'],a['netDeltaYen']), ((changed,delta),a)

    # RS 2-2 raw row count check.
    for ry in [2024,2025]:
        d=args.raw_root/'rssystem.go.jp'/'download-csv'/str(ry)
        z=next(p for p in d.glob('*.zip') if p.name.startswith(f'2-2_RS_{ry}_'))
        with zipfile.ZipFile(z) as zz:
            name=next(nm for nm in zz.namelist() if nm.endswith('.csv'))
            count=sum(1 for _ in io.TextIOWrapper(zz.open(name), encoding='utf-8-sig'))-1
        assert count==report['rs'][str(ry)]['rowCount'], (ry,count,report['rs'][str(ry)]['rowCount'])

    print('independent check: PASS')
    print('FY2024 section counts:', actual)
    print('FY2024 settlement equation mismatches:', left, right)
    print('FY2025 amendments:', changed, delta)


if __name__=='__main__': main()
