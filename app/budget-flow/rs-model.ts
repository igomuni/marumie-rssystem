import { searchMatcher, parseAmountRange } from './model';

export interface RsProjectSummary {
  projectId: string; projectName: string; ministry: string; bureau: string;
  startYear: number | null; officialProjectUrl: string; reviewYear: number; shard: string;
  profiles: string[];
  budgetInitialYen: number | null; budgetSupplementsYen: number | null; budgetTotalYen: number | null;
  hasFundingGraph: boolean; blockCount: number; semanticEdgeCount: number;
  hasCycle: boolean; hasOrphanBlocks: boolean; hasDuplicateRelations: boolean;
  hasMofLink: boolean; mofLinkCount: number;
  contextCounts: { policies: number; subsidyRules: number; projectRelations: number; logicModel: number; evaluations: number };
}

export interface RsFundingGraphNode {
  nodeId: string; nodeType: 'spending_block' | 'responsible_organization'; blockId: string | null;
  name: string; nameVariants: string[]; roles: string[]; totalAmountValuesYen?: number[]; recipientCountValues?: number[];
  synthetic?: boolean; syntheticReason?: string;
}
export interface RsFundingGraphEdge {
  edgeId: string; sourceNodeId: string; targetNodeId: string; evidenceCount: number;
  noteVariants: string[]; sourceNameVariants: string[]; targetNameVariants: string[];
  fromResponsibleOrganizationValues: (boolean | null)[]; amountYen: null; amountStatus: string;
}
export interface RsFundingGraphMetrics {
  blockCount: number; nodeCount: number; semanticEdgeCount: number; relationEvidenceCount: number;
  hasCycle: boolean; cyclicComponents: string[][]; weakComponentCount: number; weakComponentSizes: number[];
  maxOutDegree: number; maxInDegree: number; orphanBlockIds: string[]; externalRootBlockIds: string[];
  duplicateRelationPairCount: number; duplicateRelationEvidenceExtraCount: number; indirectExpenseCount: number;
  sameNameMultipleBlocks: { normalizedName: string; blockIds: string[] }[];
  hasResponsibleOrganizationRoot: boolean; responsibleOrganizationNodeId: string | null;
  rootNodeIds: string[]; unresolvedRelationEvidenceCount: number;
}
export interface RsFundingGraph {
  nodes: RsFundingGraphNode[]; edges: RsFundingGraphEdge[]; metrics: RsFundingGraphMetrics;
  unresolvedRelationIds: string[]; unresolvedRelationDetails: unknown[]; duplicateRelationPairs: unknown[];
}
export interface RsMofLink {
  linkId: string; phase: string; revision: number | null; projectIds: string[]; projectCount: number;
  mofAmountYen: number; rsAmountYen: number; differenceYen: number; fiscalYear: number;
}
export interface RsBudgetSummary { fiscalYear: number | null; scopeLevel: string; amounts: Record<string, number | null> }
export interface RsProjectDetail {
  projectId: string;
  project: Record<string, unknown> & { projectName?: string; ministry?: string; bureau?: string; purpose?: string; overview?: string; overviewUrl?: string; officialProjectUrl?: string; startYear?: number; endYear?: number; accountClass?: string; majorExpense?: string };
  reviewSheet?: Record<string, unknown>;
  fundingGraph?: RsFundingGraph;
  mofLinks?: RsMofLink[];
  budgetSummaries?: RsBudgetSummary[];
}

export const rsOrganizationNames = (p: RsProjectSummary) => [p.ministry, p.bureau].filter(Boolean);

export function filterRsProjects(projects: RsProjectSummary[], query: string, organizations: string[], mode: string, regex = false) {
  const { matches } = searchMatcher(query, regex);
  return projects.filter(p =>
    (!organizations.length || rsOrganizationNames(p).some(name => organizations.includes(name)))
    && (mode !== 'cycle' || p.hasCycle)
    && (mode !== 'mofLink' || p.hasMofLink)
    && (mode !== 'duplicate' || p.hasDuplicateRelations)
    && matches([p.projectId, p.projectName, p.ministry, p.bureau].join(' ')));
}

export type RsProjectSortKey = 'projectId' | 'projectName' | 'ministry' | 'budgetTotalYen' | 'blockCount';
export type RsProjectSort = { key: RsProjectSortKey; direction: 'asc' | 'desc' };

export function filterRsAmountRange(projects: RsProjectSummary[], range: ReturnType<typeof parseAmountRange>) {
  if (range.error) return [];
  if (!range.active) return projects;
  return projects.filter(p => {
    const amount = p.budgetTotalYen;
    return amount !== null && (range.min === null || amount >= range.min) && (range.max === null || amount <= range.max);
  });
}

export function sortRsProjects(projects: RsProjectSummary[], sort: RsProjectSort | null): RsProjectSummary[] {
  if (!sort) return projects;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...projects].sort((a, b) => {
    if (sort.key === 'budgetTotalYen' || sort.key === 'blockCount') {
      const x = a[sort.key], y = b[sort.key];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (x - y) * direction;
    }
    if (sort.key === 'projectId') {
      const x = Number(a.projectId), y = Number(b.projectId);
      if (!Number.isNaN(x) && !Number.isNaN(y)) return (x - y) * direction;
      return a.projectId.localeCompare(b.projectId, 'ja', { numeric: true }) * direction;
    }
    return String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'ja', { numeric: true }) * direction;
  });
}
