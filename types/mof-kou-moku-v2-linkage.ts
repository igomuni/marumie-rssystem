import type { MOFBudgetType } from './mof-kou-moku';
import type { V2MatchMethod } from '@/app/lib/v2-public-linkage';

export interface MofKouMokuV2Project {
  projectId: string;
  projectName: string;
  ministry: string;
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

export interface MofKouMokuV2LinkageProduct {
  schemaVersion: 1;
  sourcePublishSchemaVersion: number;
  generatedAt: string;
  reviewYear: number;
  fiscalYear: number;
  groups: MofKouMokuV2LinkGroup[];
  diagnostics: {
    sourceLinkGroupCount: number;
    projectedGroupItemCount: number;
    unmatchedItemIdCount: number;
    ambiguousItemIdCount: number;
    multiItemGroupCount: number;
    linkedKouMokuCount: number;
    linkedProjectCount: number;
  };
}
