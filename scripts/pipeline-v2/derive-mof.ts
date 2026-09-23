/**
 * normalized/mof/fy{year}/budget-items.jsonl（source-preserving行）から、
 * MOFの金額イベント（budget-events.jsonl）と段階間の項目同一性関係（identity-relations.jsonl）を作る。
 *
 * 仕様: 20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md
 * 参照実装: Python版 pipeline_v2/derive.py の build_mof_events/build_mof_identity/
 * _transition_links と同じロジック（イベント種別・同一性判定の優先順位を含む）。
 *
 * 入力: data/normalized/mof/fy{year}/budget-items.jsonl
 * 出力: data/derived/mof/fy{year}/{budget-events.jsonl,budget-events-summary.json,
 *                                   identity-relations.jsonl,identity-summary.json}
 *
 * 使い方: npx tsx scripts/pipeline-v2/derive-mof.ts [year...]
 *   （年度省略時は 2023 2024 2025）
 */
import * as path from 'path';
import { stableId } from './lib/stable-id';
import { readJsonl, writeJsonl, writeJson } from './lib/jsonl';
import { semanticItemKey, transitionLinks, type TransitionStats } from './lib/mof-transitions';
import { aggregateMofSections } from './lib/mof-sections';
import { validateSettlementEquations } from './lib/mof-settlement';
import { buildSettlementItems } from './lib/mof-settlement-items';
import type { MofBudgetItemRecord, MofDerivedBudgetEvent, MofIdentityRelation } from './types';

function groupAmount(rows: MofBudgetItemRecord[], field: keyof MofBudgetItemRecord): number {
  return rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
}

function eventBase(row: MofBudgetItemRecord, eventType: string, amount: number, eventIdSuffix = ''): MofDerivedBudgetEvent {
  return {
    schemaVersion: 2,
    recordType: 'budget_event',
    eventId: stableId([row.recordId, eventType, eventIdSuffix], 'evt_'),
    sourceSystem: 'mof',
    fiscalYear: row.fiscalYear,
    eventType,
    amountYen: amount || 0,
    accountType: row.accountType,
    ministry: row.ministry ?? '',
    organization: row.organization ?? '',
    specialAccount: row.specialAccount ?? '',
    subAccount: row.subAccount ?? '',
    agency: row.agency ?? '',
    sectionCode: row.sectionCode ?? '',
    sectionName: row.sectionName ?? '',
    subItemName: row.subItemName ?? '',
    sourceRecordIds: [row.recordId],
    source: row.source,
  };
}

const SETTLEMENT_COMPONENTS: [string, keyof MofBudgetItemRecord][] = [
  ['settlement_budget_appropriation', 'budgetAmountYen'],
  ['carryover_in', 'carryoverInYen'],
  ['reserve_use', 'reserveUseYen'],
  ['budget_rule_increase', 'budgetRuleIncreaseYen'],
  ['reallocation', 'reallocationYen'],
  ['transfer_adjustment', 'transferAdjustmentYen'],
  ['current_budget_state', 'currentBudgetYen'],
  ['spent', 'spentYen'],
  ['carryover_out', 'carryoverOutYen'],
  ['unused', 'unusedYen'],
];

function buildMofEvents(outputRoot: string, fiscalYear: number): { eventCount: number; eventTypeCounts: Record<string, number>; parliamentaryAmendmentCount: number; parliamentaryAmendmentNetDeltaYen: number } {
  const rows = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
  const events: MofDerivedBudgetEvent[] = [];

  for (const row of rows) {
    if (row.phase === 'initial' || row.phase === 'provisional') {
      const eventType = row.phase === 'initial' ? 'initial_budget_state' : 'provisional_budget_state';
      const event = eventBase(row, eventType, row.amountYen ?? 0);
      event.budgetStatus = row.budgetStatus;
      events.push(event);
    } else if (row.phase === 'supplement') {
      const event = eventBase(row, 'supplement_adjustment', row.supplementDeltaYen ?? 0);
      event.revision = row.revision;
      event.baseAmountYen = row.baseAmountYen ?? 0;
      event.resultingAmountYen = row.revisedAmountYen ?? 0;
      event.budgetStatus = row.budgetStatus;
      events.push(event);
    } else if (row.phase === 'settlement') {
      for (const [eventType, field] of SETTLEMENT_COMPONENTS) {
        // 0円の状態・内訳も決算原本のevidenceとして保持する（除外しない）
        events.push(eventBase(row, eventType, Number(row[field]) || 0, field));
      }
    }
  }

  // 国会修正: 当初予算の提出版・成立版を項目同一性キー単位で比較する
  const submitted = new Map<string, MofBudgetItemRecord[]>();
  const enacted = new Map<string, MofBudgetItemRecord[]>();
  for (const row of rows) {
    if (row.phase !== 'initial') continue;
    const key = semanticItemKey(row);
    const target = row.budgetStatus === 'submitted' ? submitted : row.budgetStatus === 'enacted' ? enacted : null;
    if (!target) continue;
    const list = target.get(key) ?? [];
    list.push(row);
    target.set(key, list);
  }

  const submittedAccountTypes = new Set(rows.filter(r => r.phase === 'initial' && r.budgetStatus === 'submitted').map(r => r.accountType));
  const enactedAccountTypes = new Set(rows.filter(r => r.phase === 'initial' && r.budgetStatus === 'enacted').map(r => r.accountType));
  const comparableAccountTypes = new Set([...submittedAccountTypes].filter(a => enactedAccountTypes.has(a)));

  let amendmentCount = 0;
  let amendmentDelta = 0;
  const allKeys = [...new Set([...submitted.keys(), ...enacted.keys()])].sort();
  for (const key of allKeys) {
    const srows = submitted.get(key) ?? [];
    const erows = enacted.get(key) ?? [];
    const templateRows = erows.length > 0 ? erows : srows;
    if (templateRows.length > 0 && !comparableAccountTypes.has(templateRows[0].accountType)) continue;
    if (srows.length === 0 && erows.length === 0) continue;
    const sAmt = groupAmount(srows, 'amountYen');
    const eAmt = groupAmount(erows, 'amountYen');
    if (sAmt === eAmt && srows.length > 0 && erows.length > 0) continue;
    const template = (erows.length > 0 ? erows : srows)[0];
    const eventType = srows.length > 0 && erows.length > 0
      ? 'parliamentary_amendment'
      : erows.length > 0 ? 'parliamentary_amendment_added' : 'parliamentary_amendment_removed';
    const delta = eAmt - sAmt;
    const event = eventBase(template, eventType, delta, key);
    event.submittedAmountYen = sAmt;
    event.enactedAmountYen = eAmt;
    event.sourceRecordIds = [...srows, ...erows].map(r => r.recordId).sort();
    event.evidenceMethod = 'submitted-vs-enacted-exact-semantic-key';
    events.push(event);
    amendmentCount++;
    amendmentDelta += delta;
  }

  events.sort((a, b) => {
    const ka = [a.fiscalYear, a.eventType, a.sectionName, a.subItemName, a.eventId].join('\x1f');
    const kb = [b.fiscalYear, b.eventType, b.sectionName, b.subItemName, b.eventId].join('\x1f');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const outDir = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`);
  writeJsonl(path.join(outDir, 'budget-events.jsonl'), events);
  const eventTypeCounts: Record<string, number> = {};
  for (const e of events) eventTypeCounts[e.eventType] = (eventTypeCounts[e.eventType] ?? 0) + 1;
  const summary = {
    schemaVersion: 2,
    fiscalYear: fiscalYear,
    eventCount: events.length,
    eventTypeCounts: Object.fromEntries(Object.entries(eventTypeCounts).sort()),
    parliamentaryAmendmentCount: amendmentCount,
    parliamentaryAmendmentNetDeltaYen: amendmentDelta,
  };
  writeJson(path.join(outDir, 'budget-events-summary.json'), summary);
  return summary;
}

function buildMofIdentity(outputRoot: string, fiscalYear: number): { relationCount: number; transitions: Record<string, TransitionStats> } {
  const rows = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
  const initialSubmitted = rows.filter(r => r.phase === 'initial' && r.budgetStatus === 'submitted');
  const initialEnacted = rows.filter(r => r.phase === 'initial' && r.budgetStatus === 'enacted');
  const settlement = rows.filter(r => r.phase === 'settlement');
  const supplementByRevision = new Map<number, MofBudgetItemRecord[]>();
  for (const r of rows) {
    if (r.phase !== 'supplement') continue;
    const revision = r.revision ?? 0;
    const list = supplementByRevision.get(revision) ?? [];
    list.push(r);
    supplementByRevision.set(revision, list);
  }

  const allLinks: MofIdentityRelation[] = [];
  const stages: Record<string, TransitionStats> = {};

  if (initialSubmitted.length > 0 && initialEnacted.length > 0) {
    const { links, stats } = transitionLinks(initialSubmitted, initialEnacted, 'initial_submitted', 'initial_enacted');
    allLinks.push(...links);
    stages['initial_submitted->initial_enacted'] = stats;
  }
  let previous = initialEnacted;
  let previousLabel = 'initial_enacted';
  for (const revision of [...supplementByRevision.keys()].sort((a, b) => a - b)) {
    const current = supplementByRevision.get(revision)!;
    if (previous.length > 0 && current.length > 0) {
      const label = `supplement_${revision}`;
      const { links, stats } = transitionLinks(previous, current, previousLabel, label);
      allLinks.push(...links);
      stages[`${previousLabel}->${label}`] = stats;
      previous = current;
      previousLabel = label;
    }
  }
  if (settlement.length > 0) {
    const source = previous.length > 0 ? previous : initialEnacted;
    const sourceLabel = previous.length > 0 ? previousLabel : 'initial_enacted';
    if (source.length > 0) {
      const { links, stats } = transitionLinks(source, settlement, sourceLabel, 'settlement');
      allLinks.push(...links);
      stages[`${sourceLabel}->settlement`] = stats;
    }
  }

  allLinks.sort((a, b) => {
    const ka = [a.sourceStage, a.targetStage, a.relationType, a.relationId].join('\x1f');
    const kb = [b.sourceStage, b.targetStage, b.relationType, b.relationId].join('\x1f');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const outDir = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`);
  writeJsonl(path.join(outDir, 'identity-relations.jsonl'), allLinks);
  const summary = { schemaVersion: 2, fiscalYear: fiscalYear, relationCount: allLinks.length, transitions: stages };
  writeJson(path.join(outDir, 'identity-summary.json'), summary);
  return summary;
}

function buildMofSectionsForYear(outputRoot: string, fiscalYear: number): { sectionCount: number; stageGapCount: number } {
  const items = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
  const events = readJsonl<MofDerivedBudgetEvent>(path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`, 'budget-events.jsonl'));
  const { sections, stageGaps } = aggregateMofSections(items, events, fiscalYear);

  const outDir = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`);
  writeJsonl(path.join(outDir, 'sections.jsonl'), sections);
  writeJsonl(path.join(outDir, 'stage-gaps.jsonl'), stageGaps);

  const settlement = validateSettlementEquations(items);
  writeJson(path.join(outDir, 'settlement-equation.json'), { schemaVersion: 2, fiscalYear, ...settlement });

  console.log(`  sections.jsonl: ${sections.length}件`);
  console.log(`  stage-gaps.jsonl: ${stageGaps.length}件（未解決の補正後→決算差分）`);
  console.log(`  決算検算: checked=${settlement.checkedRows} skipped=${settlement.skippedRows} ` +
    `components→現額mismatch=${settlement.componentsToCurrentBudgetMismatches} ` +
    `現額→支出済+繰越+不用mismatch=${settlement.currentBudgetToSpentMismatches}`);
  return { sectionCount: sections.length, stageGapCount: stageGaps.length };
}

function buildSettlementItemsForYear(outputRoot: string, fiscalYear: number): { itemCount: number; multiSourceItemCount: number } {
  const items = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
  const { items: settlementItems, summary } = buildSettlementItems(items, fiscalYear);

  const outDir = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`);
  writeJsonl(path.join(outDir, 'settlement-items.jsonl'), settlementItems);
  writeJson(path.join(outDir, 'settlement-items-summary.json'), summary);

  console.log(`  settlement-items.jsonl: ${summary.itemCount}件（multiSource=${summary.multiSourceItemCount}）`);
  console.log(`  決算item検算: checked=${summary.equationCheckedCount} skipped=${summary.equationSkippedCount} ` +
    `components→現額mismatch=${summary.componentsToCurrentBudgetMismatches} ` +
    `現額→支出済+繰越+不用mismatch=${summary.currentBudgetToSpentMismatches}`);
  return { itemCount: summary.itemCount, multiSourceItemCount: summary.multiSourceItemCount };
}

function main(): void {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2023, 2024, 2025];
  const outputRoot = 'data';

  for (const year of targetYears) {
    console.log(`\n=== MOF derive: fiscalYear=${year} ===`);
    const eventsSummary = buildMofEvents(outputRoot, year);
    console.log(`  budget-events.jsonl: ${eventsSummary.eventCount}件`, JSON.stringify(eventsSummary.eventTypeCounts));
    console.log(`  国会修正: ${eventsSummary.parliamentaryAmendmentCount}件, 純額 ${eventsSummary.parliamentaryAmendmentNetDeltaYen.toLocaleString()}円`);
    const identitySummary = buildMofIdentity(outputRoot, year);
    console.log(`  identity-relations.jsonl: ${identitySummary.relationCount}件`);
    for (const [transition, stats] of Object.entries(identitySummary.transitions)) {
      console.log(`    ${transition}: ${JSON.stringify(stats)}`);
    }
    buildMofSectionsForYear(outputRoot, year);
    buildSettlementItemsForYear(outputRoot, year);
  }
}

main();
