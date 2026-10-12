#!/usr/bin/env python3
"""FY2024 概算要求「歳出概算要求額明細表」の raw text 調査（read-only・結果は標準出力の JSON だけ）。

  python3 -I scripts/research/scan-budget-request-detail-table.py [plain-text.zip]

備考列を除く左側（要求番号・事項・前年度予算額・６年度概算要求額・対前年度比較増△減）を、raw text だけから
CSV にできるかを数える。抽出器ではない。判定は「行の文法」と「検算（要求額−前年度＝増減）」で行い、値の補完・
外部知識は使わない。ただし、2金額行の空欄の列を算術で診断する集計（blank_cell_by_arithmetic）は、列の所属の推定
であり、値を置くための判定には使わない（診断として数えるだけ）。結果の読み方は docs/tasks の同名の調査記録を参照。
"""
import collections
import json
import re
import statistics
import sys
import zipfile

ZIP = sys.argv[1] if len(sys.argv) > 1 else 'data/work/budget-request-plain-text.zip'
ENTRY = re.compile(r'^budget-request-plain-text/2024/[^/]+\.txt$')
compact = lambda s: re.sub(r'\s+', '', s)

# 金額トークン。全角数字は名称・備考の一部なので ASCII だけを数字とみなす。△ は金額の前に離れて付くことがある。
NUM = r'(?:△\s*)?[0-9][0-9,]*'
HYPHEN = '[‑-]'
CODE = (rf'(?:[0-9]{{5}}{HYPHEN}\s*[0-9]{{1,4}}{HYPHEN}[0-9]{{2}}{HYPHEN}[0-9]{{4}}'  # 目（5-4-2-4。桁が空白で割れる行がある）
        rf'|[0-9]{{2}}{HYPHEN}[0-9]{{4}}'                                             # 目の略記 NN-NNNN
        rf'|[0-9]{{2}}{HYPHEN}[0-9]{{2}}'                                             # 事項コード NN-NN
        rf'|[0-9]{{1,3}})')                                                           # 1〜3桁
HEAD = re.compile(rf'^(\s*)(?:([0-9]{{1,3}})\s+(?=[0-9]{{2}}{HYPHEN}[0-9]{{2}}\s))?({CODE})\s+(\S.*)$')


def value(token):
    return (-1 if '△' in token else 1) * int(re.sub(r'[△\s,]', '', token))


def split_tail(rest):
    """コードの後ろを (名称, 金額トークン列, 備考側の残り) に分ける。金額列は2空白以上（または △ の直前）で始まるものとする。"""
    for m in re.finditer(r'\s{2,}|(?<=\S)\s(?=△)', rest):
        mm = re.match(rf'((?:{NUM})(?:\s*(?:{NUM}))*)(?=\s|$)(.*)$', rest[m.end():])
        if mm:
            return rest[:m.start()].strip(), re.findall(NUM, mm.group(1)), mm.group(2).strip()
    mm = re.search(rf'\s((?:{NUM})(?:\s*(?:{NUM}))+)(?=\s|$)(.*)$', rest)
    if mm:
        return rest[:mm.start()].strip(), re.findall(NUM, mm.group(1)), mm.group(2).strip()
    return rest.strip(), [], ''


def code_kind(code):
    c = re.sub(r'\s', '', code)
    if re.fullmatch(rf'[0-9]{{5}}{HYPHEN}[0-9]{{1,4}}{HYPHEN}[0-9]{{2}}{HYPHEN}[0-9]{{4}}', c):
        return 'MOKU_FULL(5-4-2-4)'
    if re.fullmatch(rf'[0-9]{{2}}{HYPHEN}[0-9]{{4}}', c):
        return 'MOKU_SHORT(NN-NNNN)'
    if re.fullmatch(rf'[0-9]{{2}}{HYPHEN}[0-9]{{2}}', c):
        return 'JIKOU(NN-NN)'
    return {1: 'DIGITS_1', 2: 'DIGITS_2', 3: 'DIGITS_3'}[len(c)]


def header_cols(page):
    """明細表の表頭行にある「前年度」「備考」の見出しの開始位置（左側と備考側の境の目安）。"""
    for line in page.split('\n'):
        c = compact(line)
        if '事項' in c and '前年度' in c and '備考' in c:
            q, b = line.find('前'), line.find('備')
            if 0 < q < b:
                return q, b
    return None


# 表頭の2行目の見出しの語の右端から、各列の金額の右端がどこにあるか（FY2024 の4,376ページの実測 + 余裕2文字）。
# 本文の行を読まない（備考の数字が窓に影響しない）。
HEADER_WORD_WINDOWS = [(r'予\s*算\s*額', (-4, 5)), (r'概算要求額', (-2, 16)), (r'比\s*較\s*(?:増\s*△?\s*減?)?', (0, 16))]
EDGE_SPREAD_MAX = 5
EDGE_ACCEPT = EDGE_SPREAD_MAX + 1


def header_windows(second_heading_line, remarks_start):
    out = []
    for pat, (lo, hi) in HEADER_WORD_WINDOWS:
        m = re.search(pat, second_heading_line)
        if not m:
            return None
        out.append((min(m.end() + lo, remarks_start), min(m.end() + hi, remarks_start)))
    return out


def accept_amounts(tokens, ends, windows):
    """数字を左から順に、まだ使っていない列のうち、窓に右端が入る最初の列に割り当てる。入らない数字と、それ以降は備考。"""
    kept, col = 0, -1
    for e in ends:
        nxt = next((k for k in range(col + 1, len(windows)) if windows[k][0] <= e <= windows[k][1]), -1)
        if nxt < 0:
            break
        kept, col = kept + 1, nxt
    return tokens[:kept]


def is_detail_page(page):
    c = compact(page)
    detail = all(w in c for w in ['事項', '前年度', '比較増', '備考', '予算額', '概算要求額'])
    return detail and not all(w in c for w in ['一般行政経費', 'その他の経費', '明細書'])


def main():
    z = zipfile.ZipFile(ZIP)
    corpus = {}
    for n in sorted(z.namelist()):
        if ENTRY.match(n):
            text = z.read(n).decode('utf-8')
            parts = text.split('\f')
            if text.endswith('\f'):
                parts.pop()
            corpus[n.split('/')[-1][:-4]] = parts
    out = {'corpus': {}, 'lines': collections.Counter(), 'head_forms': collections.Counter(),
           'blank_cell_by_arithmetic(diagnosis only, not used to place values)': collections.Counter(), 'blank_cell_by_page_edges': collections.Counter(),
           'edge_spread_chars': {}, 'continuation': collections.Counter(), 'amount_window_effect': collections.Counter(), 'remark_geometry': {}}
    rem_minus_b, rem_minus_e3 = [], []
    detail_sources, no_text = set(), []
    pages_total = sum(len(v) for v in corpus.values())
    detail_pages = 0
    spreads = [[], [], []]
    for s, pages in corpus.items():
        if not any(p.strip() for p in pages):
            no_text.append((s, len(pages)))
        for p in pages:
            if not is_detail_page(p):
                continue
            detail_sources.add(s)
            detail_pages += 1
            hc = header_cols(p)
            if not hc:
                out['lines']['page without header columns'] += 1
                continue
            q, b_col = hc
            page_lines = p.split('\n')
            header_end = next((k for k, x in enumerate(page_lines) if re.search(r'番\s*号.*予\s*算\s*額.*比\s*較', x)), -1)
            hw = header_windows(page_lines[header_end], b_col)
            if hw is None:
                out['lines']['page without all three header words'] += 1
                continue
            # 備考 on the same physical line: a number is an amount only if its right end lies in the window of an amount
            # column (header words only). Edges measured from rows that pass this same test replace the windows.
            samples = [[], [], []]
            for li0, l0 in enumerate(page_lines):
                if li0 <= header_end or not l0.strip() or len(l0) - len(l0.lstrip()) >= q:
                    continue
                h0 = HEAD.match(l0)
                if not h0:
                    continue
                nm0, tk0, _ = split_tail(h0.group(4))
                base0 = h0.start(4) + len(nm0)
                te0 = [base0 + m.end() for m in re.finditer(NUM, l0[base0:])][:len(tk0)]
                acc0 = accept_amounts(tk0, te0, hw)
                if len(acc0) == 3 and value(acc0[1]) - value(acc0[0]) == value(acc0[2]):
                    for k in range(3):
                        samples[k].append(te0[k])
            measurable = len(samples[0]) >= 3 and all(max(x) - min(x) <= EDGE_SPREAD_MAX for x in samples)
            page_windows = [(round(statistics.median(x)) - EDGE_ACCEPT, round(statistics.median(x)) + EDGE_ACCEPT) for x in samples] if measurable else hw
            ends = [[], [], []]
            item2 = []
            last_head_name_col = None
            seen_head = False
            for li, line in enumerate(page_lines):
                if not line.strip():
                    continue
                if li <= header_end:
                    out['lines']['header zone (page label / title / context / unit / table heading)'] += 1
                    continue
                st = len(line) - len(line.lstrip())
                h = HEAD.match(line)
                txt = line.strip()
                if st >= q:
                    out['lines']['right region (備考側。対象外)'] += 1
                    if h:
                        _, rt, _ = split_tail(h.group(4))
                        if len(rt) == 3 and value(rt[1]) - value(rt[0]) == value(rt[2]):
                            out['lines']['  of which look like a valid item (code + 3 amounts, arithmetic OK)'] += 1
                    continue
                if not h and re.search(r'番号|比較増|概算要求額|予\s*算\s*額|事\s*項|前\s*年\s*度', line) and ('番号' in line or '比較' in line or '事' in line):
                    out['lines']['header line'] += 1
                    continue
                if not h:
                    if re.fullmatch(r'[0-9]{4}/[0-9]{2}/[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2}', txt):
                        out['lines']['footer timestamp'] += 1
                    elif re.fullmatch(r'.{1,8}[（(].{1,4}[）)]\s*[0-9０-９]*', txt):
                        out['lines']['page label'] += 1
                    else:
                        out['lines']['name fragment (left, no code)'] += 1
                        if not seen_head:
                            out['continuation']['before any head on the page (continues the previous page)'] += 1
                        elif abs(st - last_head_name_col) <= 1:
                            out['continuation']['aligned with the name start of the preceding head'] += 1
                        else:
                            out['continuation']['not aligned'] += 1
                    continue
                name, toks_all, remark = split_tail(h.group(4))
                base = h.start(4) + len(name)
                tok_ends = [base + m.end() for m in re.finditer(NUM, line[base:])][:len(toks_all)]
                toks = accept_amounts(toks_all, tok_ends, page_windows)
                if len(toks) != len(toks_all):
                    out['amount_window_effect']['lines with numbers outside the amount windows (read as 備考, not as amounts)'] += 1
                    out['amount_window_effect'][f'  {len(toks_all)} tokens -> {len(toks)} tokens'] += 1
                if len(toks) == 3 and remark and len(tok_ends) >= 3:
                    rs = line.find(remark, tok_ends[2])
                    if rs >= 0:
                        rem_minus_b.append(rs - b_col)
                        rem_minus_e3.append(rs - tok_ends[2])
                n = len(toks)
                last_head_name_col, seen_head = h.start(4), True
                kind = code_kind(h.group(3))
                if n == 3:
                    a, b, c = (value(t) for t in toks)
                    label = 'ITEM: 3 amounts, arithmetic OK' if b - a == c else 'ITEM: 3 amounts, arithmetic MISMATCH'
                elif n == 2:
                    label = 'ITEM: 2 amounts (one cell blank)'
                    x, y = (value(t) for t in toks)
                    base = h.start(4) + len(name)
                    item2.append(([base + m.end() for m in re.finditer(NUM, line[base:])][:2], x == y == 0))
                    eq, neg = x == y, x == -y
                    out['blank_cell_by_arithmetic(diagnosis only, not used to place values)']['prev blank (x==y)' if eq and not neg else 'request blank (x==-y)' if neg and not eq
                                                    else 'x=y=0 (either)' if eq and neg else 'neither'] += 1
                elif n == 0:
                    label = 'HEADING: code + name, no amounts'
                else:
                    label = f'HEAD with {n} amount tokens'
                out['lines'][label] += 1
                out['head_forms'][('with 要求番号 + ' if h.group(2) else '') + kind] += 1
                if n == 3 and b - a == c:
                    # 同一ページ内で3列の右端が揃うか（列の割り当てに使えるか）
                    pos = [m.end() + h.start(4) + len(name) for m in re.finditer(NUM, line[h.start(4) + len(name):])][:3]
                    if len(pos) == 3:
                        for k in range(3):
                            ends[k].append(pos[k])
            if len(ends[0]) >= 3:
                for k in range(3):
                    spreads[k].append(max(ends[k]) - min(ends[k]))
            # 空欄セルの列を、同じページの3列の右端（中央値）との位置合わせで決められるか（±3文字で一意）
            for pos, zero in item2:
                if len(ends[0]) < 3:
                    out['blank_cell_by_page_edges']['page has fewer than 3 valid items (cannot calibrate)'] += 1
                    continue
                edges = [statistics.median(e) for e in ends]
                cols = []
                for e in pos:
                    near = [k for k in range(3) if abs(e - edges[k]) <= 3]
                    cols.append(near[0] if len(near) == 1 else None)
                if None in cols or cols[0] == cols[1]:
                    out['blank_cell_by_page_edges']['alignment ambiguous'] += 1
                else:
                    out['blank_cell_by_page_edges']['blank column = ' + ['前年度', '要求額', '比較'][[k for k in range(3) if k not in cols][0]]] += 1
                    if zero:
                        out['blank_cell_by_page_edges']['  of which "0 0" (arithmetic cannot decide) resolved by page edges'] += 1
    out['corpus'] = {
        'sources': len(corpus), 'pages': pages_total,
        'detail_pages': detail_pages, 'detail_sources': len(detail_sources),
        'sources_without_detail_table': len(corpus) - len(detail_sources),
        'sources_with_no_text_layer(page_count)': sorted(no_text),
    }
    out['remark_geometry'] = {
        'row_lines_with_three_amounts_and_remark_text': len(rem_minus_b),
        'remark_text_starts_left_of_the_備考_heading': sum(1 for x in rem_minus_b if x < 0),
        'median_remark_start_minus_備考_heading_column': statistics.median(rem_minus_b),
        'median_remark_start_minus_right_edge_of_第3_amount': statistics.median(rem_minus_e3),
    }
    out['edge_spread_chars'] = {
        'pages_with_at_least_3_valid_items': len(spreads[0]),
        'median_max_spread_prev_req_diff': [statistics.median(sp) for sp in spreads],
        'max_spread_prev_req_diff': [max(sp) for sp in spreads],
    }
    for k in ('lines', 'head_forms', 'blank_cell_by_arithmetic(diagnosis only, not used to place values)', 'blank_cell_by_page_edges', 'continuation', 'amount_window_effect'):
        out[k] = dict(sorted(out[k].items(), key=lambda kv: -kv[1]))
    print(json.dumps(out, ensure_ascii=False, indent=2))


main()
