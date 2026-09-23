/**
 * 既存のMOF↔RS formal budget link（initial/supplement）を根拠に、settlement-items.jsonl
 * （itemNaturalKey単位の決算集約、Phase A）へderived層で接続する（Phase B1 + B2）。
 *
 * 設計: docs/chats/20260923_1430_予算現額比較検証/v2_settlement_linkage_design.md
 *
 * 方針:
 * - RS↔決算の新規の名称マッチ・金額マッチは一切行わない。既存のmof-rs-links.tsが
 *   生成したlink group（mofRecordIds経由でitemNaturalKeyへ辿れる）だけを根拠にする。
 * - resolution順序は必ず次の通り: (1) itemNaturalKey exact → (2) scopeNameItemKey
 *   unique fallback → (3) ambiguous（自動解決しない） → (4) unmatched。
 *   fallbackキーは既存 lib/mof-keys.ts の scopeNameItemKey() と同一ロジックで
 *   normalize-mof.ts生成時に各行へ既に埋め込まれている値（MofBudgetItemRecord /
 *   SettlementItemRecordの`scopeNameItemKey`フィールド）をそのまま使う。新しい
 *   文字列結合・normalizeロジックはここでは作らない。
 * - fallback候補が2件以上の場合（ambiguous-name-fallback）は自動選択しない。
 *   金額による候補選択も行わない。診断へ残し、relationを作らない。
 * - 1 link groupのmofRecordIdsが複数の異なるitemNaturalKeyにまたがる場合
 *   （`spans_multiple_items`）、根拠なく1つの決算itemへ金額配賦しない。診断へ残し、
 *   relationを作らない。
 * - 同一settlement item（exactまたはfallbackで解決した先）へ、initial/複数supplementの
 *   複数link groupから同じ/別のRS事業が到達する場合、relationはsettlement item単位に
 *   集約する（1 settlement item = 1 relation）。projectIdsは重複させず、どのlink group
 *   （phase/revision/matchMethod/budgetItemNaturalKey/resolutionMethod）を根拠にしたかは
 *   sourceLinksとして全て保持する。
 *   （これをしないと、同一決算itemの金額が複数relationに重複計上されうる）
 * - budget側のitemNaturalKeyとsettlement側のitemNaturalKeyはfallback時に異なりうるため、
 *   relation/sourceLink上で明示的に別フィールドに分ける
 *   （sourceLink.budgetItemNaturalKey / relation.settlementItemNaturalKey）。
 */
import type { MofAccountType, MofBudgetItemRecord, MofRsGroupMatchMethod, MofRsProjectLinkGroup } from '../types';
import type { SettlementItemRecord } from './mof-settlement-items';

export type SettlementResolutionMethod = 'exact-item-key' | 'unique-name-fallback';

export interface MofRsSettlementSourceLink {
  linkId: string;
  phase: 'initial' | 'supplement';
  revision: number | null;
  matchMethod: MofRsGroupMatchMethod;
  projectIds: string[];
  budgetItemNaturalKey: string;
  resolutionMethod: SettlementResolutionMethod;
}

export interface MofRsSettlementIdentityRelation {
  schemaVersion: number;
  recordType: 'mof_rs_settlement_identity_relation';
  reviewYear: number;
  fiscalYear: number;
  accountType: MofAccountType;
  /** joinの最終的な対象＝settlement-items.jsonl側のitemNaturalKey */
  settlementItemNaturalKey: string;
  projectIds: string[];
  sourceLinks: MofRsSettlementSourceLink[];

  settlementSourceRecordCount: number;
  budgetAppropriationYen: number | null;
  currentBudgetYen: number | null;
  spentYen: number | null;
  carryoverOutYen: number | null;
  unusedYen: number | null;
}

export type MofRsSettlementUnresolvedReason = 'no_mof_item_key' | 'spans_multiple_items' | 'ambiguous_name_fallback' | 'unmatched';

export interface MofRsSettlementUnresolvedLinkGroup {
  linkId: string;
  reason: MofRsSettlementUnresolvedReason;
  projectIds: string[];
  /** spans_multiple_items: budget側で複数に分かれたitemNaturalKey候補 */
  budgetItemNaturalKeyCandidates: string[];
  /** ambiguous_name_fallback / unmatched: 照合を試みたbudget側のscopeNameItemKey */
  scopeNameItemKey?: string;
  /** ambiguous_name_fallback: scopeNameItemKeyに一致した決算side itemNaturalKeyの候補（2件以上） */
  settlementCandidateItemNaturalKeys?: string[];
}

/**
 * settlement-items.jsonl（Phase A成果物）の可用性。
 * - artifact_missing: derive-mof.tsが当該年度でまだ実行されていない（ファイル自体が無い）
 * - no_settlement_rows: ファイルはあるが決算行が0件の年度（例: 決算未確定のFY）
 * - available: 決算行がありexact/fallback joinを試みられる状態
 * artifact_missing/no_settlement_rowsを「join失敗(unmatched)」と混同すると、
 * 「決算データが無い」と「決算データはあるがキーが不一致」を区別できなくなる。
 */
export type SettlementDataStatus = 'artifact_missing' | 'no_settlement_rows' | 'available';

export interface MofRsSettlementDiagnostics {
  schemaVersion: number;
  reviewYear: number;
  fiscalYear: number;
  settlementDataStatus: SettlementDataStatus;
  sourceLinkGroupCount: number;
  exactJoinLinkGroupCount: number;
  uniqueNameFallbackLinkGroupCount: number;
  ambiguousNameFallbackLinkGroupCount: number;
  unmatchedSettlementLinkGroupCount: number;
  spansMultipleItemsLinkGroupCount: number;
  noMofItemKeyLinkGroupCount: number;
  relationCount: number;
  /** relationのsourceLinksが含むresolutionMethodの集合で分類したrelation件数（両方混在する場合は'mixed'） */
  relationCountByResolutionMethod: Record<SettlementResolutionMethod | 'mixed', number>;
  /** uniqueNameFallbackLinkGroupCountのaccountType別内訳 */
  accountTypeFallbackCounts: Record<string, number>;
  multiSourceSettlementItemCount: number;
  linkedProjectCount: number;
  accountTypeCounts: Record<string, number>;
  unresolvedLinkGroups: MofRsSettlementUnresolvedLinkGroup[];
}

interface LinkKeyResolution {
  link: MofRsProjectLinkGroup;
  budgetItemNaturalKey: string;
  budgetScopeNameItemKey: string;
  accountType: MofAccountType;
}

interface Contribution {
  link: MofRsProjectLinkGroup;
  budgetItemNaturalKey: string;
  resolutionMethod: SettlementResolutionMethod;
  accountType: MofAccountType;
}

function emptyDiagnostics(reviewYear: number, fiscalYear: number, settlementDataStatus: SettlementDataStatus, sourceLinkGroupCount: number): MofRsSettlementDiagnostics {
  return {
    schemaVersion: 1, reviewYear, fiscalYear, settlementDataStatus,
    sourceLinkGroupCount,
    exactJoinLinkGroupCount: 0,
    uniqueNameFallbackLinkGroupCount: 0,
    ambiguousNameFallbackLinkGroupCount: 0,
    unmatchedSettlementLinkGroupCount: 0,
    spansMultipleItemsLinkGroupCount: 0,
    noMofItemKeyLinkGroupCount: 0,
    relationCount: 0,
    relationCountByResolutionMethod: { 'exact-item-key': 0, 'unique-name-fallback': 0, mixed: 0 },
    accountTypeFallbackCounts: {},
    multiSourceSettlementItemCount: 0,
    linkedProjectCount: 0,
    accountTypeCounts: {},
    unresolvedLinkGroups: [],
  };
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
    return { relations: [], diagnostics: emptyDiagnostics(reviewYear, fiscalYear, settlementDataStatus, linkGroups.length) };
  }

  const mofItemByRecordId = new Map<string, { itemNaturalKey: string; scopeNameItemKey: string; accountType: MofAccountType }>();
  for (const r of mofRows) mofItemByRecordId.set(r.recordId, { itemNaturalKey: r.itemNaturalKey, scopeNameItemKey: r.scopeNameItemKey, accountType: r.accountType });

  const settlementByExactKey = new Map(settlementItems.map(s => [s.itemNaturalKey, s]));
  const settlementByNameKey = new Map<string, SettlementItemRecord[]>();
  for (const s of settlementItems) {
    const list = settlementByNameKey.get(s.scopeNameItemKey) ?? [];
    list.push(s);
    settlementByNameKey.set(s.scopeNameItemKey, list);
  }

  const unresolvedLinkGroups: MofRsSettlementUnresolvedLinkGroup[] = [];
  let noMofItemKeyLinkGroupCount = 0;
  let spansMultipleItemsLinkGroupCount = 0;
  let ambiguousNameFallbackLinkGroupCount = 0;
  let unmatchedSettlementLinkGroupCount = 0;
  const accountTypeFallbackCounts: Record<string, number> = {};

  // Step 1: 各link groupをbudget側の単一itemNaturalKeyへ解決する（複数にまたがる場合は除外）
  const keyResolutions: LinkKeyResolution[] = [];
  for (const link of linkGroups) {
    const itemInfos = link.mofRecordIds
      .map(id => mofItemByRecordId.get(id))
      .filter((x): x is { itemNaturalKey: string; scopeNameItemKey: string; accountType: MofAccountType } => !!x);
    if (itemInfos.length === 0) {
      noMofItemKeyLinkGroupCount++;
      unresolvedLinkGroups.push({ linkId: link.linkId, reason: 'no_mof_item_key', projectIds: link.projectIds, budgetItemNaturalKeyCandidates: [] });
      continue;
    }
    const distinctKeys = [...new Set(itemInfos.map(i => i.itemNaturalKey))].sort();
    if (distinctKeys.length > 1) {
      spansMultipleItemsLinkGroupCount++;
      unresolvedLinkGroups.push({ linkId: link.linkId, reason: 'spans_multiple_items', projectIds: link.projectIds, budgetItemNaturalKeyCandidates: distinctKeys });
      continue;
    }
    keyResolutions.push({ link, budgetItemNaturalKey: distinctKeys[0], budgetScopeNameItemKey: itemInfos[0].scopeNameItemKey, accountType: itemInfos[0].accountType });
  }

  // Step 2: budget側キーをsettlementへ解決する。exact優先、無ければscopeNameItemKey fallback。
  const contributionsBySettlementKey = new Map<string, Contribution[]>();

  for (const { link, budgetItemNaturalKey, budgetScopeNameItemKey, accountType } of keyResolutions) {
    const exactMatch = settlementByExactKey.get(budgetItemNaturalKey);
    if (exactMatch) {
      const list = contributionsBySettlementKey.get(exactMatch.itemNaturalKey) ?? [];
      list.push({ link, budgetItemNaturalKey, resolutionMethod: 'exact-item-key', accountType });
      contributionsBySettlementKey.set(exactMatch.itemNaturalKey, list);
      continue;
    }

    const candidates = settlementByNameKey.get(budgetScopeNameItemKey) ?? [];
    if (candidates.length === 1) {
      accountTypeFallbackCounts[accountType] = (accountTypeFallbackCounts[accountType] ?? 0) + 1;
      const list = contributionsBySettlementKey.get(candidates[0].itemNaturalKey) ?? [];
      list.push({ link, budgetItemNaturalKey, resolutionMethod: 'unique-name-fallback', accountType });
      contributionsBySettlementKey.set(candidates[0].itemNaturalKey, list);
      continue;
    }
    if (candidates.length > 1) {
      ambiguousNameFallbackLinkGroupCount++;
      unresolvedLinkGroups.push({
        linkId: link.linkId, reason: 'ambiguous_name_fallback', projectIds: link.projectIds,
        budgetItemNaturalKeyCandidates: [budgetItemNaturalKey], scopeNameItemKey: budgetScopeNameItemKey,
        settlementCandidateItemNaturalKeys: candidates.map(c => c.itemNaturalKey).sort(),
      });
      continue;
    }
    unmatchedSettlementLinkGroupCount++;
    unresolvedLinkGroups.push({
      linkId: link.linkId, reason: 'unmatched', projectIds: link.projectIds,
      budgetItemNaturalKeyCandidates: [budgetItemNaturalKey], scopeNameItemKey: budgetScopeNameItemKey,
    });
  }

  // Step 3: settlement item単位にrelationを集約する（同一settlement itemへの複数link groupを重複計上しない）
  const relations: MofRsSettlementIdentityRelation[] = [];
  const accountTypeCounts: Record<string, number> = {};
  const joinedProjectIds = new Set<string>();
  const joinedSettlementKeys = new Set<string>();
  const relationCountByResolutionMethod: Record<SettlementResolutionMethod | 'mixed', number> = { 'exact-item-key': 0, 'unique-name-fallback': 0, mixed: 0 };

  for (const settlementItemNaturalKey of [...contributionsBySettlementKey.keys()].sort()) {
    const contributions = contributionsBySettlementKey.get(settlementItemNaturalKey)!;
    const settlementItem = settlementByExactKey.get(settlementItemNaturalKey)!;
    const accountType = contributions[0].accountType;
    accountTypeCounts[accountType] = (accountTypeCounts[accountType] ?? 0) + 1;
    joinedSettlementKeys.add(settlementItemNaturalKey);

    const projectIds = new Set<string>();
    const sourceLinks: MofRsSettlementSourceLink[] = [];
    const methodsPresent = new Set<SettlementResolutionMethod>();
    for (const { link, budgetItemNaturalKey, resolutionMethod } of [...contributions].sort((a, b) => (a.link.linkId < b.link.linkId ? -1 : a.link.linkId > b.link.linkId ? 1 : 0))) {
      for (const p of link.projectIds) { projectIds.add(p); joinedProjectIds.add(p); }
      sourceLinks.push({ linkId: link.linkId, phase: link.phase, revision: link.revision, matchMethod: link.matchMethod, projectIds: link.projectIds, budgetItemNaturalKey, resolutionMethod });
      methodsPresent.add(resolutionMethod);
    }
    relationCountByResolutionMethod[methodsPresent.size > 1 ? 'mixed' : [...methodsPresent][0]]++;

    relations.push({
      schemaVersion: 1,
      recordType: 'mof_rs_settlement_identity_relation',
      reviewYear,
      fiscalYear,
      accountType,
      settlementItemNaturalKey,
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
    .filter(k => (settlementByExactKey.get(k)?.sourceRecordCount ?? 0) > 1).length;

  const exactJoinLinkGroupCount = keyResolutions.length - ambiguousNameFallbackLinkGroupCount - unmatchedSettlementLinkGroupCount
    - Object.values(accountTypeFallbackCounts).reduce((s, n) => s + n, 0);

  const diagnostics: MofRsSettlementDiagnostics = {
    schemaVersion: 1,
    reviewYear,
    fiscalYear,
    settlementDataStatus: 'available',
    sourceLinkGroupCount: linkGroups.length,
    exactJoinLinkGroupCount,
    uniqueNameFallbackLinkGroupCount: Object.values(accountTypeFallbackCounts).reduce((s, n) => s + n, 0),
    ambiguousNameFallbackLinkGroupCount,
    unmatchedSettlementLinkGroupCount,
    spansMultipleItemsLinkGroupCount,
    noMofItemKeyLinkGroupCount,
    relationCount: relations.length,
    relationCountByResolutionMethod,
    accountTypeFallbackCounts,
    multiSourceSettlementItemCount,
    linkedProjectCount: joinedProjectIds.size,
    accountTypeCounts,
    unresolvedLinkGroups,
  };

  return { relations, diagnostics };
}
