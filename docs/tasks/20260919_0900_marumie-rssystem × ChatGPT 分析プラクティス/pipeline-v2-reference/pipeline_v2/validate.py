from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .common import read_jsonl, sha256_file, write_json


def build_inventory(raw_root: Path) -> list[dict[str, Any]]:
    items = []
    for path in sorted(p for p in raw_root.rglob('*') if p.is_file()):
        items.append({
            'path': path.resolve().relative_to(raw_root.resolve()).as_posix(),
            'sizeBytes': path.stat().st_size,
            'sha256': sha256_file(path),
        })
    return items


def _mof_section_counts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        key = (r['phase'], r['budgetStatus'], r.get('revision'), r['accountType'])
        groups[key].append(r)
    out = []
    for (phase, status, revision, account_type), group in sorted(groups.items(), key=lambda kv: str(kv[0])):
        out.append({
            'phase': phase,
            'budgetStatus': status,
            'revision': revision,
            'accountType': account_type,
            'rowCount': len(group),
            'sourcePreservingSectionCount': len({r['sectionNaturalKey'] for r in group}),
            'legacyCodeCentricSectionCount': len({r['legacySectionKey'] for r in group}),
        })
    return out


def _section_code_collisions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Only collisions where one legacy key maps to multiple source-preserving section names.
    by = defaultdict(lambda: defaultdict(set))
    sample = defaultdict(dict)
    for r in rows:
        group = (r['phase'], r['budgetStatus'], r.get('revision'), r['accountType'])
        by[group][r['legacySectionKey']].add(r['sectionNaturalKey'])
        sample[(group, r['legacySectionKey'])][r['sectionNaturalKey']] = {
            'sectionCode': r['sectionCode'],
            'sectionName': r['sectionName'],
            'ministry': r.get('ministry',''),
            'specialAccount': r.get('specialAccount',''),
            'subAccount': r.get('subAccount',''),
            'agency': r.get('agency',''),
        }
    out = []
    for group, keys in by.items():
        for legacy_key, natural_keys in keys.items():
            if len(natural_keys) <= 1:
                continue
            out.append({
                'phase': group[0],
                'budgetStatus': group[1],
                'revision': group[2],
                'accountType': group[3],
                'legacySectionKey': legacy_key,
                'variants': [sample[(group, legacy_key)][k] for k in sorted(natural_keys)],
            })
    return sorted(out, key=lambda x: (x['phase'], str(x['revision']), x['legacySectionKey']))


def _settlement_equations(rows: list[dict[str, Any]]) -> dict[str, Any]:
    checked = 0
    left_mismatches = []
    right_mismatches = []
    for r in rows:
        if r['phase'] != 'settlement':
            continue
        checked += 1
        lhs = (
            int(r.get('budgetAmountYen') or 0)
            + int(r.get('carryoverInYen') or 0)
            + int(r.get('reserveUseYen') or 0)
            + int(r.get('budgetRuleIncreaseYen') or 0)
            + int(r.get('reallocationYen') or 0)
            + int(r.get('transferAdjustmentYen') or 0)
        )
        current = int(r.get('currentBudgetYen') or 0)
        rhs = int(r.get('spentYen') or 0) + int(r.get('carryoverOutYen') or 0) + int(r.get('unusedYen') or 0)
        if lhs != current and len(left_mismatches) < 20:
            left_mismatches.append({'recordId': r['recordId'], 'lhs': lhs, 'current': current, 'difference': lhs-current})
        if rhs != current and len(right_mismatches) < 20:
            right_mismatches.append({'recordId': r['recordId'], 'rhs': rhs, 'current': current, 'difference': rhs-current})
    return {
        'checkedRows': checked,
        'leftEquationMismatchCount': 0 if not left_mismatches else len(left_mismatches),
        'rightEquationMismatchCount': 0 if not right_mismatches else len(right_mismatches),
        'leftEquationMismatchSamples': left_mismatches,
        'rightEquationMismatchSamples': right_mismatches,
        'note': 'Mismatch counts are exact when zero; samples are capped at 20 when non-zero.',
    }


def _exact_settlement_equations(rows: list[dict[str, Any]]) -> dict[str, Any]:
    checked = 0
    left_count = 0
    right_count = 0
    max_left = 0
    max_right = 0
    for r in rows:
        if r['phase'] != 'settlement':
            continue
        checked += 1
        lhs = sum(int(r.get(f) or 0) for f in ['budgetAmountYen','carryoverInYen','reserveUseYen','budgetRuleIncreaseYen','reallocationYen','transferAdjustmentYen'])
        cur = int(r.get('currentBudgetYen') or 0)
        rhs = sum(int(r.get(f) or 0) for f in ['spentYen','carryoverOutYen','unusedYen'])
        if lhs != cur:
            left_count += 1
            max_left = max(max_left, abs(lhs-cur))
        if rhs != cur:
            right_count += 1
            max_right = max(max_right, abs(rhs-cur))
    return {
        'checkedRows': checked,
        'leftEquationMismatchCount': left_count,
        'rightEquationMismatchCount': right_count,
        'maxLeftDifferenceYen': max_left,
        'maxRightDifferenceYen': max_right,
    }


def _amendment_summary(output_root: Path, fiscal_year: int) -> dict[str, Any] | None:
    p = output_root / 'derived' / 'mof' / f'fy{fiscal_year}' / 'budget-events.jsonl'
    if not p.exists():
        return None
    events = [e for e in read_jsonl(p) if e['eventType'].startswith('parliamentary_amendment')]
    by_type = Counter()
    by_account = Counter()
    net = 0
    for e in events:
        by_type[e['eventType']] += 1
        by_account[e['accountType']] += 1
        net += int(e['amountYen'])
    return {
        'count': len(events),
        'netDeltaYen': net,
        'byType': dict(sorted(by_type.items())),
        'byAccountType': dict(sorted(by_account.items())),
    }


def _rs_summary(output_root: Path, review_year: int) -> dict[str, Any] | None:
    p = output_root / 'normalized' / 'rs' / f'review-{review_year}' / 'budget-items.jsonl'
    if not p.exists():
        return None
    rows = list(read_jsonl(p))
    fy = Counter(r['fiscalYear'] for r in rows)
    bt = Counter(r['budgetType'] for r in rows)
    req = Counter(r['requestFiscalYear'] for r in rows if r.get('nextYearRequestYen') is not None)
    return {
        'rowCount': len(rows),
        'fiscalYearCounts': {str(k): v for k,v in sorted(fy.items(), key=lambda kv: str(kv[0]))},
        'budgetTypeCounts': dict(sorted(bt.items())),
        'requestFiscalYearCounts': {str(k): v for k,v in sorted(req.items(), key=lambda kv: str(kv[0]))},
        'containsFiscalYearDifferentFromReviewYear': any(r.get('fiscalYear') != review_year for r in rows),
        'containsNextYearRequestBeyondReviewYear': any((r.get('requestFiscalYear') or 0) > review_year for r in rows),
    }


def validate_all(raw_root: Path, output_root: Path, fiscal_years: list[int], review_years: list[int]) -> dict[str, Any]:
    inventory = build_inventory(raw_root)
    write_json(output_root / 'source-manifest.json', {'files': inventory, 'fileCount': len(inventory)})

    report: dict[str, Any] = {
        'sourceInventory': {
            'fileCount': len(inventory),
            'totalBytes': sum(i['sizeBytes'] for i in inventory),
            'mofFileCount': sum(i['path'].startswith('mof.go.jp/') for i in inventory),
            'rsFileCount': sum(i['path'].startswith('rssystem.go.jp/') for i in inventory),
            'settlementExplanationPdfPresent': any(i['path'] == 'mof.go.jp/account/fy2024/kessan_06_zenntaibann.pdf' for i in inventory),
        },
        'mof': {},
        'rs': {},
        'links': {},
    }

    for fy in fiscal_years:
        p = output_root / 'normalized' / 'mof' / f'fy{fy}' / 'budget-items.jsonl'
        if not p.exists():
            continue
        rows = list(read_jsonl(p))
        report['mof'][str(fy)] = {
            'rowCount': len(rows),
            'sectionCounts': _mof_section_counts(rows),
            'sectionCodeCollisions': _section_code_collisions(rows),
            'settlementEquations': _exact_settlement_equations(rows),
            'parliamentaryAmendments': _amendment_summary(output_root, fy),
        }

    for ry in review_years:
        s = _rs_summary(output_root, ry)
        if s:
            report['rs'][str(ry)] = s
        for fy in fiscal_years:
            p = output_root / 'derived' / 'links' / f'mof-rs-review-{ry}-fy{fy}-summary.json'
            if p.exists():
                import json
                report['links'][f'{ry}:{fy}'] = json.loads(p.read_text(encoding='utf-8'))

    write_json(output_root / 'validation' / 'report.json', report)
    _write_markdown(output_root / 'validation' / 'report.md', report)
    return report


def _write_markdown(path: Path, report: dict[str, Any]) -> None:
    lines = ['# Pipeline V2 reference validation report', '']
    inv = report['sourceInventory']
    lines += [
        '## Source inventory', '',
        f"- files: {inv['fileCount']}",
        f"- bytes: {inv['totalBytes']:,}",
        f"- MOF files: {inv['mofFileCount']}",
        f"- RS files: {inv['rsFileCount']}",
        f"- FY2024 settlement explanation PDF present: {inv['settlementExplanationPdfPresent']}",
        '',
    ]
    for fy, m in report['mof'].items():
        lines += [f'## MOF FY{fy}', '', f"Normalized rows: {m['rowCount']:,}", '', '### Section counts', '', '| phase | status | rev | account | source-preserving | legacy code-centric |', '|---|---|---:|---|---:|---:|']
        for s in m['sectionCounts']:
            lines.append(f"| {s['phase']} | {s['budgetStatus']} | {s['revision'] if s['revision'] is not None else ''} | {s['accountType']} | {s['sourcePreservingSectionCount']} | {s['legacyCodeCentricSectionCount']} |")
        eq = m['settlementEquations']
        lines += ['', '### Settlement equations', '', f"- checked rows: {eq['checkedRows']:,}", f"- budget-components → current-budget mismatches: {eq['leftEquationMismatchCount']}", f"- current-budget → spent+carryover+unused mismatches: {eq['rightEquationMismatchCount']}", '']
        if m['sectionCodeCollisions']:
            lines += ['### Code collisions preserved by V2', '']
            for c in m['sectionCodeCollisions']:
                names = ', '.join(v['sectionName'] for v in c['variants'])
                lines.append(f"- {c['phase']} / {c['accountType']} / `{c['legacySectionKey']}` → {names}")
            lines.append('')
        a = m.get('parliamentaryAmendments')
        if a:
            lines += ['### Submitted → enacted amendments', '', f"- changed item groups: {a['count']}", f"- net delta: {a['netDeltaYen']:,} yen", f"- by account: {a['byAccountType']}", '']
    for ry, r in report['rs'].items():
        lines += [f'## RS review {ry}', '', f"- budget-item rows: {r['rowCount']:,}", f"- fiscal years: {r['fiscalYearCounts']}", f"- request fiscal years: {r['requestFiscalYearCounts']}", f"- reviewYear != fiscalYear exists: {r['containsFiscalYearDifferentFromReviewYear']}", f"- next-year request beyond reviewYear exists: {r['containsNextYearRequestBeyondReviewYear']}", '']
    if report['links']:
        lines += ['## MOF ↔ RS exact-name linkage reference', '']
        for k, l in sorted(report['links'].items()):
            lines.append(f"- {k}: groups={l.get('linkGroupCount')}, linked RS rows={l.get('linkedRsRecordCount')}, linked projects={l.get('linkedProjectCount')}, unlinked RS rows={l.get('unlinkedRsRecordCount')}")
        lines.append('')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
