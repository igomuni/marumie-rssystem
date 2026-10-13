#!/usr/bin/env python3
"""明細表 CSV v0 の取りこぼしの原因分類（read-only。結果は標準出力の JSON だけ）。

  python3 -I scripts/research/isolate-detail-table-failures.py

入力（ローカルの生成物。生成コマンドは docs/budget-request-detail-table-csv.md と docs/budget-request-total-table-csv.md）:
  data/work/budget-request-plain-text.zip
  data/work/budget-request-csv/2024/detail-table/{sources/*.csv, unresolved.csv}
  data/work/budget-request-csv/2024/total-table/sources/*.csv

分けて数える（原因の族が別なので、集計・分類を混ぜない）:
  A. unresolved.csv の「左側の行」1,573行（LEFT_*）の原因
  B. 総表の `明細書頁数` から明細表の `頁` が見つからない行の原因
  C. 印刷された頁のラベルの内訳（全明細表ページ）
判定は、行の文字・位置・前後の行だけで行う。補完・推測・外部知識は使わない。
例外は B の「参考診断（推定）」1か所だけ（ラベルとページ位置の差の最頻値からの位置予測）。出力のキーに「推定」と付け、原因の確定には使わない。
"""
import bisect
import collections
import csv
import glob
import json
import os
import re
import zipfile

ZIP = 'data/work/budget-request-plain-text.zip'
DETAIL = 'data/work/budget-request-csv/2024/detail-table/'
TOTAL = 'data/work/budget-request-csv/2024/total-table/'
ENTRY = re.compile(r'^budget-request-plain-text/2024/([^/]+)\.txt$')
comp = lambda s: re.sub(r'\s+', '', s)
num = lambda s: re.sub(r'[^0-9]', '', s)

# ---- 明細表パーサ（docs/budget-request-detail-table-csv.md）と同じ文法の、集計に要る部分 ----
HY = '[‑-]'
CODE = (rf'(?:[0-9]{{5}}{HY}\s*[0-9]{{1,4}}{HY}[0-9]{{2}}{HY}[0-9]{{4}}|[0-9]{{2}}{HY}[0-9]{{4}}|[0-9]{{2}}{HY}[0-9]{{2}}|[0-9]{{1,3}})')
HEAD = re.compile(rf'^(\s*)(?:([0-9]{{1,3}})\s+(?=[0-9]{{2}}{HY}[0-9]{{2}}\s))?({CODE})\s+(\S.*)$')
NUM = r'(?:△\s*)?[0-9][0-9,]*'
SIG = ['事項', '前年度', '比較増', '備考', '予算額', '概算要求額']
HEADER_2 = re.compile(r'番\s*号.*予\s*算\s*額.*比\s*較')
VOCAB = re.compile(r'^(?:要求|番号|事項|前年度|６年度|予算額|概算要求額|対前年度|比較増△減|比較増△|比較増|比較|備考)+$')
WINDOW_WORDS = [(r'予\s*算\s*額', (-4, 5)), (r'概算要求額', (-2, 16)), (r'比\s*較\s*(?:増\s*△?\s*減?)?', (0, 16))]
BOX = re.compile(r'[│┌┐└┘├┤─┬┴┼｜┃━]')
PAREN = re.compile(r'[0-9,]+\s*[(（]\s*[0-9,]+\s*[)）]')
MARK = re.compile(r'^\s*(?:[（(]?[０-９0-9]+[）)．.、]|[（(][ア-ン][）)]|[ア-ン][．.\s]|[①-⑳]|[○●◎◆■□・※＊*])')


def is_detail_page(page):
    c = comp(page)
    return all(w in c for w in SIG) and not all(w in c for w in ['一般行政経費', 'その他の経費', '明細書'])


def header_geometry(page):
    """(境の桁 q, 備考見出しの桁 b, ヘッダ領域の最終行 index) か None。"""
    lines = page.split('\n')
    first = next((i for i, l in enumerate(lines) if '事項' in comp(l) and '前年度' in comp(l) and '備考' in comp(l)
                  and 0 < l.find('前') < l.find('備')), None)
    if first is None:
        return None
    end = next((i for i, l in enumerate(lines) if i >= first and HEADER_2.search(l)), None)
    return None if end is None else (lines[first].find('前'), lines[first].find('備'), end)


def header_windows(page, b, end):
    line = page.split('\n')[end]
    out = []
    for pat, (lo, hi) in WINDOW_WORDS:
        m = re.search(pat, line)
        if not m:
            return None
        out.append((min(m.end() + lo, b), min(m.end() + hi, b)))
    return out


def split_tail(rest):
    for m in re.finditer(r'\s{2,}|(?<=\S)\s(?=△)', rest):
        mm = re.match(rf'((?:{NUM})(?:\s*(?:{NUM}))*)(?=\s|$)(.*)$', rest[m.end():])
        if mm:
            return rest[:m.start()].strip(), re.findall(NUM, mm.group(1))
    mm = re.search(rf'\s((?:{NUM})(?:\s*(?:{NUM}))+)(?=\s|$)(.*)$', rest)
    if mm:
        return rest[:mm.start()].strip(), re.findall(NUM, mm.group(1))
    return rest.strip(), []


def token_ends(line):
    h = HEAD.match(line)
    if not h:
        return None
    name, toks = split_tail(h.group(4))
    base = h.start(4) + len(name)
    return toks, [base + m.end() for m in re.finditer(NUM, line[base:])][:len(toks)]


def label_of(page):
    """ページの最初の非空行が、表題・所管・単位・表頭でなければ、ページラベル（空白を除く）。"""
    first = next((l for l in page.split('\n') if l.strip()), '')
    c = comp(first)
    if VOCAB.match(c) or '概算要求額明細表' in c or '単位' in c or (('所管' in c or '会計' in c) and re.match(r'[0-9]{1,4}', c)):
        return None
    return c


def main():
    z = zipfile.ZipFile(ZIP)
    sources = {}
    for n in sorted(z.namelist()):
        m = ENTRY.match(n)
        if m:
            text = z.read(n).decode('utf-8')
            pages = text.split('\f')
            if text.endswith('\f'):
                pages.pop()
            sources[m.group(1)] = pages
    # file-wide physical line numbers (1-based; a Form Feed is not a newline) and the first line of each page
    flines, first_line = {}, {}
    for slug, pages in sources.items():
        flines[slug] = ''.join(pages).split('\n')
        first, n = [], 1
        for p in pages:
            first.append(n)
            n += p.count('\n')
        first_line[slug] = first

    detail_rows = {}
    for f in sorted(glob.glob(DETAIL + 'sources/*.csv')):
        detail_rows[os.path.basename(f)[:-4]] = list(csv.DictReader(open(f, encoding='utf-8')))
    unresolved = list(csv.DictReader(open(DETAIL + 'unresolved.csv', encoding='utf-8')))
    unres_by_src = collections.defaultdict(dict)
    for u in unresolved:
        unres_by_src[u['source_file'].split('/')[-1][:-4]][int(u['source_line_start'])] = u['reason']

    out = {}

    # =============== A. 左側の未解決の行 ===============
    left = [u for u in unresolved if u['reason'].startswith('LEFT_')]
    A = {'left_side_unresolved_lines': len(left),
         'by_reason': dict(sorted(collections.Counter(u['reason'] for u in left).items())),
         'concentration': dict(collections.Counter(u['source_file'].split('/')[-1][:48] for u in left).most_common(4))}
    fam = collections.Counter()
    cascade_heads, other_examples = [], []
    for u in left:
        slug = u['source_file'].split('/')[-1][:-4]
        pg, ln = int(u['source_page']), int(u['source_line_start'])
        page = sources[slug][pg - 1]
        g = header_geometry(page)
        q = g[0]
        text = u['raw_text']
        lt = comp(text[:q])
        if BOX.search(text):
            fam['A1 罫線の表（罫線の文字）'] += 1
            continue
        if PAREN.search(text) or re.search(r'[0-9,]{3,}\s*[(（]', text):
            fam['A2 備考の表の行（金額と、括弧つきの金額）'] += 1
            continue
        if MARK.match(text):
            fam['A3 番号・箇条書きの備考の文'] += 1
            continue
        if len(lt) > 30:
            fam['A4 長い文'] += 1
            continue
        if re.search(r'[0-9]', lt):
            fam['A5 数字を含む短い文'] += 1
            continue
        # A6: 数字を含まない短い文字。直前の見出し行（コード行）との関係で分ける
        fl = flines[slug]
        first = first_line[slug][pg - 1]
        j, head = ln - 1, None
        while j >= first:
            l = fl[j - 1]
            if l.strip() and len(l) - len(l.lstrip()) < q and HEAD.match(l):
                head = j
                break
            j -= 1
        start = head if head is not None else first
        in_naiyaku = any(('内訳表' in comp(fl[k - 1])) or comp(fl[k - 1]).startswith('区分') or '区分' in comp(fl[k - 1])[:12]
                         or '国庫債務負担行為' in comp(fl[k - 1])[:12] for k in range(start, ln + 1))
        if in_naiyaku:
            key = 'A6a 数字なしの短い文字、備考の表（内訳表、区分、国庫債務負担行為の表）の中'
        elif head is not None and head in unres_by_src[slug]:
            key = 'A6b 数字なしの短い文字、直前の見出し行が、それ自体 unresolved（' + unres_by_src[slug][head] + '）→ 連鎖'
            cascade_heads.append((slug, head))
        else:
            key = 'A6c 数字なしの短い文字、上のどれでもない'
            other_examples.append(text.strip()[:60])
        fam[key] += 1
    A['by_family'] = dict(sorted(fam.items()))
    a_note = sum(v for k, v in fam.items() if k[:2] in ('A1', 'A2', 'A3', 'A4', 'A5') or k.startswith('A6a'))
    A['notes_from_families'] = {
        '規則上、備考由来と分類された（A1〜A3、A5、A6a。判定は文字の特徴と前後の行による）': a_note,
        '直前の見出し行が unresolved の連鎖（その行を取れれば、名称の継続行として連結できる候補）': sum(v for k, v in fam.items() if k.startswith('A6b')),
        'どちらでもない（A6c。根拠が弱く、備考由来とは言い切らない）': sum(v for k, v in fam.items() if k.startswith('A6c')),
    }

    # --- 連鎖の根本原因: BLANK_CELL_COLUMN_UNDETERMINED の行（表頭の窓だけで置けるか）
    blank = [u for u in unresolved if u['reason'] == 'BLANK_CELL_COLUMN_UNDETERMINED']
    win = collections.Counter()
    placeable = set()
    for u in blank:
        slug = u['source_file'].split('/')[-1][:-4]
        page = sources[slug][int(u['source_page']) - 1]
        g = header_geometry(page)
        w = header_windows(page, g[1], g[2])
        te = token_ends(u['raw_text'])
        cols = []
        for e in te[1]:
            near = [k for k in range(3) if w[k][0] <= e <= w[k][1]]
            cols.append(near[0] if len(near) == 1 else -1)
        unique = -1 not in cols and len(set(cols)) == len(cols)
        if unique:
            placeable.add((slug, int(u['source_line_start'])))
        win['表頭の窓だけで、2つの金額の列が一意に決まる' if unique else '表頭の窓だけでは決まらない（窓が重なる）'] += 1
    # 実測の右端で置いた行（parse_status = AMOUNTS_PLACED_BY_PAGE_EDGES）に、表頭の窓を当てたときの一致
    agree = collections.Counter()
    for slug, rows in detail_rows.items():
        for r in rows:
            if r['parse_status'] != 'AMOUNTS_PLACED_BY_PAGE_EDGES':
                continue
            pg = int(r['source_page'])
            page = sources[slug][pg - 1]
            g = header_geometry(page)
            w = header_windows(page, g[1], g[2])
            line = page.split('\n')[int(r['source_line_start']) - first_line[slug][pg - 1]]
            te = token_ends(line)
            cols = []
            for e in te[1]:
                near = [k for k in range(3) if w[k][0] <= e <= w[k][1]]
                cols.append(near[0] if len(near) == 1 else -1)
            truth = [k for k, c in enumerate([r['前年度予算額'], r['６年度概算要求額'], r['対前年度比較増△減']]) if c != '']
            agree['窓が決められない（窓が重なる）' if -1 in cols or len(set(cols)) < 2
                  else ('窓と実測の右端が同じ列' if cols == truth else '窓と実測の右端が食い違う')] += 1
    A['cascade_fragments_whose_head_row_the_header_windows_could_place'] = sum(1 for h in cascade_heads if h in placeable)
    A['other_examples'] = other_examples
    A['blank_cell_rows_undetermined'] = len(blank)
    A['blank_cell_rows_header_window_placement'] = dict(sorted(win.items()))
    A['header_window_vs_measured_edges_on_placed_rows'] = dict(sorted(agree.items()))
    out['A_left_side_unresolved'] = A

    # =============== C. ラベルの内訳（全明細表ページ） ===============
    detpages, c = {}, collections.Counter()
    rows_pages = {(s, int(r['source_page'])) for s, rows in detail_rows.items() for r in rows}
    for slug, pages in sources.items():
        dp = {}
        for i, p in enumerate(pages, 1):
            if not is_detail_page(p):
                continue
            lab = label_of(p)
            dp[i] = lab
            k = 'ラベルの行が無い' if lab is None else ('数字のあるラベル' if re.search(r'[0-9]', lab) else '数字のないラベル')
            c[k] += 1
            c['（左側に行があるページ）' + k if (slug, i) in rows_pages else '（左側に行が無いページ）' + k] += 1
        if dp:
            detpages[slug] = dp
    c['明細表のページ'] = sum(len(v) for v in detpages.values())
    out['C_page_labels'] = dict(sorted(c.items()))

    # =============== B. 総表の明細書頁数 → 明細表の頁 ===============
    B = collections.Counter()
    detail_of_unfound = collections.Counter()
    examples = collections.defaultdict(list)
    for f in sorted(glob.glob(TOTAL + 'sources/*.csv')):
        slug = os.path.basename(f)[:-4]
        if slug not in detpages:
            continue
        csv_labels = {num(r['頁']) for r in detail_rows[slug] if r['頁']}
        all_labels = {num(l) for l in detpages[slug].values() if l and re.search(r'[0-9]', l)}
        offs = collections.Counter(i - int(num(l)) for i, l in detpages[slug].items() if l and num(l))
        mode = offs.most_common(1)[0][0] if offs else None
        for r in csv.DictReader(open(f, encoding='utf-8')):
            v = r['明細書頁数']
            if not v:
                continue
            B['総表の行（明細書頁数あり。同じ source に明細表がある）'] += 1
            if num(v) in csv_labels:
                continue
            B['  行のある頁の `頁` に番号が無い（以前の「見つからない」）'] += 1
            if num(v) in all_labels:
                B['    うち、番号の頁はあるが、左側に行が無い頁（備考だけの頁、または左側が unresolved）'] += 1
                continue
            B['    うち、全明細表ページのラベルにも番号が無い'] += 1
            detail_of_unfound[slug] += 1
            if not num(v):
                B['      明細書頁数に数字が無い'] += 1
            elif mode is None:
                B['      その source の明細表ページに、数字のあるラベルが1つも無い'] += 1
            else:
                pred = int(num(v)) + mode
                B['      （推定・参考診断）数字のあるラベルがある source。ラベルとページ位置の差の最頻値から予測した位置は、明細表ページではない' if pred not in detpages[slug]
                  else '      （推定・参考診断）数字のあるラベルがある source。予測した位置は、別の番号のラベルの頁'] += 1
                if len(examples['pred']) < 3:
                    examples['pred'].append([slug[:30], r['row_type'], v, pred])
    out['B_page_not_found'] = {'counts': dict(sorted(B.items())),
                                'sources_with_unfound_rows': dict(detail_of_unfound.most_common()),
                                'examples_inferred_position_not_a_detail_page': examples['pred'],
                                'label_line_kinds_of_detail_pages_in_sources_with_unfound_rows': {
                                    sl: dict(collections.Counter('ラベルの行が無い' if l is None else ('数字のあるラベル' if re.search(r'[0-9]', l) else '数字のないラベル') for l in detpages[sl].values()))
                                    for sl in detail_of_unfound}}
    print(json.dumps(out, ensure_ascii=False, indent=2))


main()
