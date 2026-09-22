import type { MOFBudgetType } from './mof-kou-moku';
import type { V2MatchMethod } from '@/app/lib/v2-public-linkage';

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
  phase: 'initial' | 'supplement';
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
  phase: 'initial' | 'supplement';
  revision: number | null;
  matchMethod: V2MatchMethod;
}

export interface MofKouMokuV2IdentityProject {
  projectId: string;
  projectName: string;
  ministry: string;
  sources: MofKouMokuV2IdentitySource[];
}

export interface MofKouMokuV2IdentityRelation {
  relationId: string;
  relationKind: 'inherited-from-budget-link';
  reviewYear: number;
  fiscalYear: number;
  kouMokuKey: string;
  itemNaturalKey: string;
  projectIds: string[];
  projects: MofKouMokuV2IdentityProject[];
}

export interface MofKouMokuV2LinkageProduct {
  schemaVersion: 3;
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
    settlementIdentityRelationCount: number;
    settlementIdentityProjectCount: number;
    settlementIdentityUnmatchedItemCount: number;
    settlementIdentityAmbiguousItemCount: number;
  };
}
