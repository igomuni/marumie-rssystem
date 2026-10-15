#!/usr/bin/env python3
"""FY2025 概算要求（TOC・総表・明細表）と MOF の基礎 inventory（記述のみ。read-only）。

  python3 -I scripts/research/build-fy2025-inventory.py <out-dir>

契約: docs/tasks/20261015_0710_FY2025_Budget_Request_and_MOF_Inventory_Contract.md。
<out-dir> に toc-entries.csv, by-source.csv, detail-items.csv, mof-sections.csv, summary.json を書く。入力の hash が凍結値と違えば何も出さずに STOP する。
"""
import collections, csv, glob, gzip, hashlib, json, os, re, sys

D = 'tests/fixtures/budget-request-csv/2025'
MOF = 'data/normalized/mof/fy2025/budget-jikou-v1-canonical.jsonl'
MOF_V1 = 'public/data/mof-jikou-2025.json.gz'
SECTIONS = 'tests/fixtures/detail-table-toc-total-sections/2025/section-candidates.csv'
TRIPLE = 'tests/fixtures/detail-table-mof-section-match/2025/triple-match.csv'
CORPUS = 'tests/fixtures/budget-request-pdf-corpus/2025/pdf-corpus-freeze.json'
FROZEN = {
    f'{D}/toc/output-hashes.json': '481e44e4e9947106f3dc6dec89d254cdafdbebbbebff06cfe033022977175f51',
    f'{D}/total-table/output-manifest.json': '9fb163aee8748157d6d43fd98cf00c480771ae55eb3beb3a907f959d86be01ba',
    f'{D}/detail-table/output-manifest.json': '0bdeeb372f3fd8450fba35274c4af7994434ddcf2447d6d048f1284ef428a0a7',
    f'{D}/detail-table-mof-match/output-manifest.json': '5b17a565e3a3f2666edf6399a547ad5f61043385d9e90b35f833921c2b0956a1',
    SECTIONS: 'cd5ea2aeae50c36a9bd3811b249e7037236df44e48afb724166d6540e4802d86',
    TRIPLE: '2be288bc3d6d50f63345d87b58b453a5556fda112114e05845f928d8b8322dc6',
    MOF: '9c0a878b7ed5552cfb0786e7d9501e97937c9295e0210a544ab98a421ce79a38',
    MOF_V1: '634a4166e84590dd1320691519f6a2bc4b5212d613c5fdbce1cb6a382ba686a5',
}
MARK = re.compile(r'^[（(](組織|項|会計|勘定|所管)[）)]\s*(.*)$')
CODE = re.compile(r'^([0-9]+(?:[‑-][0-9]+)*)\s*(.*)$')
SEC = re.compile(r'^([0-9]{2,3}) (.+)$')
DET = re.compile(r'^([0-9]{2})[‑-]([0-9]{2}) (.*)$')
MIN = re.compile(r'^[0-9]{2}\s+(.+?)所管')
NUM = re.compile(r'^△?[0-9,]+$')


def sha(p):
    with open(p, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def compact(s): return re.sub(r'[\s　]+', '', s)


def nonzero(c): return bool(c) and NUM.match(c) is not None and int(c.replace(',', '').replace('△', '')) != 0


def dist(values):
    c = collections.Counter('3+' if v >= 3 else str(v) for v in values)
    return {k: c[k] for k in ('1', '2', '3+') if k in c}


def detail_x(R):
    def imm(k):
        if k > 0 and R[k - 1]['row_type'] in ('CODE3', 'CODE2'):
            m = SEC.match(R[k - 1]['事項'])
            if m: return m.group(1), compact(m.group(2))
        return None
    out = {}
    for n, r in enumerate(R):
        if r['row_type'] != 'DETAIL': continue
        x = imm(n)
        if x is None:
            for k in range(n - 1, -1, -1):
                if R[k]['row_type'] == 'DETAIL':
                    x = imm(k)
                    if x: break
        out[r['row_index']] = x
    return out


def read(p): return list(csv.DictReader(open(p, encoding='utf-8')))


def write(path, cols, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(cols); w.writerows(rows)


def main(out):
    for p, h in FROZEN.items():
        if sha(p) != h: sys.exit(f'STOP: {p} SHA-256 mismatch')
    for base, man in ((f'{D}/total-table', 'output-manifest.json'), (f'{D}/detail-table', 'output-manifest.json'), (f'{D}/detail-table-mof-match', 'output-manifest.json')):
        for rel, h in json.load(open(f'{base}/{man}')).items():
            if sha(f'{base}/{rel}') != h: sys.exit(f'STOP: {base}/{rel} differs from its manifest')
    for rel, v in json.load(open(f'{D}/toc/output-hashes.json'))['files'].items():
        if rel != 'output-hashes.json' and sha(f'{D}/toc/{rel}') != v['sha256']: sys.exit(f'STOP: toc/{rel} differs from output-hashes.json')
    slug = lambda p: re.sub(r'\.pdf$', '', p.replace('data/download/', '', 1)).replace('/', '__')
    all_slugs = sorted(slug(d['localPdfPath']) for d in json.load(open(CORPUS))['documents'])
    assert len(all_slugs) == 131

    # ---- TOC
    toc_rows, role_by_src = [], collections.defaultdict(collections.Counter)
    for f in sorted(glob.glob(f'{D}/toc/sources/*.csv')):
        s = os.path.basename(f)[:-4]; assert s in all_slugs, s
        ctx = {}
        for i, r in enumerate(read(f), 1):
            m = MARK.match(r['区分'])
            if m:
                role, body = m.group(1), m.group(2)
                if role in ('所管', '会計'): ctx.pop('組織', None); ctx.pop('勘定', None)
                elif role == '勘定': ctx.pop('組織', None)
                cm = CODE.match(body); code, name = (cm.group(1), compact(cm.group(2))) if cm else ('', compact(body))
                ctx[role] = f'{code} {name}'.strip()
            elif r['要求番号']:
                role = '事項'; cm = CODE.match(r['区分']); code, name = (cm.group(1), compact(cm.group(2))) if cm else ('', compact(r['区分']))
            else:
                role = 'other'; code, name = '', compact(r['区分'])
            toc_rows.append([s, i, role, code, name, r['要求番号'], r['ページ'], ctx.get('所管', ''), ctx.get('会計', ''), ctx.get('勘定', ''), ctx.get('組織', '')])
            role_by_src[s][role] += 1
    os.makedirs(out, exist_ok=True)
    write(f'{out}/toc-entries.csv', ['source', 'csv_row', 'role', 'code', 'name', 'request_no', 'page_ref', 'ctx_shokan', 'ctx_kaikei', 'ctx_kanjo', 'ctx_soshiki'], toc_rows)
    roles = collections.Counter(r[2] for r in toc_rows)
    n_toc_sources = len(role_by_src)  # 後で全 slug を参照して defaultdict が膨らむので、ここで数える
    kou = [r for r in toc_rows if r[2] == '項']

    # ---- total table, detail table
    total_rt, detail_rt = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    for f in sorted(glob.glob(f'{D}/total-table/sources/*.csv')):
        s = os.path.basename(f)[:-4]; assert s in all_slugs, s
        for r in read(f): total_rt[s][r['row_type']] += 1
    n_total_sources = len(total_rt)
    sections = {(r['source'], r['detail_row_index']): r for r in read(SECTIONS)}
    prev = {(r['source'], r['row_index']): r for r in read(f'{D}/detail-table-mof-match/matches.csv')}
    mof = [json.loads(l) for l in open(MOF, encoding='utf-8') if l.strip()]
    mof_count = collections.Counter((m['ministry'], m['jikouName']) for m in mof)
    items, scope_by_src = [], {}
    for f in sorted(glob.glob(f'{D}/detail-table/sources/*.csv')):
        s = os.path.basename(f)[:-4]; assert s in all_slugs, s
        R = read(f)
        for r in R: detail_rt[s][r['row_type']] += 1
        ctx = next((r['事項'] for r in R if r['row_type'] == 'CONTEXT'), None)
        scope = 'no_context' if ctx is None else 'special' if re.match(r'^[0-9]{4}\s', ctx) else 'general' if MIN.match(ctx) else 'other'
        ministry = MIN.match(ctx).group(1) if scope == 'general' else ''
        X = detail_x(R)
        for n, r in enumerate(R):
            if r['row_type'] != 'DETAIL': continue
            k = n + 1
            while k < len(R) and R[k]['row_type'] != 'DETAIL': k += 1
            zero = not any(nonzero(x['前年度予算額']) or nonzero(x['６年度概算要求額']) for x in R[n:k])
            d = DET.match(r['事項'])
            sec = sections[(s, r['row_index'])]
            cand = sec['status'] == 'CANDIDATE_CSV_CONSISTENT'
            x = X[r['row_index']]
            agrees = '' if not (cand and x) else str(sec['section_code'] == x[0] and sec['section_name'] == x[1]).lower()
            items.append({'source': s, 'row_index': r['row_index'], 'scope': scope, 'ministry': ministry, 'code': r['事項'][:5], 'name': d[3] if d else '',
                          'request_no': r['要求番号'], 'source_page': r['source_page'], 'zero_amount': str(zero).lower(),
                          'confirmed_section_code': sec['section_code'] if cand else '', 'confirmed_section_name': sec['section_name'] if cand else '',
                          'section_status': sec['status'], 'x_section_agrees': agrees, 'k2_status': prev[(s, r['row_index'])]['status']})
    same = collections.Counter((i['ministry'], i['name']) for i in items if i['scope'] == 'general')
    for i in items:
        g = i['scope'] == 'general'
        i['request_same_name_rows'] = same[(i['ministry'], i['name'])] if g else ''
        i['mof_same_name_records'] = mof_count.get((i['ministry'], i['name']), 0) if g else ''
    cols = ['source', 'row_index', 'scope', 'ministry', 'code', 'name', 'request_no', 'source_page', 'zero_amount', 'request_same_name_rows',
            'confirmed_section_code', 'confirmed_section_name', 'section_status', 'x_section_agrees', 'k2_status', 'mof_same_name_records']
    write(f'{out}/detail-items.csv', cols, [[i[c] for c in cols] for i in items])

    n_detail_sources = len(detail_rt)
    # ---- per-source ledger
    sec_by_src = collections.defaultdict(collections.Counter)
    for i in items: sec_by_src[i['source']][i['section_status']] += 1
    scope_cnt = collections.defaultdict(collections.Counter)
    for i in items: scope_cnt[i['source']][i['scope']] += 1
    rrole = ['所管', '会計', '勘定', '組織', '項', '事項', 'other']
    trt = ['CODE3', 'DETAIL', 'HIER', 'TOTAL']
    drt = ['CONTEXT', 'CODE1', 'CODE2', 'CODE3', 'CODE_5_4_2_4', 'CODE_NN_NNNN', 'DETAIL']
    stat = sorted({i['section_status'] for i in items})
    scol = ['source'] + [f'toc_{r}' for r in rrole] + [f'total_{r}' for r in trt] + [f'detail_{r}' for r in drt] + [f'detail_scope_{c}' for c in ('general', 'special', 'no_context', 'other')] + [f'section_{s}' for s in stat]
    write(f'{out}/by-source.csv', scol, [[s] + [role_by_src[s][r] for r in rrole] + [total_rt[s][r] for r in trt] + [detail_rt[s][r] for r in drt]
                                        + [scope_cnt[s][c] for c in ('general', 'special', 'no_context', 'other')] + [sec_by_src[s][t] for t in stat] for s in all_slugs])

    # ---- MOF
    sec_rec = collections.Counter((m['ministry'], m['organization'], m['sectionCode'], m['sectionName']) for m in mof)
    write(f'{out}/mof-sections.csv', ['ministry', 'organization', 'sectionCode', 'sectionName', 'jikou_records'], [list(k) + [v] for k, v in sorted(sec_rec.items())])
    v1 = json.load(gzip.open(MOF_V1, 'rt', encoding='utf-8'))['items']
    v1c = collections.Counter((x['budgetType'], x['accountType']) for x in v1)

    gen = [i for i in items if i['scope'] == 'general']
    summary = {
        'fiscalYear': 2025,
        'inputs': {os.path.relpath(p): h for p, h in FROZEN.items()} | {'script_sha256': sha(__file__)},
        'toc': {'rows': len(toc_rows), 'rowsByRole': dict(sorted(roles.items())), 'sources': n_toc_sources, 'pdfsWithoutToc': len(all_slugs) - n_toc_sources,
                'kou': {'rows': len(kou),
                        'unique_source_ctx_code_name': len({tuple(r[0:1] + r[7:11] + r[3:5]) for r in kou}),
                        'unique_code_name': len({(r[3], r[4]) for r in kou})}},
        'totalTable': {'sources': n_total_sources, 'rows': sum(sum(c.values()) for c in total_rt.values()), 'rowsByType': dict(sorted(sum(total_rt.values(), collections.Counter()).items()))},
        'detailTable': {'sources': n_detail_sources, 'rows': sum(sum(c.values()) for c in detail_rt.values()), 'rowsByType': dict(sorted(sum(detail_rt.values(), collections.Counter()).items())),
                        'detailRowsByScope': dict(sorted(collections.Counter(i['scope'] for i in items).items()))},
        'funnel': {'toc_item_rows': roles['事項'], 'total_table_DETAIL_rows': sum(c['DETAIL'] for c in total_rt.values()), 'detail_table_DETAIL_rows': len(items),
                   'detail_rows_with_toc_total_section': sum(1 for i in items if i['section_status'] == 'CANDIDATE_CSV_CONSISTENT'),
                   'detail_rows_section_agrees_with_X': sum(1 for i in items if i['x_section_agrees'] == 'true'),
                   'detail_rows_section_disagrees_with_X': sum(1 for i in items if i['x_section_agrees'] == 'false'),
                   'sectionStatus': dict(sorted(collections.Counter(i['section_status'] for i in items).items()))},
        'sameNameItems': {'request_general_rows_by_same_name_rows': dist([i['request_same_name_rows'] for i in gen]),
                          'request_general_distinct_ministry_name_by_rows': dist(list(same.values())),
                          'mof_distinct_ministry_name_by_records': dist(list(mof_count.values()))},
        'zeroAmountItems': {'byScope': {sc: {'items': sum(1 for i in items if i['scope'] == sc), 'zero': sum(1 for i in items if i['scope'] == sc and i['zero_amount'] == 'true')} for sc in ('general', 'special', 'no_context')},
                            'generalByK2Status': {st: {'items': sum(1 for i in gen if i['k2_status'] == st), 'zero': sum(1 for i in gen if i['k2_status'] == st and i['zero_amount'] == 'true')}
                                                  for st in sorted({i['k2_status'] for i in gen})}},
        'mof': {'general_initial_budget_canonical': {'records(jikou)': len(mof), 'ministries': len({m['ministry'] for m in mof}), 'organizations(ministry,organization)': len({(m['ministry'], m['organization']) for m in mof}),
                                                     'sections(ministry,organization,code,name)': len(sec_rec), 'sections(ministry,name)': len({(m['ministry'], m['sectionName']) for m in mof})},
                'v1_items_by_budgetType_and_accountType': {f'{b} | {a}': n for (b, a), n in sorted(v1c.items())},
                'moku': 'not included (no FY2025 dataset in this worktree)'},
    }
    json.dump(summary, open(f'{out}/summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2, sort_keys=True)
    open(f'{out}/summary.json', 'a').write('\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


main(sys.argv[1])
