from __future__ import annotations

import re
from collections import defaultdict, Counter
from pathlib import Path
from typing import Any, Iterable

from .common import SCHEMA_VERSION, normalize_text, read_jsonl, stable_id, write_json, write_jsonl


def _semantic_item_key(row: dict[str, Any]) -> str:
    # Source-faithful section identity + sub-item name; excludes the 目 code because the code field changes role by document.
    return '|'.join([row.get('sectionNaturalKey', ''), normalize_text(row.get('subItemName', ''))])


def _group_amount(rows: Iterable[dict[str, Any]], field: str) -> int:
    return sum(int(r.get(field) or 0) for r in rows)


def _event_base(row: dict[str, Any], event_type: str, amount: int, *, event_id_suffix: str = '') -> dict[str, Any]:
    return {
        'schemaVersion': SCHEMA_VERSION,
        'recordType': 'budget_event',
        'eventId': stable_id(row['recordId'], event_type, event_id_suffix, prefix='evt_'),
        'sourceSystem': 'mof',
        'fiscalYear': row['fiscalYear'],
        'eventType': event_type,
        'amountYen': int(amount or 0),
        'accountType': row['accountType'],
        'ministry': row.get('ministry', ''),
        'organization': row.get('organization', ''),
        'specialAccount': row.get('specialAccount', ''),
        'subAccount': row.get('subAccount', ''),
        'agency': row.get('agency', ''),
        'sectionCode': row.get('sectionCode', ''),
        'sectionName': row.get('sectionName', ''),
        'subItemName': row.get('subItemName', ''),
        'sourceRecordIds': [row['recordId']],
        'source': row['source'],
    }


def build_mof_events(output_root: Path, fiscal_year: int) -> dict[str, Any]:
    source_path = output_root / 'normalized' / 'mof' / f'fy{fiscal_year}' / 'budget-items.jsonl'
    rows = list(read_jsonl(source_path))
    events: list[dict[str, Any]] = []

    for row in rows:
        phase = row['phase']
        if phase == 'initial':
            event = _event_base(row, 'initial_budget_state', row.get('amountYen') or 0)
            event['budgetStatus'] = row['budgetStatus']
            events.append(event)
        elif phase == 'provisional':
            event = _event_base(row, 'provisional_budget_state', row.get('amountYen') or 0)
            event['budgetStatus'] = row['budgetStatus']
            events.append(event)
        elif phase == 'supplement':
            event = _event_base(row, 'supplement_adjustment', row.get('supplementDeltaYen') or 0)
            event['revision'] = row.get('revision')
            event['baseAmountYen'] = row.get('baseAmountYen') or 0
            event['resultingAmountYen'] = row.get('revisedAmountYen') or 0
            event['budgetStatus'] = row['budgetStatus']
            events.append(event)
        elif phase == 'settlement':
            components = [
                ('settlement_budget_appropriation', 'budgetAmountYen'),
                ('carryover_in', 'carryoverInYen'),
                ('reserve_use', 'reserveUseYen'),
                ('budget_rule_increase', 'budgetRuleIncreaseYen'),
                ('reallocation', 'reallocationYen'),
                ('transfer_adjustment', 'transferAdjustmentYen'),
                ('current_budget_state', 'currentBudgetYen'),
                ('spent', 'spentYen'),
                ('carryover_out', 'carryoverOutYen'),
                ('unused', 'unusedYen'),
            ]
            for event_type, field in components:
                # Keep zero-valued state/components as explicit evidence from the settlement source.
                events.append(_event_base(row, event_type, row.get(field) or 0, event_id_suffix=field))

    # Parliamentary amendments: compare submitted vs enacted initial rows at semantic item granularity.
    submitted = defaultdict(list)
    enacted = defaultdict(list)
    for row in rows:
        if row['phase'] != 'initial':
            continue
        key = _semantic_item_key(row)
        if row['budgetStatus'] == 'submitted':
            submitted[key].append(row)
        elif row['budgetStatus'] == 'enacted':
            enacted[key].append(row)

    amendment_count = 0
    amendment_delta = 0
    submitted_account_types = {r['accountType'] for r in rows if r['phase'] == 'initial' and r['budgetStatus'] == 'submitted'}
    enacted_account_types = {r['accountType'] for r in rows if r['phase'] == 'initial' and r['budgetStatus'] == 'enacted'}
    comparable_account_types = submitted_account_types & enacted_account_types
    for key in sorted(set(submitted) | set(enacted)):
        srows = submitted.get(key, [])
        erows = enacted.get(key, [])
        template_rows = erows or srows
        if template_rows and template_rows[0]['accountType'] not in comparable_account_types:
            # Missing document family is not evidence of a parliamentary add/remove.
            continue
        if not srows and not erows:
            continue
        s_amt = _group_amount(srows, 'amountYen')
        e_amt = _group_amount(erows, 'amountYen')
        if s_amt == e_amt and srows and erows:
            continue
        template = (erows or srows)[0]
        if srows and erows:
            event_type = 'parliamentary_amendment'
        elif erows:
            event_type = 'parliamentary_amendment_added'
        else:
            event_type = 'parliamentary_amendment_removed'
        delta = e_amt - s_amt
        event = _event_base(template, event_type, delta, event_id_suffix=key)
        event['submittedAmountYen'] = s_amt
        event['enactedAmountYen'] = e_amt
        event['sourceRecordIds'] = sorted([r['recordId'] for r in srows + erows])
        event['evidenceMethod'] = 'submitted-vs-enacted-exact-semantic-key'
        events.append(event)
        amendment_count += 1
        amendment_delta += delta

    events.sort(key=lambda e: (e['fiscalYear'], e['eventType'], e['sectionName'], e['subItemName'], e['eventId']))
    out_dir = output_root / 'derived' / 'mof' / f'fy{fiscal_year}'
    write_jsonl(out_dir / 'budget-events.jsonl', events)
    summary = {
        'schemaVersion': SCHEMA_VERSION,
        'fiscalYear': fiscal_year,
        'eventCount': len(events),
        'eventTypeCounts': dict(sorted(Counter(e['eventType'] for e in events).items())),
        'parliamentaryAmendmentCount': amendment_count,
        'parliamentaryAmendmentNetDeltaYen': amendment_delta,
    }
    write_json(out_dir / 'budget-events-summary.json', summary)
    return summary


def _transition_links(source_rows: list[dict[str, Any]], target_rows: list[dict[str, Any]], source_label: str, target_label: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    source_exact = defaultdict(list)
    target_exact = defaultdict(list)
    source_name = defaultdict(list)
    target_name = defaultdict(list)
    for row in source_rows:
        source_exact[_semantic_item_key(row)].append(row)
        source_name[row['scopeNameItemKey']].append(row)
    for row in target_rows:
        target_exact[_semantic_item_key(row)].append(row)
        target_name[row['scopeNameItemKey']].append(row)

    links: list[dict[str, Any]] = []
    matched_source: set[str] = set()
    matched_target: set[str] = set()

    for key in sorted(set(source_exact) & set(target_exact)):
        srows = source_exact[key]
        trows = target_exact[key]
        links.append({
            'schemaVersion': SCHEMA_VERSION,
            'recordType': 'budget_item_relation',
            'relationId': stable_id(source_label, target_label, 'exact', key, prefix='rel_'),
            'sourceStage': source_label,
            'targetStage': target_label,
            'relationType': 'same_item',
            'evidenceMethod': 'exact-key',
            'sourceRecordIds': sorted(r['recordId'] for r in srows),
            'targetRecordIds': sorted(r['recordId'] for r in trows),
        })
        matched_source.update(r['recordId'] for r in srows)
        matched_target.update(r['recordId'] for r in trows)

    # Only use same-scope/name fallback if both sides are unambiguous after exact matches.
    for key in sorted(set(source_name) & set(target_name)):
        srows = [r for r in source_name[key] if r['recordId'] not in matched_source]
        trows = [r for r in target_name[key] if r['recordId'] not in matched_target]
        if not srows or not trows:
            continue
        source_sections = {r['sectionNaturalKey'] for r in srows}
        target_sections = {r['sectionNaturalKey'] for r in trows}
        if len(source_sections) != 1 or len(target_sections) != 1:
            continue
        links.append({
            'schemaVersion': SCHEMA_VERSION,
            'recordType': 'budget_item_relation',
            'relationId': stable_id(source_label, target_label, 'scope-name', key, prefix='rel_'),
            'sourceStage': source_label,
            'targetStage': target_label,
            'relationType': 'code_changed',
            'evidenceMethod': 'same-scope-same-name',
            'sourceRecordIds': sorted(r['recordId'] for r in srows),
            'targetRecordIds': sorted(r['recordId'] for r in trows),
        })
        matched_source.update(r['recordId'] for r in srows)
        matched_target.update(r['recordId'] for r in trows)

    stats = {
        'sourceRecords': len(source_rows),
        'targetRecords': len(target_rows),
        'linkedSourceRecords': len(matched_source),
        'linkedTargetRecords': len(matched_target),
        'unlinkedSourceRecords': len(source_rows) - len(matched_source),
        'unlinkedTargetRecords': len(target_rows) - len(matched_target),
        'relationCount': len(links),
    }
    return links, stats


def build_mof_identity(output_root: Path, fiscal_year: int) -> dict[str, Any]:
    rows = list(read_jsonl(output_root / 'normalized' / 'mof' / f'fy{fiscal_year}' / 'budget-items.jsonl'))
    initial_submitted = [r for r in rows if r['phase'] == 'initial' and r['budgetStatus'] == 'submitted']
    initial_enacted = [r for r in rows if r['phase'] == 'initial' and r['budgetStatus'] == 'enacted']
    supplement_by_revision: dict[int, list[dict[str, Any]]] = defaultdict(list)
    settlement = [r for r in rows if r['phase'] == 'settlement']
    for r in rows:
        if r['phase'] == 'supplement':
            supplement_by_revision[int(r.get('revision') or 0)].append(r)

    all_links: list[dict[str, Any]] = []
    stages: dict[str, Any] = {}
    if initial_submitted and initial_enacted:
        links, stats = _transition_links(initial_submitted, initial_enacted, 'initial_submitted', 'initial_enacted')
        all_links.extend(links); stages['initial_submitted->initial_enacted'] = stats
    previous = initial_enacted
    previous_label = 'initial_enacted'
    for revision in sorted(supplement_by_revision):
        current = supplement_by_revision[revision]
        if previous and current:
            label = f'supplement_{revision}'
            links, stats = _transition_links(previous, current, previous_label, label)
            all_links.extend(links); stages[f'{previous_label}->{label}'] = stats
            previous, previous_label = current, label
    if settlement:
        source = previous if previous else initial_enacted
        source_label = previous_label if previous else 'initial_enacted'
        if source:
            links, stats = _transition_links(source, settlement, source_label, 'settlement')
            all_links.extend(links); stages[f'{source_label}->settlement'] = stats

    all_links.sort(key=lambda r: (r['sourceStage'], r['targetStage'], r['relationType'], r['relationId']))
    out_dir = output_root / 'derived' / 'mof' / f'fy{fiscal_year}'
    write_jsonl(out_dir / 'identity-relations.jsonl', all_links)
    summary = {'schemaVersion': SCHEMA_VERSION, 'fiscalYear': fiscal_year, 'relationCount': len(all_links), 'transitions': stages}
    write_json(out_dir / 'identity-summary.json', summary)
    return summary


def _rs_budget_event_type(budget_type: str) -> str:
    if budget_type == '当初予算':
        return 'initial_budget'
    if re.fullmatch(r'第\d+次補正予算', budget_type or ''):
        return 'supplementary_budget'
    if budget_type == '前年度から繰越し':
        return 'carryover_in'
    if (budget_type or '').startswith('予備費等'):
        return 'reserve_or_other'
    if not budget_type:
        return 'unclassified_budget'
    return 'other_budget'


def build_rs_events(output_root: Path, review_year: int) -> dict[str, Any]:
    base = output_root / 'normalized' / 'rs' / f'review-{review_year}'
    item_rows = list(read_jsonl(base / 'budget-items.jsonl'))
    summary_rows = list(read_jsonl(base / 'budget-summary.jsonl'))
    events: list[dict[str, Any]] = []

    for r in item_rows:
        if r.get('budgetAmountYen') is not None:
            events.append({
                'schemaVersion': SCHEMA_VERSION,
                'recordType': 'budget_event',
                'eventId': stable_id(r['recordId'], 'budget', prefix='rsevt_'),
                'sourceSystem': 'rs',
                'reviewYear': review_year,
                'fiscalYear': r['fiscalYear'],
                'eventType': _rs_budget_event_type(r.get('budgetType', '')),
                'sourceBudgetType': r.get('budgetType', ''),
                'amountYen': r['budgetAmountYen'],
                'projectId': r['projectId'],
                'projectName': r['projectName'],
                'accountType': r['accountType'],
                'ministry': r['ministry'],
                'account': r['account'],
                'subAccount': r['subAccount'],
                'organizationOrAccount': r['organizationOrAccount'],
                'sectionName': r['sectionName'],
                'subItemName': r['subItemName'],
                'sourceRecordIds': [r['recordId']],
                'source': r['source'],
            })
        if r.get('nextYearRequestYen') is not None:
            events.append({
                'schemaVersion': SCHEMA_VERSION,
                'recordType': 'budget_event',
                'eventId': stable_id(r['recordId'], 'next-request', prefix='rsevt_'),
                'sourceSystem': 'rs',
                'reviewYear': review_year,
                'fiscalYear': r['requestFiscalYear'],
                'sourceFiscalYear': r['fiscalYear'],
                'eventType': 'next_year_request',
                'amountYen': r['nextYearRequestYen'],
                'projectId': r['projectId'],
                'projectName': r['projectName'],
                'accountType': r['accountType'],
                'ministry': r['ministry'],
                'account': r['account'],
                'subAccount': r['subAccount'],
                'organizationOrAccount': r['organizationOrAccount'],
                'sectionName': r['sectionName'],
                'subItemName': r['subItemName'],
                'sourceRecordIds': [r['recordId']],
                'source': r['source'],
            })

    # Execution/carryover are available at project/account summary granularity, not at MOF 目 granularity.
    for r in summary_rows:
        if r.get('scopeLevel') != 'account':
            continue
        for field, event_type in [
            ('accountExecutionYen', 'execution'),
            ('accountCarryoverInYen', 'carryover_in_project_account'),
            ('accountNextYearRequestYen', 'next_year_request_project_account'),
        ]:
            value = r.get(field)
            if value is None:
                continue
            fiscal_year = r['requestFiscalYear'] if event_type.startswith('next_year_request') else r['fiscalYear']
            events.append({
                'schemaVersion': SCHEMA_VERSION,
                'recordType': 'budget_event',
                'eventId': stable_id(r['recordId'], event_type, prefix='rsevt_'),
                'sourceSystem': 'rs',
                'reviewYear': review_year,
                'fiscalYear': fiscal_year,
                'sourceFiscalYear': r['fiscalYear'],
                'eventType': event_type,
                'amountYen': value,
                'projectId': r['projectId'],
                'projectName': r['projectName'],
                'accountType': r['accountType'],
                'account': r['account'],
                'subAccount': r['subAccount'],
                'sourceRecordIds': [r['recordId']],
                'source': r['source'],
            })

    events.sort(key=lambda e: (str(e.get('fiscalYear')), e['eventType'], e.get('projectId', ''), e['eventId']))
    out_dir = output_root / 'derived' / 'rs' / f'review-{review_year}'
    write_jsonl(out_dir / 'budget-events.jsonl', events)
    summary = {
        'schemaVersion': SCHEMA_VERSION,
        'reviewYear': review_year,
        'eventCount': len(events),
        'eventTypeCounts': dict(sorted(Counter(e['eventType'] for e in events).items())),
        'fiscalYears': sorted({e['fiscalYear'] for e in events if e.get('fiscalYear') is not None}),
    }
    write_json(out_dir / 'budget-events-summary.json', summary)
    return summary


def _mof_rs_key_from_mof(r: dict[str, Any]) -> str | None:
    if not r.get('sectionName') or not r.get('subItemName'):
        return None
    if r['accountType'] == 'general':
        parts = ['general', r.get('ministry',''), r.get('organization',''), r['sectionName'], r['subItemName']]
    elif r['accountType'] == 'special':
        parts = ['special', r.get('ministry',''), r.get('specialAccount',''), r.get('subAccount',''), r['sectionName'], r['subItemName']]
    else:
        return None
    return '|'.join(normalize_text(x) for x in parts)


def _mof_rs_key_from_rs(r: dict[str, Any]) -> str | None:
    if not r.get('sectionName') or not r.get('subItemName') or not r.get('ministry'):
        return None
    if r['accountType'] == 'general':
        parts = ['general', r.get('ministry',''), r.get('organizationOrAccount',''), r['sectionName'], r['subItemName']]
    elif r['accountType'] == 'special':
        parts = ['special', r.get('ministry',''), r.get('account',''), r.get('subAccount',''), r['sectionName'], r['subItemName']]
    else:
        return None
    return '|'.join(normalize_text(x) for x in parts)


def _rs_phase(r: dict[str, Any]) -> tuple[str, int | None] | None:
    bt = r.get('budgetType', '')
    if bt == '当初予算':
        return ('initial', None)
    m = re.fullmatch(r'第(\d+)次補正予算', bt)
    if m:
        return ('supplement', int(m.group(1)))
    return None


def build_mof_rs_links(output_root: Path, review_year: int, fiscal_year: int) -> dict[str, Any]:
    mof_path = output_root / 'normalized' / 'mof' / f'fy{fiscal_year}' / 'budget-items.jsonl'
    rs_path = output_root / 'normalized' / 'rs' / f'review-{review_year}' / 'budget-items.jsonl'
    if not mof_path.exists() or not rs_path.exists():
        return {'reviewYear': review_year, 'fiscalYear': fiscal_year, 'skipped': True}
    mof_rows = list(read_jsonl(mof_path))
    rs_rows = [r for r in read_jsonl(rs_path) if r.get('fiscalYear') == fiscal_year]

    mof_maps: dict[tuple[str, int | None], dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for m in mof_rows:
        if m['phase'] == 'initial' and m['budgetStatus'] == 'enacted':
            stage = ('initial', None)
            amount_field = 'amountYen'
        elif m['phase'] == 'supplement':
            stage = ('supplement', int(m.get('revision') or 0))
            amount_field = 'supplementDeltaYen'
        else:
            continue
        key = _mof_rs_key_from_mof(m)
        if key:
            mc = dict(m)
            mc['_linkAmountYen'] = int(m.get(amount_field) or 0)
            mof_maps[stage][key].append(mc)

    grouped_rs: dict[tuple[tuple[str, int | None], str], list[dict[str, Any]]] = defaultdict(list)
    unlinked = 0
    unsupported = 0
    for r in rs_rows:
        stage = _rs_phase(r)
        if not stage:
            unsupported += 1
            continue
        key = _mof_rs_key_from_rs(r)
        if not key:
            unlinked += 1
            continue
        grouped_rs[(stage, key)].append(r)

    links: list[dict[str, Any]] = []
    linked_rs_records = 0
    for (stage, key), rrows in sorted(grouped_rs.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        mrows = mof_maps.get(stage, {}).get(key, [])
        if not mrows:
            unlinked += len(rrows)
            continue
        linked_rs_records += len(rrows)
        rs_amount = sum(int(r.get('budgetAmountYen') or 0) for r in rrows)
        mof_amount = sum(int(m.get('_linkAmountYen') or 0) for m in mrows)
        links.append({
            'schemaVersion': SCHEMA_VERSION,
            'recordType': 'mof_rs_project_link_group',
            'linkId': stable_id(review_year, fiscal_year, stage, key, prefix='mofrs_'),
            'reviewYear': review_year,
            'fiscalYear': fiscal_year,
            'phase': stage[0],
            'revision': stage[1],
            'matchMethod': 'exact-name-key',
            'naturalKey': key,
            'mofRecordIds': sorted(m['recordId'] for m in mrows),
            'rsRecordIds': sorted(r['recordId'] for r in rrows),
            'projectIds': sorted({r['projectId'] for r in rrows}),
            'mofAmountYen': mof_amount,
            'rsAmountYen': rs_amount,
            'differenceYen': mof_amount - rs_amount,
        })

    out_dir = output_root / 'derived' / 'links'
    write_jsonl(out_dir / f'mof-rs-review-{review_year}-fy{fiscal_year}.jsonl', links)
    summary = {
        'schemaVersion': SCHEMA_VERSION,
        'reviewYear': review_year,
        'fiscalYear': fiscal_year,
        'linkGroupCount': len(links),
        'linkedRsRecordCount': linked_rs_records,
        'unlinkedRsRecordCount': unlinked,
        'unsupportedBudgetTypeRecordCount': unsupported,
        'linkedProjectCount': len({pid for link in links for pid in link['projectIds']}),
        'mofAmountAcrossGroupsYen': sum(l['mofAmountYen'] for l in links),
        'rsAmountAcrossGroupsYen': sum(l['rsAmountYen'] for l in links),
    }
    write_json(out_dir / f'mof-rs-review-{review_year}-fy{fiscal_year}-summary.json', summary)
    return summary


def derive_all(output_root: Path, fiscal_years: list[int], review_years: list[int]) -> dict[str, Any]:
    summary: dict[str, Any] = {'schemaVersion': SCHEMA_VERSION, 'mof': {}, 'rs': {}, 'links': {}}
    for fy in fiscal_years:
        if (output_root / 'normalized' / 'mof' / f'fy{fy}' / 'budget-items.jsonl').exists():
            summary['mof'][str(fy)] = {
                'events': build_mof_events(output_root, fy),
                'identity': build_mof_identity(output_root, fy),
            }
    for ry in review_years:
        if (output_root / 'normalized' / 'rs' / f'review-{ry}' / 'budget-items.jsonl').exists():
            summary['rs'][str(ry)] = build_rs_events(output_root, ry)
            for fy in fiscal_years:
                if fy <= ry:  # useful comparisons include current and prior fiscal years in a review snapshot
                    link_summary = build_mof_rs_links(output_root, ry, fy)
                    if not link_summary.get('skipped'):
                        summary['links'][f'{ry}:{fy}'] = link_summary
    write_json(output_root / 'derived' / 'manifest.json', summary)
    return summary
