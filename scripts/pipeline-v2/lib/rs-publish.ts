/**
 * RS公開データ（public/data/v2/rs/review-{year}）のcompact変換ロジック。
 * 参照実装: Python版 pipeline_v2/publish.py（_compact_*・_pick・_strip_rs_common）を
 * 土台に、以下をユーザー指示（2026-09-20フィールドレビュー）に合わせて拡張している。
 *
 *  - indexに検索・filter・sortを完結させるための情報（予算額・MOF link有無・
 *    Funding Graph診断・context件数）を持たせる（詳細shardを読ませない）。
 *  - coreのFunding Graphは、Sankey専用形式へ変換せず一般有向グラフの表現
 *    （nodes/semanticEdges/rootNodeIds/externalRootBlockIds/orphanBlockIds/
 *    cyclicComponents/duplicateRelationPairs等）をそのまま保持する。
 *  - coreにreview-sheet由来のスナップショット（概算要求・反映額等）を追加する。
 *
 * droppedFields(): Normalized/Derivedの各レコード型が持つ全フィールドのうち、
 * publicのどのcompact関数にも現れないものを機械的に検出する（no silent dropの
 * 思想をpublish層でも維持するための一覧化。削ること自体は問題ないが、
 * 何を削ったかを常に把握できる状態にする）。
 */
import { pick, stripRsCommon, meaningful } from './publish-common';
import type {
  RsBudgetItemRecordV2, RsBudgetSummaryRecord, RsFundingGraph, RsPolicyLawRelation, RsSubsidyRule,
  RsProjectRelation, RsLogicNode, RsLogicObservation, RsLogicRelation, RsEvaluation, RsProjectNote,
  RsRecipientRecord, RsContractRecord, RsExpenseUse, RsMultiYearContract, RsIndirectExpenseRecord,
  RsReviewSheetRecord, MofRsProjectLinkGroup,
} from '../types';
import type { RsProject } from './rs-projects';

const PROJECT_KEYS = [
  'projectId', 'projectName', 'ministry', 'bureau', 'department', 'division', 'office', 'team', 'unit',
  'accountClass', 'majorExpense', 'purpose', 'currentIssues', 'overview', 'overviewUrl', 'startYear', 'endYear',
  'noPlannedEnd', 'projectCategory', 'legacyProjectNumber', 'officialProjectUrl', 'implementationMethods', 'note',
] as const satisfies readonly (keyof RsProject)[];

export function compactRsProject(row: RsProject): Record<string, unknown> {
  return pick(row as unknown as Record<string, unknown>, PROJECT_KEYS as readonly string[]);
}

/**
 * review-sheet由来のスナップショット（coreに載せる）。同一事業に様式1・様式2が
 * 複数年またがって存在しうるが、reviewYearに一致する直近1件を代表として使う
 * （断定せず、複数件ある場合は全件`all`にも残す）。
 */
export function compactReviewSheetSnapshot(sheetRows: RsReviewSheetRecord[]): Record<string, unknown> | null {
  if (sheetRows.length === 0) return null;
  const primary = sheetRows.find(r => r.sheetForm === 'form1') ?? sheetRows[0];
  const primaryOut = stripRsCommon(primary as unknown as Record<string, unknown>, new Set(['recordId']));
  if (sheetRows.length === 1) return primaryOut;
  return { ...primaryOut, allSheetRows: sheetRows.map(r => stripRsCommon(r as unknown as Record<string, unknown>, new Set(['recordId']))) };
}

const SUMMARY_KEYS = ['account', 'accountClass', 'accountType', 'subAccount', 'changeReason', 'note', 'specialNotes', 'executionRateRaw'] as const;

export function compactRsBudgetSummary(row: RsBudgetSummaryRecord): Record<string, unknown> {
  const amounts = Object.fromEntries(Object.entries(row.amounts).filter(([, v]) => v !== null));
  return {
    fiscalYear: row.fiscalYear,
    scopeLevel: row.scopeLevel,
    amounts,
    ...pick(row as unknown as Record<string, unknown>, SUMMARY_KEYS as readonly string[]),
  };
}

const BUDGET_ITEM_KEYS = [
  'recordId', 'fiscalYear', 'requestFiscalYear', 'budgetType', 'accountType', 'accountClass', 'account', 'subAccount',
  'budgetMinistry', 'organizationOrAccount', 'sectionName', 'subItemName', 'budgetAmountYen', 'nextYearRequestYen', 'note', 'supplementalInfo',
] as const satisfies readonly (keyof RsBudgetItemRecordV2)[];

export function compactRsBudgetItem(row: RsBudgetItemRecordV2): Record<string, unknown> {
  return pick(row as unknown as Record<string, unknown>, BUDGET_ITEM_KEYS as readonly string[]);
}

const GRAPH_NODE_KEYS = ['nodeId', 'nodeType', 'blockId', 'name', 'nameVariants', 'roles', 'totalAmountValuesYen', 'recipientCountValues', 'synthetic', 'syntheticReason'] as const;
const GRAPH_EDGE_KEYS = ['edgeId', 'sourceNodeId', 'targetNodeId', 'evidenceCount', 'evidenceRelationIds', 'noteVariants', 'fromResponsibleOrganizationValues', 'amountYen', 'amountStatus', 'sourceNameVariants', 'targetNameVariants'] as const;
const GRAPH_METRICS_KEYS = [
  'blockCount', 'nodeCount', 'semanticEdgeCount', 'relationEvidenceCount', 'hasCycle', 'cyclicComponents',
  'weakComponentCount', 'weakComponentSizes', 'maxOutDegree', 'maxInDegree', 'orphanBlockIds', 'externalRootBlockIds',
  'duplicateRelationPairCount', 'duplicateRelationEvidenceExtraCount', 'indirectExpenseCount', 'sameNameMultipleBlocks',
  'hasResponsibleOrganizationRoot', 'responsibleOrganizationNodeId', 'rootNodeIds', 'unresolvedRelationEvidenceCount',
] as const;

/** pick()の`meaningful()`は空配列・空オブジェクトを「無い」として落とすため、Funding Graphの
 *  診断フィールド（例: cyclicComponents=[]は「循環無し」という確定した検証結果であり、
 *  フィールド自体が無いのとは違う）には使えない。この3種類はキーをそのまま複写する */
function pickAlways<T extends Record<string, unknown>>(row: T, keys: readonly (keyof T & string)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row[key];
  return out;
}

/**
 * Funding Graphは一般有向グラフの表現のまま保持する（Sankey専用形式への変換はUI側の責務）。
 * 診断情報（rootNodeIds/externalRootBlockIds/orphanBlockIds/cyclicComponents等）・
 * unresolvedRelation・duplicateRelationPairsの実体もそのまま残す。
 */
export function compactRsFundingGraph(graph: RsFundingGraph): Record<string, unknown> {
  return {
    nodes: graph.nodes.map(n => pickAlways(n as unknown as Record<string, unknown>, GRAPH_NODE_KEYS as readonly string[])),
    edges: graph.semanticEdges.map(e => pickAlways(e as unknown as Record<string, unknown>, GRAPH_EDGE_KEYS as readonly string[])),
    metrics: pickAlways(graph.metrics as unknown as Record<string, unknown>, GRAPH_METRICS_KEYS as readonly string[]),
    unresolvedRelationIds: graph.unresolvedRelationIds,
    unresolvedRelationDetails: graph.unresolvedRelationDetails,
    duplicateRelationPairs: graph.duplicateRelationPairs,
  };
}

export function compactPolicy(row: RsPolicyLawRelation): Record<string, unknown> | null {
  const out = stripRsCommon(row as unknown as Record<string, unknown>, new Set(['recordId']));
  if (!['policy', 'measure', 'lawName', 'planName', 'policyMeasureUrl', 'planUrl'].some(k => meaningful(out[k]))) return null;
  return out;
}

export function compactSubsidy(row: RsSubsidyRule): Record<string, unknown> | null {
  if (row.hasRule === false && !['target', 'rateRaw', 'upperLimitRaw', 'url'].some(k => meaningful((row as unknown as Record<string, unknown>)[k]))) return null;
  return stripRsCommon(row as unknown as Record<string, unknown>, new Set(['recordId']));
}

export function compactProjectRelation(row: RsProjectRelation): Record<string, unknown> | null {
  if (row.hasRelation === false && !row.relatedProjectId) return null;
  return stripRsCommon(row as unknown as Record<string, unknown>, new Set(['recordId']));
}

export function compactLogicNode(row: RsLogicNode): Record<string, unknown> {
  return stripRsCommon(row as unknown as Record<string, unknown>);
}

export function compactLogicObservation(row: RsLogicObservation): Record<string, unknown> {
  return stripRsCommon(row as unknown as Record<string, unknown>, new Set(['observationId']));
}

export function compactLogicRelation(row: RsLogicRelation): Record<string, unknown> | null {
  if (row.hasRelation === false && !row.targetLogicNodeId) return null;
  return stripRsCommon(row as unknown as Record<string, unknown>);
}

export function compactEvaluation(row: RsEvaluation): Record<string, unknown> {
  return stripRsCommon(row as unknown as Record<string, unknown>, new Set(['recordId']));
}

export function compactNote(row: RsProjectNote): Record<string, unknown> | null {
  if (!row.note) return null;
  return { note: row.note };
}

const RECIPIENT_KEYS = ['recipientId', 'blockId', 'recipientName', 'corporateNumber', 'corporateType', 'location', 'otherRecipient', 'totalAmountValuesYen'] as const satisfies readonly (keyof RsRecipientRecord)[];
export function compactRecipient(row: RsRecipientRecord): Record<string, unknown> {
  return pick(row as unknown as Record<string, unknown>, RECIPIENT_KEYS as readonly string[]);
}

const CONTRACT_KEYS = ['contractId', 'blockId', 'recipientId', 'recipientNameRaw', 'corporateNumberRaw', 'amountYen', 'summary', 'method', 'methodDetail', 'bidderCount', 'winningRate', 'singleBidReason', 'otherContract'] as const satisfies readonly (keyof RsContractRecord)[];
export function compactContract(row: RsContractRecord): Record<string, unknown> {
  return pick(row as unknown as Record<string, unknown>, CONTRACT_KEYS as readonly string[]);
}

const EXPENSE_USE_KEYS = ['expenseUseId', 'blockId', 'recipientName', 'corporateNumber', 'expenseItem', 'use', 'amountYen', 'contractSummary'] as const satisfies readonly (keyof RsExpenseUse)[];
export function compactExpenseUse(row: RsExpenseUse): Record<string, unknown> {
  return pick(row as unknown as Record<string, unknown>, EXPENSE_USE_KEYS as readonly string[]);
}

const MULTI_CONTRACT_KEYS = ['contractId', 'blockId', 'recipientName', 'corporateNumber', 'corporateType', 'location', 'amountYen', 'summary', 'method', 'methodDetail', 'bidderCount', 'winningRate', 'singleBidReason'] as const satisfies readonly (keyof RsMultiYearContract)[];
export function compactMultiYearContract(row: RsMultiYearContract): Record<string, unknown> | null {
  if (!row.hasContract) return null;
  return pick(row as unknown as Record<string, unknown>, MULTI_CONTRACT_KEYS as readonly string[]);
}

const INDIRECT_KEYS = ['expenseId', 'categoryRaw', 'item', 'amountYen'] as const satisfies readonly (keyof RsIndirectExpenseRecord)[];
export function compactIndirectExpense(row: RsIndirectExpenseRecord): Record<string, unknown> {
  return pick(row as unknown as Record<string, unknown>, INDIRECT_KEYS as readonly string[]);
}

/**
 * MOF 1項目 ≠ RS 1事業であり、1 link groupが複数のRS事業を束ねることがある
 * （2026-09-20指摘）。projectIds/projectCountを落とすと、project単体のcoreへ
 * 埋め込んだmofAmountYen/rsAmountYenが「そのprojectだけの金額」なのか
 * 「同じlink groupを共有する複数事業の合計」なのかUI側で誤読しうるため、
 * project bundleへ埋め込む射影でもprojectIds/projectCountを必ず保持する。
 * matchMethod/naturalKeyは内部実装の詳細なので落としてよい。mofRecordIds/
 * rsRecordIdsは原典trace UIを作る段階まで不要なため落とす（standalone
 * links productの生データ側には残っているので、必要になれば復元できる）。
 */
const LINK_KEYS = ['linkId', 'phase', 'revision', 'projectIds', 'mofAmountYen', 'rsAmountYen', 'differenceYen'] as const;
export function compactMofRsLink(link: MofRsProjectLinkGroup): Record<string, unknown> {
  return { ...pick(link as unknown as Record<string, unknown>, LINK_KEYS as readonly string[]), projectCount: link.projectIds.length };
}

/**
 * publish層で「どのフィールドを落としたか」を機械的に一覧化する
 * （no silent dropの思想をpublish層でも維持するため。削ること自体は問題ない）。
 */
export interface DroppedFieldsReport {
  dataset: string;
  sourceFields: string[];
  keptFields: string[];
  droppedFields: string[];
}

function diffFields(dataset: string, sourceFields: readonly string[], keptFields: readonly string[]): DroppedFieldsReport {
  const kept = new Set(keptFields);
  return { dataset, sourceFields: [...sourceFields], keptFields: [...keptFields], droppedFields: sourceFields.filter(f => !kept.has(f)) };
}

const RS_BASE_FIELDS = [
  'schemaVersion', 'sourceSystem', 'sourceYear', 'reviewYear', 'sheetType', 'projectId', 'projectIdRaw', 'projectName',
  'policyMinistry', 'ministry', 'bureau', 'department', 'division', 'office', 'team', 'unit', 'ministryOrderRaw',
] as const;

export function computeDroppedFieldsReport(): DroppedFieldsReport[] {
  return [
    diffFields('projects', [...RS_BASE_FIELDS, 'recordType', 'recordId', 'projectIdRawVariants', 'sources', 'sourceKinds', ...PROJECT_KEYS], PROJECT_KEYS),
    diffFields('budget-summaries', [...RS_BASE_FIELDS, 'recordType', 'recordId', 'fiscalYear', 'scopeLevel', 'amounts', 'extraFields', 'source', ...SUMMARY_KEYS], ['fiscalYear', 'scopeLevel', 'amounts', ...SUMMARY_KEYS]),
    diffFields('budget-items', [...RS_BASE_FIELDS, 'recordType', 'mofNameNaturalKey', 'ministry', 'extraFields', 'source', ...BUDGET_ITEM_KEYS], BUDGET_ITEM_KEYS),
    diffFields('funding-graph.nodes', ['nodeId', 'nodeType', 'blockId', 'name', 'nameVariants', 'roles', 'recipientCountValues', 'totalAmountValuesYen', 'summaryRowCount', 'evidenceRowIds', 'synthetic', 'syntheticReason'], GRAPH_NODE_KEYS),
    diffFields('funding-graph.edges', ['edgeId', 'sourceNodeId', 'targetNodeId', 'amountYen', 'amountStatus', 'evidenceRelationIds', 'evidenceCount', 'noteVariants', 'sourceNameVariants', 'targetNameVariants', 'fromResponsibleOrganizationValues'], GRAPH_EDGE_KEYS),
    diffFields('recipients', [...RS_BASE_FIELDS, 'recordType', ...RECIPIENT_KEYS, 'evidenceRowIds', 'sources', 'extraFields'], RECIPIENT_KEYS),
    diffFields('contracts', [...RS_BASE_FIELDS, 'recordType', ...CONTRACT_KEYS, 'recipientLinkMethod', 'sourceRowId', 'extraFields', 'source'], CONTRACT_KEYS),
    diffFields('expense-uses', [...RS_BASE_FIELDS, 'recordType', ...EXPENSE_USE_KEYS, 'extraFields', 'source'], EXPENSE_USE_KEYS),
    diffFields('multi-year-contracts', [...RS_BASE_FIELDS, 'recordType', ...MULTI_CONTRACT_KEYS, 'otherContractRaw', 'hasContract', 'extraFields', 'source'], MULTI_CONTRACT_KEYS),
    diffFields('indirect-expenses', [...RS_BASE_FIELDS, 'recordType', ...INDIRECT_KEYS, 'amountRaw', 'sourceRowId', 'extraFields', 'source'], INDIRECT_KEYS),
    diffFields('mof-rs-links', ['schemaVersion', 'recordType', 'matchMethod', 'naturalKey', 'mofRecordIds', 'rsRecordIds', 'rsMatchEvidence', ...LINK_KEYS], LINK_KEYS),
  ];
}
