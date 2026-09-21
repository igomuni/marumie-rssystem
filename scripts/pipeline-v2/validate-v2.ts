/**
 * Pipeline V2のnormalize/derived成果物を横断検証する。
 * 仕様: 20260920_Pipeline_V2_RS全情報・資金フロー拡張_実装仕様.md 11節、
 * docs/tasks/20260920_MOF_RS_Linkage先行検証_Sonnet引継ぎ.mdのValidation節。
 *
 * 原則: 差異を検知して報告するだけで、自動補正はしない（食い違いは
 * project-sheet-conflicts.jsonlのように両方残った状態のまま検証対象にする）。
 *
 * Finding分類（Validator hardening plan Stage A）: severityとは別にcategoryを持つ。
 * - invariant: 破れたら成果物が内部矛盾（従来どおりexit codeに反映）
 * - source-preservation / semantic-diagnostic: 意味の保持・診断（error/warning/infoは既存どおり）
 * - baseline-drift: 「検証済み時点の現在値」からのずれ。正しいアルゴリズム改善でも変わりうるため
 *   severity='warning'とし、既定ではexit codeに反映しない（--strict-baselineで反映可能）
 *
 * 使い方: npx tsx scripts/pipeline-v2/validate-v2.ts [--strict-baseline]
 * 終了コード: errorレベルのfindingが1件でもあれば1。
 *   --strict-baseline指定時はbaseline-driftのfindingがあれば1。
 */
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, writeJson } from './lib/jsonl';
import {
  checkNoUnknownNonEmptyColumns, checkFundingRelationBlockReferences,
  checkExplicitZeroPreserved, checkMofRsLinkIntegrity, summarizeProjectSheetConflicts,
  compareLinkBaseline, decideExitFailure,
  type Finding,
} from './lib/validate-checks';
import {
  checkRsCurrentBudgetEquation, checkRsSummaryItemReconciliation,
  checkRsDerivedEventProvenance, checkRsZeroBlankPropagation,
} from './lib/validation/rs-money';
import {
  checkMofSettlementEquation, checkMofDerivedEventProvenance,
  checkMofParliamentaryAmendmentProvenance, checkMofStructuralZeroFromRaw,
} from './lib/validation/mof-money';
import type {
  SourceInventory, RsSpendingBlockRecord, RsFundingRelationRecord, RsBudgetItemRecordV2,
  RsBudgetSummaryRecord, RsDerivedBudgetEvent, RsProjectSheetConflict, MofBudgetItemRecord, MofRsProjectLinkGroup,
  MofDerivedBudgetEvent,
} from './types';

const REVIEW_YEARS = [2024, 2025, 2026];
const FISCAL_YEARS = [2024, 2025];

/**
 * MOF_RS_Linkage先行検証doc記載のgolden acceptance（review-2025のみ固定）。
 * 「正しさの不変条件」ではなく「検証済み時点のbaseline snapshot」（accidental regression検知用）。
 * joint-ministry fallback等の意図したアルゴリズム改善でもこの値は変わりうるため、
 * 不一致はcategory='baseline-drift'・severity='warning'として扱う（validateMofRsLinks参照）。
 */
const LINK_GOLDEN_ACCEPTANCE: Record<string, {
  linkGroupCount: number; linkedProjectCount: number; linkedRsRecordCount: number;
  unlinkedRsRecordCount: number; unsupportedBudgetTypeRecordCount: number;
  mofAmountAcrossGroupsYen: number; rsAmountAcrossGroupsYen: number;
}> = {
  '2025:2024': {
    linkGroupCount: 4914, linkedProjectCount: 4537, linkedRsRecordCount: 13087,
    unlinkedRsRecordCount: 1093, unsupportedBudgetTypeRecordCount: 2466,
    mofAmountAcrossGroupsYen: 132_282_025_855_000, rsAmountAcrossGroupsYen: 131_634_536_373_813,
  },
  '2025:2025': {
    linkGroupCount: 5086, linkedProjectCount: 4851, linkedRsRecordCount: 14017,
    unlinkedRsRecordCount: 1034, unsupportedBudgetTypeRecordCount: 1992,
    mofAmountAcrossGroupsYen: 136_591_411_159_000, rsAmountAcrossGroupsYen: 135_391_998_467_250,
  },
};

/** findingにreviewYearをscopeとして付与しつつ、既存のmessage prefix方式も維持する（後方互換） */
function withReviewYear(findings: Finding[], reviewYear: number): Finding[] {
  return findings.map(f => ({ ...f, scope: { ...f.scope, reviewYear }, message: `review-${reviewYear} ${f.message}` }));
}

interface RsYearMetrics {
  reviewYear: number; sourceInventoryDatasets: number; blockCount: number; relationCount: number;
  unresolvedRelationCount: number; budgetItemCount: number; sheetConflictCount: number;
  budgetSummaryCount: number; derivedBudgetEventCount: number;
  currentBudgetEquation: { checked: number; mismatches: number };
  summaryItemReconciliation: { checkedGroups: number; mismatches: number };
  derivedEventProvenance: {
    checkedEvents: number; missingSourceRecords: number; amountMismatches: number;
    expectedEvents: number; actualEvents: number; missingExpectedEvents: number; duplicateOrUnexpectedEvents: number;
    fiscalYearMismatches: number; eventTypeMismatches: number;
  };
  explicitZeroBlank: { explicitZeroSourceRows: number; explicitZeroEvents: number; blankSourceRows: number; blankUnexpectedEvents: number };
}

function validateRsYear(outputRoot: string, reviewYear: number): { findings: Finding[]; metrics: RsYearMetrics | null } {
  const findings: Finding[] = [];
  const normDir = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`);
  const manifestPath = path.join(normDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { findings, metrics: null };

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { sourceInventories?: SourceInventory[] };
  if (manifest.sourceInventories) {
    findings.push(...withReviewYear(checkNoUnknownNonEmptyColumns(manifest.sourceInventories), reviewYear));
  }

  const blocks = readJsonl<RsSpendingBlockRecord>(path.join(normDir, 'spending-blocks.jsonl'));
  const relations = readJsonl<RsFundingRelationRecord>(path.join(normDir, 'funding-relations.jsonl'));
  let unresolvedCount = 0;
  if (blocks.length > 0 || relations.length > 0) {
    const refResult = checkFundingRelationBlockReferences(blocks, relations);
    unresolvedCount = refResult.unresolvedCount;
    findings.push(...withReviewYear(refResult.findings, reviewYear));
    console.log(`  review-${reviewYear}: 5-2→5-1参照 unresolvedCount=${unresolvedCount}（rs-funding-graph.tsのunresolvedRelationIdsと一致するはず）`);
  }

  const items = readJsonl<RsBudgetItemRecordV2>(path.join(normDir, 'budget-items.jsonl'));
  if (items.length > 0) {
    findings.push(...withReviewYear(checkExplicitZeroPreserved(items), reviewYear));
  }

  const conflicts = readJsonl<RsProjectSheetConflict>(path.join(normDir, 'project-sheet-conflicts.jsonl'));
  const conflictFindings = summarizeProjectSheetConflicts(conflicts);
  if (conflictFindings.length > 0) console.log(`  review-${reviewYear}: ${conflictFindings[0].message}`);
  findings.push(...withReviewYear(conflictFindings, reviewYear));

  // Stage B: RS monetary invariants。summaries/itemsはここまでで読み込み済みの配列を再利用する
  const summaries = readJsonl<RsBudgetSummaryRecord>(path.join(normDir, 'budget-summaries.jsonl'));
  const derivedEventsPath = path.join(outputRoot, 'derived', 'rs', `review-${reviewYear}`, 'budget-events.jsonl');
  const derivedEvents = fs.existsSync(derivedEventsPath) ? readJsonl<RsDerivedBudgetEvent>(derivedEventsPath) : [];

  const equationResult = checkRsCurrentBudgetEquation(summaries);
  findings.push(...withReviewYear(equationResult.findings, reviewYear));

  const reconciliationResult = checkRsSummaryItemReconciliation(summaries, items);
  findings.push(...withReviewYear(reconciliationResult.findings, reviewYear));

  const provenanceResult = fs.existsSync(derivedEventsPath)
    ? checkRsDerivedEventProvenance(derivedEvents, items, summaries)
    : {
      findings: [] as Finding[], checkedEvents: 0, missingSourceRecords: 0, amountMismatches: 0,
      expectedEvents: 0, actualEvents: 0, missingExpectedEvents: 0, duplicateOrUnexpectedEvents: 0,
      fiscalYearMismatches: 0, eventTypeMismatches: 0,
    };
  findings.push(...withReviewYear(provenanceResult.findings, reviewYear));

  const zeroBlankResult = checkRsZeroBlankPropagation(items, derivedEvents);
  findings.push(...withReviewYear(zeroBlankResult.findings, reviewYear));

  console.log(`  review-${reviewYear}: RS monetary invariants — 現額式 checked=${equationResult.checked} mismatch=${equationResult.mismatches} / ` +
    `2-1↔2-2 checkedGroups=${reconciliationResult.checkedGroups} mismatch=${reconciliationResult.mismatches} / ` +
    `derived provenance expected=${provenanceResult.expectedEvents} actual=${provenanceResult.actualEvents} ` +
    `missing=${provenanceResult.missingExpectedEvents} dup/unexpected=${provenanceResult.duplicateOrUnexpectedEvents} ` +
    `amountMismatch=${provenanceResult.amountMismatches} fyMismatch=${provenanceResult.fiscalYearMismatches}`);

  const metrics: RsYearMetrics = {
    reviewYear, sourceInventoryDatasets: manifest.sourceInventories?.length ?? 0,
    blockCount: blocks.length, relationCount: relations.length, unresolvedRelationCount: unresolvedCount,
    budgetItemCount: items.length, sheetConflictCount: conflicts.length,
    budgetSummaryCount: summaries.length, derivedBudgetEventCount: derivedEvents.length,
    currentBudgetEquation: { checked: equationResult.checked, mismatches: equationResult.mismatches },
    summaryItemReconciliation: { checkedGroups: reconciliationResult.checkedGroups, mismatches: reconciliationResult.mismatches },
    derivedEventProvenance: {
      checkedEvents: provenanceResult.checkedEvents, missingSourceRecords: provenanceResult.missingSourceRecords, amountMismatches: provenanceResult.amountMismatches,
      expectedEvents: provenanceResult.expectedEvents, actualEvents: provenanceResult.actualEvents,
      missingExpectedEvents: provenanceResult.missingExpectedEvents, duplicateOrUnexpectedEvents: provenanceResult.duplicateOrUnexpectedEvents,
      fiscalYearMismatches: provenanceResult.fiscalYearMismatches, eventTypeMismatches: provenanceResult.eventTypeMismatches,
    },
    explicitZeroBlank: {
      explicitZeroSourceRows: zeroBlankResult.explicitZeroSourceRows, explicitZeroEvents: zeroBlankResult.explicitZeroEvents,
      blankSourceRows: zeroBlankResult.blankSourceRows, blankUnexpectedEvents: zeroBlankResult.blankUnexpectedEvents,
    },
  };
  return { findings, metrics };
}

/** findingにfiscalYearをscopeとして付与しつつ、既存のmessage prefix方式も維持する（後方互換） */
function withFiscalYear(findings: Finding[], fiscalYear: number): Finding[] {
  return findings.map(f => ({ ...f, scope: { ...f.scope, fiscalYear }, message: `fy${fiscalYear} ${f.message}` }));
}

interface MofYearMetrics {
  fiscalYear: number; budgetItemCount: number; derivedBudgetEventCount: number;
  settlementEquation: { checked: number; skipped: number; mismatches: number };
  derivedEventProvenance: {
    expectedEvents: number; actualEvents: number; missingExpectedEvents: number; duplicateOrUnexpectedEvents: number;
    amountMismatches: number; fiscalYearMismatches: number; eventTypeMismatches: number; sourceCardinalityErrors: number;
  };
  parliamentaryAmendmentProvenance: {
    expectedEvents: number; actualEvents: number; missingExpectedEvents: number; duplicateOrUnexpectedEvents: number;
    amountMismatches: number; expectedNetAmendmentAmountYen: number;
  };
  structuralZero: {
    counts: ReturnType<typeof checkMofStructuralZeroFromRaw>['counts'];
    rawSourceUnavailableRows: number;
  };
}

function validateMofYear(outputRoot: string, rawRoot: string, fiscalYear: number): { findings: Finding[]; metrics: MofYearMetrics | null } {
  const findings: Finding[] = [];
  const normDir = path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`);
  const itemsPath = path.join(normDir, 'budget-items.jsonl');
  if (!fs.existsSync(itemsPath)) return { findings, metrics: null };

  const items = readJsonl<MofBudgetItemRecord>(itemsPath);
  const derivedEventsPath = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`, 'budget-events.jsonl');
  const derivedEvents = fs.existsSync(derivedEventsPath) ? readJsonl<MofDerivedBudgetEvent>(derivedEventsPath) : [];

  // Stage C: 決算等式はlib/mof-settlement.tsのvalidateSettlementEquations()を呼ばず、
  // このvalidator自身で独立に再実装した式を使う（09_validator-hardening-plan.md C-1）
  const equationResult = checkMofSettlementEquation(items);
  findings.push(...withFiscalYear(equationResult.findings, fiscalYear));

  const provenanceResult = fs.existsSync(derivedEventsPath)
    ? checkMofDerivedEventProvenance(derivedEvents, items)
    : {
      findings: [] as Finding[], checkedEvents: 0, expectedEvents: 0, actualEvents: 0,
      missingExpectedEvents: 0, duplicateOrUnexpectedEvents: 0, amountMismatches: 0,
      fiscalYearMismatches: 0, eventTypeMismatches: 0, sourceCardinalityErrors: 0,
    };
  findings.push(...withFiscalYear(provenanceResult.findings, fiscalYear));

  const parliamentaryResult = fs.existsSync(derivedEventsPath)
    ? checkMofParliamentaryAmendmentProvenance(derivedEvents, items)
    : {
      findings: [] as Finding[], expectedEvents: 0, actualEvents: 0, missingExpectedEvents: 0,
      duplicateOrUnexpectedEvents: 0, amountMismatches: 0, expectedNetAmendmentAmountYen: 0,
    };
  findings.push(...withFiscalYear(parliamentaryResult.findings, fiscalYear));

  const structuralZeroResult = checkMofStructuralZeroFromRaw(rawRoot, items);
  findings.push(...withFiscalYear(structuralZeroResult.findings, fiscalYear));

  console.log(`  fy${fiscalYear}: MOF monetary invariants — 決算等式 checked=${equationResult.checked} skipped=${equationResult.skipped} mismatch=${equationResult.mismatches} / ` +
    `derived provenance expected=${provenanceResult.expectedEvents} actual=${provenanceResult.actualEvents} ` +
    `missing=${provenanceResult.missingExpectedEvents} dup/unexpected=${provenanceResult.duplicateOrUnexpectedEvents} amountMismatch=${provenanceResult.amountMismatches} ` +
    `cardinalityErrors=${provenanceResult.sourceCardinalityErrors} / ` +
    `国会修正 expected=${parliamentaryResult.expectedEvents} actual=${parliamentaryResult.actualEvents} ` +
    `missing=${parliamentaryResult.missingExpectedEvents} dup/unexpected=${parliamentaryResult.duplicateOrUnexpectedEvents} ` +
    `netAmendment=${parliamentaryResult.expectedNetAmendmentAmountYen.toLocaleString()}円 / ` +
    `structural-zero rawSourceUnavailable=${structuralZeroResult.rawSourceUnavailableRows}`);

  const metrics: MofYearMetrics = {
    fiscalYear, budgetItemCount: items.length, derivedBudgetEventCount: derivedEvents.length,
    settlementEquation: { checked: equationResult.checked, skipped: equationResult.skipped, mismatches: equationResult.mismatches },
    derivedEventProvenance: {
      expectedEvents: provenanceResult.expectedEvents, actualEvents: provenanceResult.actualEvents,
      missingExpectedEvents: provenanceResult.missingExpectedEvents, duplicateOrUnexpectedEvents: provenanceResult.duplicateOrUnexpectedEvents,
      amountMismatches: provenanceResult.amountMismatches, fiscalYearMismatches: provenanceResult.fiscalYearMismatches, eventTypeMismatches: provenanceResult.eventTypeMismatches,
      sourceCardinalityErrors: provenanceResult.sourceCardinalityErrors,
    },
    parliamentaryAmendmentProvenance: {
      expectedEvents: parliamentaryResult.expectedEvents, actualEvents: parliamentaryResult.actualEvents,
      missingExpectedEvents: parliamentaryResult.missingExpectedEvents, duplicateOrUnexpectedEvents: parliamentaryResult.duplicateOrUnexpectedEvents,
      amountMismatches: parliamentaryResult.amountMismatches,
      expectedNetAmendmentAmountYen: parliamentaryResult.expectedNetAmendmentAmountYen,
    },
    structuralZero: { counts: structuralZeroResult.counts, rawSourceUnavailableRows: structuralZeroResult.rawSourceUnavailableRows },
  };
  return { findings, metrics };
}

interface LinkPairMetrics { reviewYear: number; fiscalYear: number; linkGroupCount: number; summary: Record<string, unknown> }

function validateMofRsLinks(outputRoot: string): { findings: Finding[]; metrics: LinkPairMetrics[] } {
  const findings: Finding[] = [];
  const metrics: LinkPairMetrics[] = [];
  const linksDir = path.join(outputRoot, 'derived', 'links');
  if (!fs.existsSync(linksDir)) return { findings, metrics };

  for (const reviewYear of REVIEW_YEARS) {
    for (const fiscalYear of FISCAL_YEARS) {
      if (fiscalYear > reviewYear) continue;
      const linksPath = path.join(linksDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`);
      const summaryPath = path.join(linksDir, `mof-rs-review-${reviewYear}-fy${fiscalYear}-summary.json`);
      if (!fs.existsSync(linksPath) || !fs.existsSync(summaryPath)) continue;

      const links = readJsonl<MofRsProjectLinkGroup>(linksPath);
      const mofItems = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
      const rsItems = readJsonl<RsBudgetItemRecordV2>(path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`, 'budget-items.jsonl'));
      const integrityFindings = checkMofRsLinkIntegrity(links, mofItems, rsItems);
      findings.push(...integrityFindings.map(f => ({ ...f, scope: { ...f.scope, reviewYear, fiscalYear }, message: `review-${reviewYear}×fy${fiscalYear}: ${f.message}` })));
      console.log(`  review-${reviewYear}×fy${fiscalYear}: link整合性チェック findings=${integrityFindings.length}`);

      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      metrics.push({ reviewYear, fiscalYear, linkGroupCount: links.length, summary });

      // golden acceptanceは「検証済み時点のbaseline snapshot」であり不変条件ではない（L-017）。
      // joint-ministry fallback等の正しいアルゴリズム改善でもこの値は変わりうるため、
      // severity=warning / category=baseline-driftとし、既定ではexit codeに反映しない（compareLinkBaseline参照）。
      const golden = LINK_GOLDEN_ACCEPTANCE[`${reviewYear}:${fiscalYear}`];
      if (golden) {
        const driftFindings = compareLinkBaseline(golden, summary, { reviewYear, fiscalYear });
        findings.push(...driftFindings);
        console.log(`  review-${reviewYear}×fy${fiscalYear}: baseline snapshot ${driftFindings.length === 0 ? 'OK' : `drift ${driftFindings.length}件`}`);
      }
    }
  }
  return { findings, metrics };
}

function main(): void {
  const outputRoot = 'data';
  const rawRoot = path.join('data', 'download');
  const strictBaseline = process.argv.includes('--strict-baseline');
  const allFindings: Finding[] = [];
  const rsMetrics: RsYearMetrics[] = [];

  const mofMetrics: MofYearMetrics[] = [];

  console.log('=== Pipeline V2 validate-v2 ===');
  for (const year of REVIEW_YEARS) {
    const { findings, metrics } = validateRsYear(outputRoot, year);
    allFindings.push(...findings);
    if (metrics) rsMetrics.push(metrics);
  }
  for (const year of FISCAL_YEARS) {
    const { findings, metrics } = validateMofYear(outputRoot, rawRoot, year);
    allFindings.push(...findings);
    if (metrics) mofMetrics.push(metrics);
  }
  const { findings: linkFindings, metrics: linkMetrics } = validateMofRsLinks(outputRoot);
  allFindings.push(...linkFindings);

  const errorCount = allFindings.filter(f => f.severity === 'error').length;
  const warningCount = allFindings.filter(f => f.severity === 'warning').length;
  const infoCount = allFindings.filter(f => f.severity === 'info').length;
  const driftFindings = allFindings.filter(f => f.category === 'baseline-drift');

  console.log(`\n=== findings: error=${errorCount} warning=${warningCount} info=${infoCount} (うちbaseline-drift=${driftFindings.length}) ===`);
  for (const f of allFindings) {
    console.log(`[${f.severity}] ${f.check}: ${f.message}`);
  }

  // Stage A: metricsは器のみ。ドメイン別の実検査追加はStage B以降（09_validator-hardening-plan.md）
  writeJson(path.join(outputRoot, 'derived', 'validate-report.json'), {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    errorCount, warningCount, infoCount,
    findings: allFindings,
    metrics: {
      rs: rsMetrics,
      mof: mofMetrics,
      links: linkMetrics,
      publish: {},
    },
    baseline: { driftCount: driftFindings.length },
  });

  if (decideExitFailure(allFindings, { strictBaseline })) {
    if (errorCount > 0) console.error(`\nvalidate-v2: ${errorCount}件のerrorがあります`);
    if (strictBaseline && driftFindings.length > 0) console.error(`\nvalidate-v2: --strict-baseline指定下でbaseline-driftが${driftFindings.length}件あります`);
    process.exitCode = 1;
  } else {
    console.log(`\nvalidate-v2: errorなし${driftFindings.length > 0 ? `（baseline-drift ${driftFindings.length}件はexit codeに非連動。--strict-baselineで反映可能）` : ''}`);
  }
}

main();
