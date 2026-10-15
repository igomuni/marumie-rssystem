#!/usr/bin/env python3
"""FY2024 exploratory section candidates from TOC + total table; no MOF or K2.

Writes separate research artifacts, never modifies source CSVs or frozen GT.
Candidate status expresses CSV consistency, not independent correctness.
"""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import re


def normalized(value):
    return re.sub(r'\s+', '', value).translate(str.maketrans({c: '-' for c in '‐‑‒–−－'}))


def page_number(value):
    parts = re.findall(r'\d+', value)
    return parts[0] if len(parts) == 1 else None


def marked(value):
    m = re.match(r'^[（(](組織|項|会計|勘定|所管)[）)]\s*(.*)$', value)
    return (m.group(1), m.group(2)) if m else ('', value)


def item_key(row, label):
    return row['要求番号'], normalized(row[label])


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_csv(path, rows, columns):
    with path.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def run(root, output):
    paths = sorted(root.glob('*/sources/*.csv'))
    paths = [p for p in paths if p.parent.parent.name in ('toc', 'total-table', 'detail-table')]
    paths += [root/'toc'/'entry-provenance.csv', root/'toc'/'sources.csv']
    before = {str(p.resolve()): digest(p) for p in paths}
    tables = {}
    for kind in ('toc', 'total-table', 'detail-table'):
        tables[kind] = {p.stem: list(csv.DictReader(p.open())) for p in sorted((root/kind/'sources').glob('*.csv'))}
    provenance = {(r['source_slug'], int(r['csv_row'])): r for r in csv.DictReader((root/'toc'/'entry-provenance.csv').open())}
    source_info = {r['source_slug']: r for r in csv.DictReader((root/'toc'/'sources.csv').open())}
    results = []
    for slug, details in tables['detail-table'].items():
        total = tables['total-table'].get(slug, [])
        toc = tables['toc'].get(slug, [])
        toc_items, total_items = collections.defaultdict(list), collections.defaultdict(list)
        sections, boundaries = collections.defaultdict(list), set()
        current_section, current_org, context = None, '', {}
        for i, row in enumerate(toc, 1):
            role, label = marked(row['区分'])
            if role in ('組織', '会計', '勘定', '所管'):
                current_section = None
                boundaries.add(normalized(label))
                context[role] = label
                if role == '組織':
                    current_org = label
                elif role in ('会計', '所管'):
                    current_org = ''
                    context.pop('組織', None)
                    context.pop('勘定', None)
                elif role == '勘定':
                    current_org = ''
                    context.pop('組織', None)
            elif role == '項':
                current_section = {'label': label, 'toc_row': i, 'page': row['ページ'], 'organization': current_org, 'context': dict(context)}
                sections[normalized(label)].append(current_section)
            elif not row['要求番号']:
                # A title starts a fresh TOC region; unclassified code rows are unsafe.
                current_section = None
            if row['要求番号']:
                toc_items[item_key(row, '区分')].append({'row': row, 'toc_row': i, 'section': current_section})
        total_section = {}
        active, block = None, None
        for row in total:
            if row['table_block_id'] != block:
                active, block = None, row['table_block_id']
            if row['row_type'] == 'TOTAL':
                active = None
            elif row['row_type'] in ('CODE3', 'HIER'):
                label = normalized(row['区分'])
                choices = [s for s in sections.get(label, []) if page_number(s['page']) == page_number(row['明細書頁数']) and page_number(s['page']) is not None]
                # A row also named as an organization cannot be labeled by text alone.
                matching_rows = [x for x in total if x['table_block_id'] == block and x['row_type'] in ('CODE3', 'HIER') and normalized(x['区分']) == label and page_number(x['明細書頁数']) == page_number(row['明細書頁数'])]
                if choices:
                    active = choices[0] if len(choices) == len(matching_rows) == 1 and label not in boundaries else None
                elif label in boundaries:
                    active = None
            if row['row_type'] == 'DETAIL':
                total_items[item_key(row, '区分')].append(row)
                total_section[(block, row['row_index'])] = active
        for row in details:
            if row['row_type'] != 'DETAIL':
                continue
            result = {'source': slug, 'detail_row_index': row['row_index'], 'detail_source_page': row['source_page'], 'detail_source_line_start': row['source_line_start'], 'request': row['要求番号'], 'item': row['事項'], 'detail_printed_page': row['頁'], 'status': '', 'section_code': '', 'section_name': '', 'organization': '', 'toc_context': '', 'toc_item_entry': '', 'toc_section_entry': '', 'toc_item_physical_page': '', 'toc_section_physical_page': '', 'total_row_index': '', 'total_source_page': '', 'total_printed_page': '', 'page_evidence': ''}
            key = item_key(row, '事項')
            thits, chits = total_items.get(key, []), toc_items.get(key, [])
            if not total:
                result['status'] = 'NO_SAME_SOURCE_TOTAL'
            elif len(thits) != 1:
                result['status'] = 'NO_TOTAL_ITEM' if not thits else 'MULTIPLE_TOTAL_ITEMS'
            elif not toc:
                result['status'] = 'NO_SAME_SOURCE_TOC'
            elif len(chits) != 1:
                result['status'] = 'NO_TOC_ITEM' if not chits else 'MULTIPLE_TOC_ITEMS'
            else:
                tr, cr = thits[0], chits[0]
                parent = cr['section']
                total_parent = total_section[(tr['table_block_id'], tr['row_index'])]
                result.update(total_row_index=tr['row_index'], total_source_page=tr['source_page'], total_printed_page=tr['明細書頁数'])
                tp, cp, dp = page_number(tr['明細書頁数']), page_number(cr['row']['ページ']), page_number(row['頁'])
                if tp is None or cp != tp:
                    result['status'] = 'TOC_TOTAL_PAGE_CONFLICT'
                elif parent is None or total_parent is None:
                    result['status'] = 'SECTION_NOT_UNIQUE'
                elif parent['toc_row'] != total_parent['toc_row']:
                    result['status'] = 'PARENT_PATH_CONFLICT'
                elif dp is not None and dp != tp:
                    result['status'] = 'DETAIL_PAGE_CONFLICT'
                else:
                    m = re.match(r'^([0-9]{2,3})\s+(.+)$', parent['label'])
                    if not m:
                        result['status'] = 'INVALID_SECTION_LABEL'
                    else:
                        ip = provenance[(slug, cr['toc_row'])]
                        sp = provenance[(slug, parent['toc_row'])]
                        result.update(status='CANDIDATE_CSV_CONSISTENT', section_code=m.group(1), section_name=re.sub(r'\s+', '', m.group(2)), organization=parent['organization'], toc_context=json.dumps(parent['context'], ensure_ascii=False, sort_keys=True), toc_item_entry=ip['entry_id'], toc_section_entry=sp['entry_id'], toc_item_physical_page=ip['physical_page'], toc_section_physical_page=sp['physical_page'], page_evidence='NUMBER_MATCH_PREFIX_UNCHECKED' if dp is not None else 'DETAIL_PAGE_UNAVAILABLE')
            results.append(result)
    assert len(results) == sum(r['row_type'] == 'DETAIL' for rs in tables['detail-table'].values() for r in rs)
    assert len({(r['source'], r['detail_row_index']) for r in results}) == len(results)
    assert all(digest(Path(p)) == h for p, h in before.items()), 'Source input changed while running'
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output/'section-candidates.csv', results, list(results[0]))
    candidates = [r for r in results if r['status'] == 'CANDIDATE_CSV_CONSISTENT']
    review = []
    # Fixed illustrative cases, chosen by source and request, never by agreement with MOF.
    for prefix, request in [('mlit.go.jp__page__content__001630995', '87'), ('mlit.go.jp__page__content__001630995', '127'), ('env.go.jp__content__000157010', '41'), ('meti.go.jp__main__yosangaisan__fy2024__pdf__ippan_o', '1'), ('jinji.go.jp__content__900024096', '1'), ('env.go.jp__content__000157012', '1')]:
        hits = [r for r in candidates if r['source'] == prefix and r['request'] == request]
        if len(hits) == 1:
            r = hits[0]
            review.append({**r, 'source_pdf': source_info[r['source']]['source_pdf']})
    (output/'visual-review-cases.json').write_text(json.dumps(review, ensure_ascii=False, indent=2)+'\n')
    summary = {'scope': 'FY2024 development prototype, same-source only', 'not_accuracy_or_gt': True, 'inputs': before, 'detail_items': len(results), 'statuses': dict(sorted(collections.Counter(r['status'] for r in results).items())), 'candidate_page_evidence': dict(collections.Counter(r['page_evidence'] for r in candidates)), 'candidate_by_source': dict(sorted(collections.Counter(r['source'] for r in candidates).items())), 'visual_cases': len(review)}
    (output/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k not in ('inputs','candidate_by_source')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('tests/fixtures/budget-request-csv/2024'))
    parser.add_argument('--output', type=Path, default=Path('/private/tmp/toc-total-section-prototype-2024'))
    args = parser.parse_args()
    run(args.input, args.output)
