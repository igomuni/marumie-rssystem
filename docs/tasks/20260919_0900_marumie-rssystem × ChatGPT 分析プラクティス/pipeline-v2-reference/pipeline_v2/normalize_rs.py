from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
import unicodedata
import zipfile
import csv
import io

from .common import (
    SCHEMA_VERSION,
    normalize_text,
    parse_int,
    relpath,
    source_ref,
    stable_id,
    write_json,
    write_jsonl,
)


def _read_single_csv(zip_path: Path) -> tuple[str, list[dict[str, str]]]:
    with zipfile.ZipFile(zip_path) as zf:
        names = sorted(n for n in zf.namelist() if n.lower().endswith('.csv'))
        if not names:
            raise ValueError(f"CSV not found in {zip_path}")
        name = names[0]
        text = zf.read(name).decode('utf-8-sig')
        return name, list(csv.DictReader(io.StringIO(text)))


def discover_rs_years(raw_root: Path, years: set[int] | None = None) -> list[int]:
    base = raw_root / 'rssystem.go.jp' / 'download-csv'
    out = []
    if not base.exists():
        return out
    for p in sorted(base.iterdir()):
        if p.is_dir() and p.name.isdigit():
            y = int(p.name)
            if not years or y in years:
                out.append(y)
    return out


def _find_zip(year_dir: Path, prefix: str) -> Path | None:
    candidates = sorted(p for p in year_dir.glob('*.zip') if unicodedata.normalize('NFC', p.name).startswith(prefix))
    return candidates[0] if candidates else None


def _account_type(value: str) -> str:
    v = normalize_text(value)
    if v == normalize_text('一般会計'):
        return 'general'
    if v == normalize_text('特別会計'):
        return 'special'
    if v:
        return 'other'
    return ''


def normalize_projects(raw_root: Path, zip_path: Path, review_year: int) -> list[dict[str, Any]]:
    entry, rows = _read_single_csv(zip_path)
    out = []
    for row_number, row in enumerate(rows, start=2):
        project_id = (row.get('予算事業ID') or '').strip()
        out.append({
            'schemaVersion': SCHEMA_VERSION,
            'recordType': 'rs_project_org_row',
            'recordId': stable_id(relpath(zip_path, raw_root), entry, row_number, prefix='rsprojrow_'),
            'reviewYear': review_year,
            'sheetType': row.get('シート種別', ''),
            'projectId': project_id,
            'projectName': row.get('事業名', ''),
            'policyMinistry': row.get('所管府省庁', ''),
            'ministry': row.get('府省庁', ''),
            'bureau': row.get('局・庁', ''),
            'department': row.get('部', ''),
            'division': row.get('課', ''),
            'office': row.get('室', ''),
            'team': row.get('班', ''),
            'unit': row.get('係', ''),
            'responsiblePerson': row.get('作成責任者', ''),
            'source': source_ref(raw_root, zip_path, entry, row_number),
        })
    return out


def normalize_budget_summary(raw_root: Path, zip_path: Path, review_year: int) -> list[dict[str, Any]]:
    entry, rows = _read_single_csv(zip_path)
    out = []
    amount_fields = {
        'initialBudgetYen': '当初予算（合計）',
        'supplementBudgetYen': '補正予算（合計）',
        'carryoverInYen': '前年度からの繰越し（合計）',
        'reserveAndOtherYen': '予備費等（合計）',
        'currentBudgetYen': '計（歳出予算現額合計）',
        'executionYen': '執行額（合計）',
        'carryoverOutYen': '翌年度への繰越し(合計）',
        'nextYearRequestYen': '翌年度要求額（合計）',
        'accountInitialBudgetYen': '当初予算',
        'accountCarryoverInYen': '前年度から繰越し',
        'accountCurrentBudgetYen': '歳出予算現額',
        'accountExecutionYen': '執行額',
        'accountNextYearRequestYen': '翌年度要求額',
        'requestAddOnYen': '要望額',
    }
    supplement_detail = [f'第{i}次補正予算' for i in range(1, 6)]
    reserve_detail = [f'予備費等{i}' for i in range(1, 5)]
    for row_number, row in enumerate(rows, start=2):
        fiscal_year = parse_int(row.get('予算年度'), none_if_blank=True)
        account_class = (row.get('会計区分') or '').strip()
        scope_level = 'account' if account_class else 'project_total'
        rec: dict[str, Any] = {
            'schemaVersion': SCHEMA_VERSION,
            'recordType': 'rs_budget_summary',
            'recordId': stable_id(relpath(zip_path, raw_root), entry, row_number, prefix='rssum_'),
            'reviewYear': review_year,
            'fiscalYear': fiscal_year,
            'projectId': (row.get('予算事業ID') or '').strip(),
            'projectName': row.get('事業名', ''),
            'policyMinistry': row.get('政策所管府省庁', ''),
            'ministry': row.get('府省庁', ''),
            'bureau': row.get('局・庁', ''),
            'scopeLevel': scope_level,
            'accountType': _account_type(account_class),
            'accountClass': account_class,
            'account': row.get('会計', ''),
            'subAccount': row.get('勘定', ''),
            'source': source_ref(raw_root, zip_path, entry, row_number),
        }
        for out_field, src_field in amount_fields.items():
            rec[out_field] = parse_int(row.get(src_field), none_if_blank=True)
        rec['supplementDetailYen'] = {
            f'supplement{i}': parse_int(row.get(col), none_if_blank=True)
            for i, col in enumerate(supplement_detail, start=1)
        }
        rec['reserveDetailYen'] = {
            f'reserve{i}': parse_int(row.get(col), none_if_blank=True)
            for i, col in enumerate(reserve_detail, start=1)
        }
        req = rec['nextYearRequestYen'] if scope_level == 'project_total' else rec['accountNextYearRequestYen']
        rec['requestFiscalYear'] = fiscal_year + 1 if fiscal_year is not None and req is not None else None
        out.append(rec)
    return out


def normalize_budget_items(raw_root: Path, zip_path: Path, review_year: int) -> list[dict[str, Any]]:
    entry, rows = _read_single_csv(zip_path)
    out = []
    for row_number, row in enumerate(rows, start=2):
        fiscal_year = parse_int(row.get('予算年度'), none_if_blank=True)
        next_request = parse_int(row.get('翌年度要求額（歳出予算項目ごと）'), none_if_blank=True)
        account_class = (row.get('会計区分') or '').strip()
        account_type = _account_type(account_class)
        ministry = row.get('所管', '')
        organization_or_account = row.get('組織・勘定', '')
        section = row.get('項', '')
        sub_item = row.get('目', '')
        natural_key = '|'.join(normalize_text(x) for x in [account_type, ministry, organization_or_account, section, sub_item])
        out.append({
            'schemaVersion': SCHEMA_VERSION,
            'recordType': 'rs_budget_item',
            'recordId': stable_id(relpath(zip_path, raw_root), entry, row_number, prefix='rsitem_'),
            'reviewYear': review_year,
            'sheetType': row.get('シート種別', ''),
            'fiscalYear': fiscal_year,
            'projectId': (row.get('予算事業ID') or '').strip(),
            'projectName': row.get('事業名', ''),
            'policyMinistry': row.get('政策所管府省庁', ''),
            'ministry': ministry,
            'accountType': account_type,
            'accountClass': account_class,
            'account': row.get('会計', ''),
            'subAccount': row.get('勘定', ''),
            'budgetType': row.get('予算種別', ''),
            'organizationOrAccount': organization_or_account,
            'sectionName': section,
            'subItemName': sub_item,
            'supplementalInfo': row.get('歳出予算項目の補足情報', ''),
            'budgetAmountYen': parse_int(row.get('予算額（歳出予算項目ごと）'), none_if_blank=True),
            'nextYearRequestYen': next_request,
            'requestFiscalYear': fiscal_year + 1 if fiscal_year is not None and next_request is not None else None,
            'note': row.get('備考（歳出予算項目ごと）', ''),
            'mofNameNaturalKey': natural_key,
            'source': source_ref(raw_root, zip_path, entry, row_number),
        })
    return out


def normalize_rs(raw_root: Path, output_root: Path, years: set[int] | None = None) -> dict[str, Any]:
    all_manifest: dict[str, Any] = {'schemaVersion': SCHEMA_VERSION, 'reviewYears': {}}
    for review_year in discover_rs_years(raw_root, years):
        year_dir = raw_root / 'rssystem.go.jp' / 'download-csv' / str(review_year)
        normalized_dir = output_root / 'normalized' / 'rs' / f'review-{review_year}'
        sources: dict[str, Any] = {}

        p1 = _find_zip(year_dir, f'1-1_RS_{review_year}_')
        p21 = _find_zip(year_dir, f'2-1_RS_{review_year}_')
        p22 = _find_zip(year_dir, f'2-2_RS_{review_year}_')

        project_rows = normalize_projects(raw_root, p1, review_year) if p1 else []
        summary_rows = normalize_budget_summary(raw_root, p21, review_year) if p21 else []
        item_rows = normalize_budget_items(raw_root, p22, review_year) if p22 else []

        write_jsonl(normalized_dir / 'projects.jsonl', project_rows)
        write_jsonl(normalized_dir / 'budget-summary.jsonl', summary_rows)
        write_jsonl(normalized_dir / 'budget-items.jsonl', item_rows)

        for label, path, rows in [('projects', p1, project_rows), ('budgetSummary', p21, summary_rows), ('budgetItems', p22, item_rows)]:
            sources[label] = {
                'path': relpath(path, raw_root) if path else None,
                'rowCount': len(rows),
            }

        fiscal_year_counts = Counter(r['fiscalYear'] for r in item_rows)
        budget_type_counts = Counter(r['budgetType'] for r in item_rows)
        manifest = {
            'schemaVersion': SCHEMA_VERSION,
            'reviewYear': review_year,
            'sources': sources,
            'budgetItemFiscalYearCounts': {str(k): v for k, v in sorted(fiscal_year_counts.items(), key=lambda kv: str(kv[0]))},
            'budgetTypeCounts': dict(sorted(budget_type_counts.items())),
        }
        write_json(normalized_dir / 'manifest.json', manifest)
        all_manifest['reviewYears'][str(review_year)] = manifest

    write_json(output_root / 'normalized' / 'rs' / 'manifest.json', all_manifest)
    return all_manifest
