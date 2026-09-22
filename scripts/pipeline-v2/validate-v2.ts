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
  compareLinkBaseline, decideExitFailure, checkDerivedArtifactPresence,
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
import {
  classifyUnlinkedReasons, checkLinkTaxonomyConsistency, diagnoseJointMinistryFallback,
  analyzeLinkDifferenceTaxonomy, analyzeMultiProjectGroups, diagnoseSupplementalExactFallback,
  checkSupplementalExactProductionPolicy,
  type JointMinistryFallbackCandidate, type SupplementalExactCandidate, type SupplementalExactProductionPolicyMetrics,
} from './lib/validation/mof-rs-linkage';
import {
  readGzipJson, readJsonFile, independentRsShard, checkArtifactExists,
  checkRsProjectCounts, checkRsShardReferentialIntegrity, checkRsBudgetSummaryPreservation,
  checkRsBudgetItemPreservation, checkRsFalsePreservation, checkRsIndexBudgetSummaryReconstruction,
  checkMofSectionCounts, checkMofSectionSemantics, checkMofDetailRecords, checkMofDetailEventAggregation,
  checkLinksPublishCounts, checkLinksSemanticEquality, checkLinksSectionIdsReconstruction, checkLinksManifestSetCounts,
  checkRootManifestConsistency,
  type RsPublishIndex, type RsPublishManifest, type MofPublishIndex, type MofPublishManifest,
  type PublishedLink, type LinksPublishManifest, type RootManifest, type MofSectionDetail,
} from './lib/validation/publish';
import type { RsProject } from './lib/rs-projects';
import type {
  SourceInventory, RsSpendingBlockRecord, RsFundingRelationRecord, RsBudgetItemRecordV2,
  RsBudgetSummaryRecord, RsDerivedBudgetEvent, RsProjectSheetConflict, MofBudgetItemRecord, MofRsProjectLinkGroup,
  MofDerivedBudgetEvent, MofDerivedSection,
} from './types';

const REVIEW_YEARS = [2024, 2025, 2026];
const FISCAL_YEARS = [2023, 2024, 2025];

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
  // review指摘（55_sonnet-p2-tier1-production-activation-instructions.md）: P2 Tier-1 production
  // 昇格により意図的にリンク結果が変わったため更新する。旧値でderive+validateを実行し
  // baseline-drift warningを確認、reviewer提示のexpected snapshotと実出力が完全一致することを
  // 検証した上で更新した（実装報告参照。数値をexpected snapshotに合わせるための変更ではなく、
  // 独立した実データ計測が両者で一致したことを確認してから反映している）。
  '2025:2024': {
    linkGroupCount: 5065, linkedProjectCount: 4645, linkedRsRecordCount: 13366,
    unlinkedRsRecordCount: 814, unsupportedBudgetTypeRecordCount: 2466,
    mofAmountAcrossGroupsYen: 132_967_619_003_000, rsAmountAcrossGroupsYen: 132_363_032_469_813,
  },
  '2025:2025': {
    linkGroupCount: 5228, linkedProjectCount: 4950, linkedRsRecordCount: 14266,
    unlinkedRsRecordCount: 785, unsupportedBudgetTypeRecordCount: 1992,
    mofAmountAcrossGroupsYen: 137_226_726_441_000, rsAmountAcrossGroupsYen: 136_060_423_522_250,
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
  const derivedArtifactExists = fs.existsSync(derivedEventsPath);
  const derivedEvents = derivedArtifactExists ? readJsonl<RsDerivedBudgetEvent>(derivedEventsPath) : [];

  // review指摘（Stage B/C共通のorchestration gap）: sourceにレコードがあるのに
  // budget-events.jsonl自体が丸ごと無い場合、既存のfallback（provenance結果を全0で代用）
  // だけでは静かに素通りしてしまうため、artifact欠落自体を1件のinvariant errorにする
  findings.push(...withReviewYear(
    checkDerivedArtifactPresence('rs-derived-artifact-presence', items.length + summaries.length, derivedArtifactExists, {}),
    reviewYear,
  ));

  const equationResult = checkRsCurrentBudgetEquation(summaries);
  findings.push(...withReviewYear(equationResult.findings, reviewYear));

  const reconciliationResult = checkRsSummaryItemReconciliation(summaries, items);
  findings.push(...withReviewYear(reconciliationResult.findings, reviewYear));

  const provenanceResult = derivedArtifactExists
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
  const derivedArtifactExists = fs.existsSync(derivedEventsPath);
  const derivedEvents = derivedArtifactExists ? readJsonl<MofDerivedBudgetEvent>(derivedEventsPath) : [];

  // review指摘（Stage B/C共通のorchestration gap）: sourceにレコードがあるのに
  // budget-events.jsonl自体が丸ごと無い場合、既存のfallback（provenance結果を全0で代用）
  // だけでは静かに素通りしてしまうため、artifact欠落自体を1件のinvariant errorにする
  findings.push(...withFiscalYear(
    checkDerivedArtifactPresence('mof-derived-artifact-presence', items.length, derivedArtifactExists, {}),
    fiscalYear,
  ));

  // Stage C: 決算等式はlib/mof-settlement.tsのvalidateSettlementEquations()を呼ばず、
  // このvalidator自身で独立に再実装した式を使う（09_validator-hardening-plan.md C-1）
  const equationResult = checkMofSettlementEquation(items);
  findings.push(...withFiscalYear(equationResult.findings, fiscalYear));

  const provenanceResult = derivedArtifactExists
    ? checkMofDerivedEventProvenance(derivedEvents, items)
    : {
      findings: [] as Finding[], checkedEvents: 0, expectedEvents: 0, actualEvents: 0,
      missingExpectedEvents: 0, duplicateOrUnexpectedEvents: 0, amountMismatches: 0,
      fiscalYearMismatches: 0, eventTypeMismatches: 0, sourceCardinalityErrors: 0,
    };
  findings.push(...withFiscalYear(provenanceResult.findings, fiscalYear));

  const parliamentaryResult = derivedArtifactExists
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

interface LinkPairMetrics {
  reviewYear: number; fiscalYear: number; linkGroupCount: number; summary: Record<string, unknown>;
  // production summaryのcore countをtyped fieldとしても持つ（review指摘: summary内に埋めない）
  linkedRsRecordCount: number; unlinkedRsRecordCount: number; unsupportedBudgetTypeRecordCount: number;
  unlinkedReasons: {
    unsupportedBudgetType: { recordCount: number; amountYen: number };
    missingLinkKey: { recordCount: number; amountYen: number; missingFieldCounts: Record<string, number> };
    validKeyNoMatch: { recordCount: number; amountYen: number };
  };
  jointMinistryFallback: {
    candidateCount: number; candidateAmountYen: number; exactReconciliationCount: number;
    candidates: JointMinistryFallbackCandidate[];
  };
  supplementalExactFallback: {
    parsedCandidateCount: number;
    exactReconciliationRecordCount: number; exactReconciliationGroupCount: number;
    safeExactRecordCount: number; safeExactGroupCount: number;
    p2cHistoricalScopeMismatchCount: number; explicitScopeConflictCount: number;
    candidates: SupplementalExactCandidate[];
  };
  productionPolicy: SupplementalExactProductionPolicyMetrics;
  difference: ReturnType<typeof analyzeLinkDifferenceTaxonomy>;
  multiProject: ReturnType<typeof analyzeMultiProjectGroups>;
}

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

      // Stage D: linkage diagnostics。D-1/D-2はP2 production昇格後、actual production
      // link membership（P1+P2）を基準にする（review指摘: 55_sonnet-p2-tier1-production-
      // activation-instructions.md）。D-5はshared coreのTier-1 selectorが期待するP2 setと
      // productionのrsMatchEvidenceが一致するかのinvariantを検査する
      const rsItemsForYear = rsItems.filter(r => r.fiscalYear === fiscalYear);
      const productionLinkedRecordIds = new Set(links.flatMap(l => l.rsRecordIds));
      const unlinkedReasons = classifyUnlinkedReasons(rsItemsForYear, productionLinkedRecordIds);
      const jointMinistry = diagnoseJointMinistryFallback(reviewYear, fiscalYear, mofItems, rsItemsForYear, links);
      findings.push(...jointMinistry.findings);
      const supplementalExact = diagnoseSupplementalExactFallback(reviewYear, fiscalYear, mofItems, rsItemsForYear);
      findings.push(...supplementalExact.findings);
      const productionPolicy = checkSupplementalExactProductionPolicy(reviewYear, fiscalYear, mofItems, rsItemsForYear, links);
      findings.push(...productionPolicy.findings);
      const difference = analyzeLinkDifferenceTaxonomy(links);
      const multiProject = analyzeMultiProjectGroups(links);

      // review指摘: taxonomy（診断側の再分類）とproduction summaryが同一run内で一致することを
      // invariantとして検査する（golden acceptanceではない。baseline driftとは別種）
      const taxonomyConsistencyFindings = checkLinkTaxonomyConsistency(unlinkedReasons, summary, rsItemsForYear.length, { reviewYear, fiscalYear });
      findings.push(...taxonomyConsistencyFindings);

      metrics.push({
        reviewYear, fiscalYear, linkGroupCount: links.length, summary,
        linkedRsRecordCount: summary.linkedRsRecordCount, unlinkedRsRecordCount: summary.unlinkedRsRecordCount,
        unsupportedBudgetTypeRecordCount: summary.unsupportedBudgetTypeRecordCount,
        unlinkedReasons: {
          unsupportedBudgetType: unlinkedReasons.unsupportedBudgetType,
          missingLinkKey: unlinkedReasons.missingLinkKey,
          validKeyNoMatch: unlinkedReasons.validKeyNoMatch,
        },
        jointMinistryFallback: {
          candidateCount: jointMinistry.candidates.length,
          candidateAmountYen: jointMinistry.candidates.reduce((s, c) => s + c.candidateRsAmountYen, 0),
          exactReconciliationCount: jointMinistry.candidates.filter(c => c.exactReconciliation).length,
          candidates: jointMinistry.candidates,
        },
        supplementalExactFallback: {
          parsedCandidateCount: supplementalExact.summary.parsedCandidateCount,
          exactReconciliationRecordCount: supplementalExact.summary.exactReconciliationRecordCount,
          exactReconciliationGroupCount: supplementalExact.summary.exactReconciliationGroupCount,
          safeExactRecordCount: supplementalExact.summary.safeExactRecordCount,
          safeExactGroupCount: supplementalExact.summary.safeExactGroupCount,
          p2cHistoricalScopeMismatchCount: supplementalExact.summary.p2cHistoricalScopeMismatchCount,
          explicitScopeConflictCount: supplementalExact.summary.explicitScopeConflictCount,
          candidates: supplementalExact.candidates,
        },
        productionPolicy: productionPolicy.metrics,
        difference, multiProject,
      });

      console.log(`  review-${reviewYear}×fy${fiscalYear}: unlinked理由 unsupported=${unlinkedReasons.unsupportedBudgetType.recordCount} ` +
        `missingKey=${unlinkedReasons.missingLinkKey.recordCount} validKeyNoMatch=${unlinkedReasons.validKeyNoMatch.recordCount} / ` +
        `taxonomy整合性 findings=${taxonomyConsistencyFindings.length} / ` +
        `jointMinistry候補=${jointMinistry.candidates.length}件 / ` +
        `差額分布 zero=${difference.exactZeroGroupCount} nonzero=${difference.nonZeroGroupCount} top10share=${(difference.top10Share * 100).toFixed(1)}% / ` +
        `multiProject groups=${multiProject.multiProjectGroupCount}/${multiProject.groupCount} max=${multiProject.maxProjectCountPerGroup}`);
      console.log(`  review-${reviewYear}×fy${fiscalYear}: supplementalExact parsed=${supplementalExact.summary.parsedCandidateCount} ` +
        `safe=${supplementalExact.summary.safeExactRecordCount}行/${supplementalExact.summary.safeExactGroupCount}group ` +
        `p2cMismatch=${supplementalExact.summary.p2cHistoricalScopeMismatchCount} explicitConflict=${supplementalExact.summary.explicitScopeConflictCount}`);
      console.log(`  review-${reviewYear}×fy${fiscalYear}: productionPolicy P2production=${productionPolicy.metrics.productionP2RecordCount}行/${productionPolicy.metrics.productionP2GroupCount}group ` +
        `(P2a=${productionPolicy.metrics.p2aProductionCount} P2b=${productionPolicy.metrics.p2bProductionCount}) ` +
        `withheldNonExact=${productionPolicy.metrics.p2bWithheldNonExactCount} expected/actual差findings=${productionPolicy.findings.length}`);

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

// ============================================================
// Stage E: Publish validation（public/data/v2）
// 原則: publish-v2.tsを再実行したり、compact*()/build*()等のPublish生成関数を
// 呼んで期待値を作らない。Normalized/Derived/public/data/v2をそれぞれ独立に読み、
// semantic invariantとして再検算する（lib/validation/publish.ts参照）。
// ============================================================

interface RsPublishMetrics {
  reviewYear: number; projectCount: number; indexProjectCount: number;
  budgetSummaries: { sourceCount: number; publishedCount: number };
  budgetItems: { sourceCount: number; publishedCount: number };
  indexBudgetSummary: { checkedProjects: number };
  falsePreservationChecked: number;
}
interface MofPublishMetrics {
  fiscalYear: number; sectionCount: number; recordCount: number; eventCount: number;
  checkedRecords: number; checkedEventGroups: number;
}
interface LinksPublishMetrics { reviewYear: number; fiscalYear: number; derivedCount: number; publishedCount: number }

function validatePublish(outputRoot: string, publicRoot: string): {
  findings: Finding[]; publish: { rs: RsPublishMetrics[]; mof: MofPublishMetrics[]; links: LinksPublishMetrics[]; rootManifest: { checkedProducts: number } };
} {
  const findings: Finding[] = [];
  const v2Root = path.join(publicRoot, 'data', 'v2');
  const rsMetrics: RsPublishMetrics[] = [];
  const mofMetrics: MofPublishMetrics[] = [];
  const linksMetrics: LinksPublishMetrics[] = [];
  const rsIndexesForRoot: { reviewYear: number; projectCount: number }[] = [];
  const mofIndexesForRoot: { fiscalYear: number; sectionCount: number }[] = [];
  const linkManifestsForRoot: { reviewYear: number; fiscalYear: number; linkGroupCount: number; projectCount: number; sectionCount: number }[] = [];

  // --- E-1: RS ---
  for (const reviewYear of REVIEW_YEARS) {
    const normDir = path.join(outputRoot, 'normalized', 'rs', `review-${reviewYear}`);
    const projectsPath = path.join(normDir, 'projects.jsonl');
    if (!fs.existsSync(projectsPath)) continue;
    const normProjects = readJsonl<RsProject>(projectsPath);
    if (normProjects.length === 0) continue;

    const rsOutDir = path.join(v2Root, 'rs', `review-${reviewYear}`);
    const manifestPath = path.join(rsOutDir, 'manifest.json');
    const indexPath = path.join(rsOutDir, 'index.json.gz');
    findings.push(...checkArtifactExists('rs-publish-artifact-presence', manifestPath, { reviewYear }));
    findings.push(...checkArtifactExists('rs-publish-artifact-presence', indexPath, { reviewYear }));

    const index = readGzipJson<RsPublishIndex>(indexPath);
    const manifest = readJsonFile<RsPublishManifest>(manifestPath);
    findings.push(...checkRsProjectCounts(reviewYear, normProjects, index, manifest));

    const projectIds = new Set(normProjects.map(p => p.projectId));
    const readCoreShard = (shard: string) => readGzipJson<Record<string, unknown>>(path.join(rsOutDir, 'core', `${shard}.json.gz`));
    const readContextShard = (shard: string) => readGzipJson<Record<string, unknown>>(path.join(rsOutDir, 'context', `${shard}.json.gz`));
    const readSpendingShard = (shard: string) => readGzipJson<Record<string, unknown>>(path.join(rsOutDir, 'spending', `${shard}.json.gz`));
    const shardOf = (projectId: string) => independentRsShard(projectId);
    const readProfileShard = (profile: 'core' | 'context' | 'spending', shard: string) =>
      profile === 'core' ? readCoreShard(shard) : profile === 'context' ? readContextShard(shard) : readSpendingShard(shard);

    findings.push(...checkRsShardReferentialIntegrity(reviewYear, index, readProfileShard));

    const normSummaries = readJsonl<RsBudgetSummaryRecord>(path.join(normDir, 'budget-summaries.jsonl'));
    const summaryResult = checkRsBudgetSummaryPreservation(reviewYear, normSummaries, projectIds, readCoreShard, shardOf);
    findings.push(...summaryResult.findings);

    const normItems = readJsonl<RsBudgetItemRecordV2>(path.join(normDir, 'budget-items.jsonl'));
    const itemResult = checkRsBudgetItemPreservation(reviewYear, normItems, projectIds, readContextShard, shardOf);
    findings.push(...itemResult.findings);

    const falseResult = checkRsFalsePreservation(reviewYear, normProjects, index, readCoreShard, shardOf);
    findings.push(...falseResult.findings);

    const indexBudgetResult = checkRsIndexBudgetSummaryReconstruction(reviewYear, normSummaries, index);
    findings.push(...indexBudgetResult.findings);

    if (manifest?.normalizedRecordCounts) {
      if (manifest.normalizedRecordCounts.budgetSummaries !== normSummaries.length) {
        findings.push({
          severity: 'error', check: 'rs-publish-manifest-record-counts', category: 'invariant', scope: { reviewYear },
          message: `manifest.normalizedRecordCounts.budgetSummaries(${manifest.normalizedRecordCounts.budgetSummaries})とNormalized件数(${normSummaries.length})が不一致`,
        });
      }
      if (manifest.normalizedRecordCounts.budgetItems !== normItems.length) {
        findings.push({
          severity: 'error', check: 'rs-publish-manifest-record-counts', category: 'invariant', scope: { reviewYear },
          message: `manifest.normalizedRecordCounts.budgetItems(${manifest.normalizedRecordCounts.budgetItems})とNormalized件数(${normItems.length})が不一致`,
        });
      }
    }

    console.log(`  review-${reviewYear}: Publish(RS) — projects=${index?.projectCount ?? 0} budgetSummaries checked=${summaryResult.sourceCount} findings=${summaryResult.findings.length} ` +
      `budgetItems checked=${itemResult.sourceCount} findings=${itemResult.findings.length} falsePreservation checked=${falseResult.checked} findings=${falseResult.findings.length}`);

    if (index) rsIndexesForRoot.push({ reviewYear, projectCount: index.projectCount });
    rsMetrics.push({
      reviewYear, projectCount: normProjects.length, indexProjectCount: index?.projectCount ?? 0,
      budgetSummaries: { sourceCount: summaryResult.sourceCount, publishedCount: summaryResult.publishedCount },
      budgetItems: { sourceCount: itemResult.sourceCount, publishedCount: itemResult.publishedCount },
      indexBudgetSummary: { checkedProjects: indexBudgetResult.checkedProjects },
      falsePreservationChecked: falseResult.checked,
    });
  }

  // --- E-2: MOF ---
  for (const fiscalYear of FISCAL_YEARS) {
    const normDir = path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`);
    const droot = path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`);
    const itemsPath = path.join(normDir, 'budget-items.jsonl');
    if (!fs.existsSync(itemsPath)) continue;
    const normItems = readJsonl<MofBudgetItemRecord>(itemsPath);
    if (normItems.length === 0) continue;

    const mofOutDir = path.join(v2Root, 'mof', `fy${fiscalYear}`);
    const manifestPath = path.join(mofOutDir, 'manifest.json');
    const indexPath = path.join(mofOutDir, 'index.json.gz');
    findings.push(...checkArtifactExists('mof-publish-artifact-presence', manifestPath, { fiscalYear }));
    findings.push(...checkArtifactExists('mof-publish-artifact-presence', indexPath, { fiscalYear }));

    const derivedSections = readJsonl<MofDerivedSection>(path.join(droot, 'sections.jsonl'));
    const derivedEvents = readJsonl<MofDerivedBudgetEvent>(path.join(droot, 'budget-events.jsonl'));
    const index = readGzipJson<MofPublishIndex>(indexPath);
    const manifest = readJsonFile<MofPublishManifest>(manifestPath);

    findings.push(...checkMofSectionCounts(fiscalYear, normItems, derivedSections, derivedEvents, index, manifest));
    findings.push(...checkMofSectionSemantics(fiscalYear, derivedSections, index));

    const readSectionDetail = (sectionId: string) => {
      const shard = sectionId.slice(7, 9);
      const shardData = readGzipJson<Record<string, MofSectionDetail>>(path.join(mofOutDir, 'sections', `${shard}.json.gz`));
      return shardData?.[sectionId] ?? null;
    };
    const recordResult = checkMofDetailRecords(fiscalYear, normItems, derivedSections, readSectionDetail);
    findings.push(...recordResult.findings);
    const eventResult = checkMofDetailEventAggregation(fiscalYear, derivedEvents, derivedSections, normItems, readSectionDetail);
    findings.push(...eventResult.findings);

    console.log(`  fy${fiscalYear}: Publish(MOF) — sections=${index?.sectionCount ?? 0} detail records checked=${recordResult.checkedRecords} findings=${recordResult.findings.length} ` +
      `event groups checked=${eventResult.checkedGroups} findings=${eventResult.findings.length}`);

    if (index) mofIndexesForRoot.push({ fiscalYear, sectionCount: index.sectionCount });
    mofMetrics.push({
      fiscalYear, sectionCount: derivedSections.length, recordCount: normItems.length, eventCount: derivedEvents.length,
      checkedRecords: recordResult.checkedRecords, checkedEventGroups: eventResult.checkedGroups,
    });
  }

  // --- E-3: standalone links ---
  for (const reviewYear of REVIEW_YEARS) {
    for (const fiscalYear of FISCAL_YEARS) {
      if (fiscalYear > reviewYear) continue;
      const derivedLinksPath = path.join(outputRoot, 'derived', 'links', `mof-rs-review-${reviewYear}-fy${fiscalYear}.jsonl`);
      if (!fs.existsSync(derivedLinksPath)) continue;
      const derivedLinks = readJsonl<MofRsProjectLinkGroup>(derivedLinksPath);

      const linksOutDir = path.join(v2Root, 'links', `review-${reviewYear}-fy${fiscalYear}`);
      const manifestPath = path.join(linksOutDir, 'manifest.json');
      const linksPath = path.join(linksOutDir, 'links.json.gz');
      findings.push(...checkArtifactExists('links-publish-artifact-presence', manifestPath, { reviewYear, fiscalYear }));
      findings.push(...checkArtifactExists('links-publish-artifact-presence', linksPath, { reviewYear, fiscalYear }));

      const published = readGzipJson<{ links: PublishedLink[] }>(linksPath);
      const manifest = readJsonFile<LinksPublishManifest>(manifestPath);
      findings.push(...checkLinksPublishCounts(reviewYear, fiscalYear, derivedLinks, published, manifest));
      findings.push(...checkLinksSemanticEquality(reviewYear, fiscalYear, derivedLinks, published));

      const normMofItems = readJsonl<MofBudgetItemRecord>(path.join(outputRoot, 'normalized', 'mof', `fy${fiscalYear}`, 'budget-items.jsonl'));
      const derivedSections = readJsonl<MofDerivedSection>(path.join(outputRoot, 'derived', 'mof', `fy${fiscalYear}`, 'sections.jsonl'));
      findings.push(...checkLinksSectionIdsReconstruction(reviewYear, fiscalYear, derivedLinks, normMofItems, derivedSections, published));
      findings.push(...checkLinksManifestSetCounts(reviewYear, fiscalYear, published, manifest));

      console.log(`  review-${reviewYear}×fy${fiscalYear}: Publish(links) — derived=${derivedLinks.length} published=${published?.links.length ?? 0}`);

      if (manifest) linkManifestsForRoot.push({ reviewYear, fiscalYear, linkGroupCount: manifest.linkGroupCount, projectCount: manifest.projectCount, sectionCount: manifest.sectionCount });
      linksMetrics.push({ reviewYear, fiscalYear, derivedCount: derivedLinks.length, publishedCount: published?.links.length ?? 0 });
    }
  }

  // --- root manifest ---
  const rootManifest = readJsonFile<RootManifest>(path.join(v2Root, 'manifest.json'));
  findings.push(...checkArtifactExists('root-manifest-presence', path.join(v2Root, 'manifest.json'), {}));
  const rootResult = checkRootManifestConsistency(rootManifest, rsIndexesForRoot, mofIndexesForRoot, linkManifestsForRoot);
  findings.push(...rootResult.findings);

  return { findings, publish: { rs: rsMetrics, mof: mofMetrics, links: linksMetrics, rootManifest: { checkedProducts: rootResult.checkedProducts } } };
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

  const publicRoot = 'public';
  const { findings: publishFindings, publish: publishMetrics } = validatePublish(outputRoot, publicRoot);
  allFindings.push(...publishFindings);

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
      publish: publishMetrics,
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
