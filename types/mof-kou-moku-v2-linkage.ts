import type { MOFBudgetType } from "./mof-kou-moku";
import type { V2MatchMethod } from "@/app/lib/v2-public-linkage";

export interface MofKouMokuV2Project {
  projectId: string;
  projectName: string;
  ministry: string;
  /** このlink groupに採用されたRS 2-2行の事業別合計（按分ではない） */
  rsAmountYen: number;
  rsRecordCount: number;
  /** RS 2-1 project_total の計（歳出予算現額合計）。欠損時はnull */
  projectBudgetAmountYen: number | null;
}

export interface MofKouMokuV2LinkGroup {
  linkId: string;
  reviewYear: number;
  fiscalYear: number;
  phase: "initial" | "supplement";
  revision: number | null;
  matchMethod: V2MatchMethod;
  kouMokuKey: string;
  itemNaturalKey: string;
  mofBudgetType: MOFBudgetType;
  projectIds: string[];
  projects: MofKouMokuV2Project[];
  /** いずれも link group 全体の金額 */
  mofAmountYen: number;
  rsAmountYen: number;
  differenceYen: number;
  spansItems: boolean;
}

export interface MofKouMokuV2IdentitySource {
  linkId: string;
  phase: "initial" | "supplement";
  revision: number | null;
  matchMethod: V2MatchMethod;
  /** このRS事業に採用されたRS 2-2行の当該stage金額（按分ではない） */
  rsAmountYen: number;
  spansItems: boolean;
}

export interface MofKouMokuV2IdentityProject {
  projectId: string;
  projectName: string;
  ministry: string;
  sources: MofKouMokuV2IdentitySource[];
}

export interface MofKouMokuV2IdentityRelation {
  relationId: string;
  relationKind: "inherited-from-budget-link";
  reviewYear: number;
  fiscalYear: number;
  kouMokuKey: string;
  itemNaturalKey: string;
  projectIds: string[];
  projects: MofKouMokuV2IdentityProject[];
}

/** settlement.json.gz（public schema v3）のdataStatusと同じ意味。UI側で別定義を持たない */
export type MofKouMokuV2SettlementDataStatus = 'artifact_missing' | 'no_settlement_rows' | 'available';

export interface MofKouMokuV2LinkageProduct {
  /**
   * v5→v6（Phase B3b）: identityRelationsの由来が「generator独自のsettlement candidate
   * search」から「public settlement.json.gz（Phase B2 → schema v3）のauthoritative
   * relation」へ変わったための破壊的変更。JSON shapeそのものは大きく変わらないが、
   * identity semanticsが変わるためbumpする。
   */
  schemaVersion: 6;
  sourcePublishSchemaVersion: number;
  generatedAt: string;
  reviewYear: number;
  fiscalYear: number;
  groups: MofKouMokuV2LinkGroup[];
  identityRelations: MofKouMokuV2IdentityRelation[];
  diagnostics: {
    sourceLinkGroupCount: number;
    projectedGroupItemCount: number;
    unmatchedItemIdCount: number;
    ambiguousItemIdCount: number;
    multiItemGroupCount: number;
    linkedKouMokuCount: number;
    linkedProjectCount: number;
    projectBreakdownRecordCount: number;
    projectBreakdownCheckedGroupCount: number;
    /** settlement.json.gzのdataStatus（authority側の可用性） */
    settlementDataStatus: MofKouMokuV2SettlementDataStatus;
    /** public settlement.json.gzのidentities件数（projection前、authority側の件数） */
    sourceSettlementRelationCount: number;
    /** identityRelationsへprojectionした件数。sourceSettlementRelationCountと必ず一致する
     *  （public identityは1件も間引かない。legacy表示行への対応付けが失敗してもrelation自体は残す） */
    projectedSettlementRelationCount: number;
    /**
     * public identityは確定済みだが、legacyのmof-kou-moku-{fy}.json（V1データセット）に
     * 対応する決算行が0件のためkouMokuKeyを厳密対応付けできなかった件数。
     * B2 identity resolutionの失敗（旧settlementIdentityUnmatchedItemCount）とは意味が違う。
     */
    settlementProjectionUnmatchedLegacyItemCount: number;
    /** 上記と同様、legacy決算行が複数ヒットして一意に絞れなかった件数（旧settlementIdentityAmbiguousItemCount） */
    settlementProjectionAmbiguousLegacyItemCount: number;
    /**
     * legacy V1データセット側でbudget item+budgetTypeが一意に解決できず、budget側の
     * legacy-matched projection groupが無かったため、derived link+normalized RS行から
     * 独立にPID別evidenceを再構成したsource数（稀。legacy V1データセットの不完全性が原因で、
     * B2 identity resolutionの失敗ではない）。
     */
    settlementProjectionLegacyEvidenceGapCount: number;
    settlementIdentityProjectCount: number;
  };
}
