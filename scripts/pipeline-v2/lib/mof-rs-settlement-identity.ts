/**
 * 既存のMOF↔RS formal budget link（initial/supplement）を根拠に、settlement-items.jsonl
 * （itemNaturalKey単位の決算集約、Phase A）へderived層で接続する（Phase B1）。
 *
 * 設計: docs/chats/20260923_1430_予算現額比較検証/v2_settlement_linkage_design.md
 *
 * 方針:
 * - RS↔決算の新規の名称マッチ・金額マッチは一切行わない。既存のmof-rs-links.tsが
 *   生成したlink group（mofRecordIds経由でitemNaturalKeyへ辿れる）だけを根拠にする。
 * - itemNaturalKeyのexact join以外は行わない。名称fallbackはこのPhaseではやらない。
 * - 1 link groupのmofRecordIdsが複数の異なるitemNaturalKeyにまたがる場合
 *   （`spans_multiple_items`）、根拠なく1つの決算itemへ金額配賦しない。診断へ残し、
 *   relationを作らない。
 * - 同一itemNaturalKeyへ、initial/複数supplementの複数link groupから同じ/別のRS事業が
 *   到達する場合、relationはitemNaturalKey単位に集約する（1 settlement item = 1
 *   relation）。projectIdsは重複させず、どのlink group（phase/revision/matchMethod）を
 *   根拠にしたかはsourceLinksとして全て保持する。
 *   （これをしないと、同一決算itemの金額が複数relationに重複計上されうる）
 */
import type { MofAccountType, MofBudgetItemRecord, MofRsGroupMatchMethod, MofRsProjectLinkGroup } from '../types';
import type { SettlementItemRecord } from './mof-settlement-items';

export interface MofRsSettlementSourceLink {
  linkId: string;
  phase: 'initial' | 'supplement';
  revision: number | null;
  matchMethod: MofRsGroupMatchMethod;
  projectIds: string[];
}

export interface MofRsSettlementIdentityRelation {
  schemaVersion: number;
  recordType: 'mof_rs_settlement_identity_relation';
  reviewYear: number;
  fiscalYear: number;
  accountType: MofAccountType;
  itemNaturalKey: string;
  projectIds: string[];
  sourceLinks: MofRsSettlementSourceLink[];

  settlementSourceRecordCount: number;
  budgetAppropriationYen: number | null;
  currentBudgetYen: number | null;
  spentYen: number | null;
  carryoverOutYen: number | null;
  unusedYen: number | null;
}

export type MofRsSettlementUnresolvedReason = 'no_mof_item_key' | 'spans_multiple_items' | 'no_exact_settlement_item';

export interface MofRsSettlementUnresolvedLinkGroup {
  linkId: string;
  reason: MofRsSettlementUnresolvedReason;
  itemNaturalKeyCandidates: string[];
  projectIds: string[];
}

/**
 * settlement-items.jsonl（Phase A成果物）の可用性。
 * - artifact_missing: derive-mof.tsが当該年度でまだ実行されていない（ファイル自体が無い）
 * - no_settlement_rows: ファイルはあるが決算行が0件の年度（例: 決算未確定のFY）
 * - available: 決算行がありexact joinを試みられる状態
 * artifact_missing/no_settlement_rowsを「exact joinに失敗した(no_exact_settlement_item)」
 * と混同すると、「決算データが無い」と「決算データはあるがキーが不一致」を区別できなくなる。
 */
export type SettlementDataStatus = 'artifact_missing' | 'no_settlement_rows' | 'available';

export interface MofRsSettlementDiagnostics {
  schemaVersion: number;
  reviewYear: number;
  fiscalYear: number;
  settlementDataStatus: SettlementDataStatus;
  sourceLinkGroupCount: number;
  exactJoinLinkGroupCount: number;
  spansMultipleItemsLinkGroupCount: number;
  unmatchedSettlementLinkGroupCount: number;
  noMofItemKeyLinkGroupCount: number;
  relationCount: number;
  multiSourceSettlementItemCount: number;
  linkedProjectCount: number;
  accountTypeCounts: Record<string, number>;
  unresolvedLinkGroups: MofRsSettlementUnresolvedLinkGroup[];
}

interface Resolution {
  link: MofRsProjectLinkGroup;
  itemNaturalKey: string;
  accountType: MofAccountType;
}

export function buildSettlementIdentityRelations(
  mofRows: MofBudgetItemRecord[],
  linkGroups: MofRsProjectLinkGroup[],
  settlementItems: SettlementItemRecord[],
  reviewYear: number,
  fiscalYear: number,
  settlementDataStatus: SettlementDataStatus,
): { relations: MofRsSettlementIdentityRelation[]; diagnostics: MofRsSettlementDiagnostics } {
  if (settlementDataStatus !== 'available') {
    return {
      relations: [],
      diagnostics: {
        schemaVersion: 1, reviewYear, fiscalYear, settlementDataStatus,
        sourceLinkGroupCount: linkGroups.length,
        exactJoinLinkGroupCount: 0,
        spansMultipleItemsLinkGroupCount: 0,
        unmatchedSettlementLinkGroupCount: 0,
        noMofItemKeyLinkGroupCount: 0,
        relationCount: 0,
        multiSourceSettlementItemCount: 0,
        linkedProjectCount: 0,
        accountTypeCounts: {},
        unresolvedLinkGroups: [],
      },
    };
  }

  const mofItemByRecordId = new Map<string, { itemNaturalKey: string; accountType: MofAccountType }>();
  for (const r of mofRows) mofItemByRecordId.set(r.recordId, { itemNaturalKey: r.itemNaturalKey, accountType: r.accountType });
  const settlementByKey = new Map(settlementItems.map(s => [s.itemNaturalKey, s]));

  const unresolvedLinkGroups: MofRsSettlementUnresolvedLinkGroup[] = [];
  let noMofItemKeyLinkGroupCount = 0;
  let spansMultipleItemsLinkGroupCount = 0;
  let unmatchedSettlementLinkGroupCount = 0;

  const resolvedByItemKey = new Map<string, Resolution[]>();

  for (const link of linkGroups) {
    const itemInfos = link.mofRecordIds
      .map(id => mofItemByRecordId.get(id))
      .filter((x): x is { itemNaturalKey: string; accountType: MofAccountType } => !!x);
    if (itemInfos.length === 0) {
      noMofItemKeyLinkGroupCount++;
      unresolvedLinkGroups.push({ linkId: link.linkId, reason: 'no_mof_item_key', itemNaturalKeyCandidates: [], projectIds: link.projectIds });
      continue;
    }
    const distinctKeys = [...new Set(itemInfos.map(i => i.itemNaturalKey))].sort();
    if (distinctKeys.length > 1) {
      spansMultipleItemsLinkGroupCount++;
      unresolvedLinkGroups.push({ linkId: link.linkId, reason: 'spans_multiple_items', itemNaturalKeyCandidates: distinctKeys, projectIds: link.projectIds });
      continue;
    }
    const itemNaturalKey = distinctKeys[0];
    const list = resolvedByItemKey.get(itemNaturalKey) ?? [];
    list.push({ link, itemNaturalKey, accountType: itemInfos[0].accountType });
    resolvedByItemKey.set(itemNaturalKey, list);
  }

  const relations: MofRsSettlementIdentityRelation[] = [];
  const accountTypeCounts: Record<string, number> = {};
  const joinedProjectIds = new Set<string>();
  const joinedSettlementKeys = new Set<string>();

  for (const itemNaturalKey of [...resolvedByItemKey.keys()].sort()) {
    const resolutions = resolvedByItemKey.get(itemNaturalKey)!;
    const settlementItem = settlementByKey.get(itemNaturalKey);
    if (!settlementItem) {
      unmatchedSettlementLinkGroupCount += resolutions.length;
      for (const { link } of resolutions) {
        unresolvedLinkGroups.push({ linkId: link.linkId, reason: 'no_exact_settlement_item', itemNaturalKeyCandidates: [itemNaturalKey], projectIds: link.projectIds });
      }
      continue;
    }

    const accountType = resolutions[0].accountType;
    accountTypeCounts[accountType] = (accountTypeCounts[accountType] ?? 0) + 1;
    joinedSettlementKeys.add(itemNaturalKey);

    const projectIds = new Set<string>();
    const sourceLinks: MofRsSettlementSourceLink[] = [];
    for (const { link } of [...resolutions].sort((a, b) => (a.link.linkId < b.link.linkId ? -1 : a.link.linkId > b.link.linkId ? 1 : 0))) {
      for (const p of link.projectIds) { projectIds.add(p); joinedProjectIds.add(p); }
      sourceLinks.push({ linkId: link.linkId, phase: link.phase, revision: link.revision, matchMethod: link.matchMethod, projectIds: link.projectIds });
    }

    relations.push({
      schemaVersion: 1,
      recordType: 'mof_rs_settlement_identity_relation',
      reviewYear,
      fiscalYear,
      accountType,
      itemNaturalKey,
      projectIds: [...projectIds].sort(),
      sourceLinks,
      settlementSourceRecordCount: settlementItem.sourceRecordCount,
      budgetAppropriationYen: settlementItem.budgetAppropriationYen,
      currentBudgetYen: settlementItem.currentBudgetYen,
      spentYen: settlementItem.spentYen,
      carryoverOutYen: settlementItem.carryoverOutYen,
      unusedYen: settlementItem.unusedYen,
    });
  }

  unresolvedLinkGroups.sort((a, b) => (a.linkId < b.linkId ? -1 : a.linkId > b.linkId ? 1 : 0));

  const multiSourceSettlementItemCount = [...joinedSettlementKeys]
    .filter(k => (settlementByKey.get(k)?.sourceRecordCount ?? 0) > 1).length;

  const diagnostics: MofRsSettlementDiagnostics = {
    schemaVersion: 1,
    reviewYear,
    fiscalYear,
    settlementDataStatus: 'available',
    sourceLinkGroupCount: linkGroups.length,
    exactJoinLinkGroupCount: linkGroups.length - noMofItemKeyLinkGroupCount - spansMultipleItemsLinkGroupCount - unmatchedSettlementLinkGroupCount,
    spansMultipleItemsLinkGroupCount,
    unmatchedSettlementLinkGroupCount,
    noMofItemKeyLinkGroupCount,
    relationCount: relations.length,
    multiSourceSettlementItemCount,
    linkedProjectCount: joinedProjectIds.size,
    accountTypeCounts,
    unresolvedLinkGroups,
  };

  return { relations, diagnostics };
}
