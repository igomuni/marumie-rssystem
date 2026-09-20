import { parseAmountRange, searchMatcher, type Source } from './model';

export interface RsBudget {
  fiscalYear: number; requestFiscalYear: number | null;
  initialBudgetYen: number | null; currentBudgetYen: number | null;
  executionYen: number | null; nextYearRequestYen: number | null;
}
export interface RsProject {
  id: string; projectId: string; reviewYear: number; projectName: string;
  organizations: string[]; shard: string; accountsByYear: Record<string, string[]>;
  budgets: RsBudget[]; connections: { fiscalYear: number; entityCount: number }[];
}
export interface RsEntity {
  id: string; fiscalYear: number; sectionName: string; sectionCode: string; accountType: string;
  ministry: string; organization: string; specialAccount: string; subAccount: string; agency: string;
}
export interface RsDetail extends Omit<RsProject, 'connections'> {
  organizationRows: { recordId: string; ministry: string; bureau: string; department: string; division: string; office: string; source: Source }[];
  budgets: (RsBudget & { evidence: { recordId: string; source: Source }[] })[];
  sources: Record<string, { sha256: string }>;
  links: { linkId: string; fiscalYear: number; phase: string; revision: number | null; matchMethod: string; entities: RsEntity[]; rsRecordIds: string[]; mofRecordIds: string[] }[];
}
export interface RsIndex {
  reviewYear: number; archiveSha256: string; fiscalYears: number[]; linkFiscalYears: number[]; projects: RsProject[];
  summary: { projects: number; linked: number; unlinked: number };
}
export interface RsTarget { reviewYear: number; projectId: string; fiscalYear: number }
export interface MofTarget { fiscalYear: number; id: string }
export type RsSortKey = 'projectName' | 'projectId' | 'organizations' | 'amount' | 'connection';
export type RsSort = { key: RsSortKey; direction: 'asc' | 'desc' };
export const budgetFor = (p: RsProject, fiscalYear: number) => p.budgets.find(b => b.fiscalYear === fiscalYear);
export const connectionCount = (p: RsProject, fiscalYear: number) => p.connections.find(c => c.fiscalYear === fiscalYear)?.entityCount ?? 0;
export interface RsFilters {
  fiscalYear: number; accounts: string[]; organizations: string[]; query: string; regex: boolean;
  connection: string; minAmount: string; maxAmount: string;
}
export function filterProjects(projects: RsProject[], filters: RsFilters) {
  const { fiscalYear, accounts, organizations, query, regex, connection } = filters;
  const { matches } = searchMatcher(query, regex);
  const range = parseAmountRange(filters.minAmount, filters.maxAmount);
  if (range.error) return [];
  return projects.filter(p => {
    const amount = budgetFor(p, fiscalYear)?.initialBudgetYen;
    const connected = connectionCount(p, fiscalYear) > 0;
    return (!accounts.length || accounts.some(a => p.accountsByYear[fiscalYear]?.includes(a)))
      && (!organizations.length || organizations.some(o => p.organizations.includes(o)))
      && (connection === 'all' || (connection === 'linked' ? connected : !connected))
      && matches([p.projectName, p.projectId, ...p.organizations].join(' '))
      && (!range.active || (amount != null && (range.min === null || amount >= range.min) && (range.max === null || amount <= range.max)));
  });
}
export function sortProjects(projects: RsProject[], fiscalYear: number, sort: RsSort | null) {
  if (!sort) return projects;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...projects].sort((a, b) => {
    if (sort.key === 'amount') {
      const x = budgetFor(a, fiscalYear)?.initialBudgetYen, y = budgetFor(b, fiscalYear)?.initialBudgetYen;
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (x-y)*sign;
    }
    if (sort.key === 'connection') return (connectionCount(a, fiscalYear)-connectionCount(b, fiscalYear))*sign;
    const value = (p: RsProject) => sort.key === 'organizations' ? p.organizations.join(' / ') : p[sort.key as 'projectName' | 'projectId'];
    return value(a).localeCompare(value(b), 'ja', { numeric: true })*sign;
  });
}
export function selectProject(projects: RsProject[], selected: string) {
  return projects.find(p => p.id === selected) ?? projects[0];
}
export const phaseNames: Record<string, string> = { initial: '当初', supplement: '補正', settlement: '決算' };
