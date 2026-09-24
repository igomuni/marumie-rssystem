/**
 * 決算identity（Phase B2: RS事業→MOF予算項目→決算項目）のPublic圏compact変換
 * （public/data/v2/links/review-{ry}-fy{fy}/settlement.json.gz、Phase B3a）。
 *
 * 設計: docs/chats/20260923_1430_予算現額比較検証/v2_settlement_linkage_design.md
 *
 * 方針:
 * - public field名にderivedの`itemNaturalKey`をそのまま出さない。
 *   settlementItemNaturalKey → settlementItemId、budgetItemNaturalKey → budgetItemId
 *   として公開する（値自体は既存MOF public item id=itemNaturalKeyと同一）。
 * - settlementSectionIdは、budget link側のsectionではなくsettlement側itemの
 *   normalized MOF行から求める（sectionIdOf()を再利用。復興特会fallbackでは
 *   budgetとsettlementの項コードが異なるため、budget側sectionを使い回さない）。
 * - sourceにphase/revision/matchMethod/projectIdsを重複保持しない。それらは
 *   同ディレクトリのlinks.json.gzをlinkIdでjoinすれば取得できる。
 * - ambiguous/unmatchedのcandidate詳細（derivedのunresolvedLinkGroups）は
 *   publicへ出さない。件数だけdiagnosticsサマリとして公開する。
 */
import { sectionIdOf } from './mof-publish';
import type { MofAccountType } from '../types';
import type { MofRsSettlementDiagnostics, MofRsSettlementIdentityRelation, SettlementResolutionMethod } from './mof-rs-settlement-identity';
import type { SettlementItemRecord } from './mof-settlement-items';

/**
 * settlement.json.gz自身のshape schema version。他のpublic V2 product（links.json.gz等）と
 * 揃えて2から始める（PUBLISH_SCHEMA_VERSIONとは別軸の、この1 productだけのshape version）。
 */
export const SETTLEMENT_PRODUCT_SCHEMA_VERSION = 2;

export interface PublishedSettlementSource {
  linkId: string;
  budgetItemId: string;
  resolutionMethod: SettlementResolutionMethod;
}

export interface PublishedSettlementAmounts {
  budgetAppropriationYen: number | null;
  currentBudgetYen: number | null;
  spentYen: number | null;
  carryoverOutYen: number | null;
  unusedYen: number | null;
}

export interface PublishedSettlementIdentity {
  settlementItemId: string;
  settlementSectionId: string;
  accountType: MofAccountType;
  projectIds: string[];
  sources: PublishedSettlementSource[];
  amounts: PublishedSettlementAmounts;
}

export interface PublishedSettlementDiagnosticsSummary {
  sourceLinkGroupCount: number;
  exactJoinLinkGroupCount: number;
  uniqueNameFallbackLinkGroupCount: number;
  ambiguousNameFallbackLinkGroupCount: number;
  unmatchedSettlementLinkGroupCount: number;
  spansMultipleItemsLinkGroupCount: number;
  noMofItemKeyLinkGroupCount: number;
  relationCount: number;
  linkedProjectCount: number;
  relationCountByResolutionMethod: Record<SettlementResolutionMethod | 'mixed', number>;
  accountTypeFallbackCounts: Record<string, number>;
}

/**
 * derivedのrelationをpublic identityへ変換する。settlementItemsByKeyに対象の
 * settlementItemNaturalKeyが見つからない場合は、B2の不変条件（relationは必ず
 * exact/fallbackでsettlement itemへ解決済み）が破れているためfail-fastする。
 */
export function compactSettlementIdentity(
  relation: MofRsSettlementIdentityRelation,
  settlementItemsByKey: Map<string, SettlementItemRecord>,
): PublishedSettlementIdentity {
  const item = settlementItemsByKey.get(relation.settlementItemNaturalKey);
  if (!item) {
    throw new Error(
      `settlement item not found for settlementItemNaturalKey=${relation.settlementItemNaturalKey} ` +
      '（relationとsettlement-items.jsonlの不整合。derive-integrated.tsを再実行してください）'
    );
  }
  return {
    settlementItemId: relation.settlementItemNaturalKey,
    settlementSectionId: sectionIdOf(item),
    accountType: relation.accountType,
    projectIds: relation.projectIds,
    sources: relation.sourceLinks.map(s => ({ linkId: s.linkId, budgetItemId: s.budgetItemNaturalKey, resolutionMethod: s.resolutionMethod })),
    amounts: {
      budgetAppropriationYen: relation.budgetAppropriationYen,
      currentBudgetYen: relation.currentBudgetYen,
      spentYen: relation.spentYen,
      carryoverOutYen: relation.carryoverOutYen,
      unusedYen: relation.unusedYen,
    },
  };
}

export function compactSettlementDiagnostics(d: MofRsSettlementDiagnostics): PublishedSettlementDiagnosticsSummary {
  return {
    sourceLinkGroupCount: d.sourceLinkGroupCount,
    exactJoinLinkGroupCount: d.exactJoinLinkGroupCount,
    uniqueNameFallbackLinkGroupCount: d.uniqueNameFallbackLinkGroupCount,
    ambiguousNameFallbackLinkGroupCount: d.ambiguousNameFallbackLinkGroupCount,
    unmatchedSettlementLinkGroupCount: d.unmatchedSettlementLinkGroupCount,
    spansMultipleItemsLinkGroupCount: d.spansMultipleItemsLinkGroupCount,
    noMofItemKeyLinkGroupCount: d.noMofItemKeyLinkGroupCount,
    relationCount: d.relationCount,
    linkedProjectCount: d.linkedProjectCount,
    relationCountByResolutionMethod: d.relationCountByResolutionMethod,
    accountTypeFallbackCounts: d.accountTypeFallbackCounts,
  };
}
