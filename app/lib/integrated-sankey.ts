import type { BudgetBreakdownItem, BudgetSummary } from '@/types/sankey-svg';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';

export type IntegratedAccountType = 'general' | 'special';

export interface IntegratedSectionNode {
  id: string; name: string; accountType: IntegratedAccountType; ministry: string;
  organization: string; subAccount: string; amount: number; itemCount: number;
  /** 前年度額・増減率。項配下の目を合算する（目単位が null の場合は0として扱う） */
  previousAmount: number; difference: number;
}
/** 'mixed' = 一般会計・特別会計の両方から接続する目を持つ事業 */
export type IntegratedProjectAccountType = IntegratedAccountType | 'mixed';
export interface IntegratedProjectNode {
  id: string; projectId: number; name: string; ministry: string; linkedAmount: number;
  initialBudget: number; mofUnlinkedAmount: number; accountType: IntegratedProjectAccountType;
  budgetSummary?: BudgetSummary;
  budgetItems: Array<BudgetBreakdownItem & { connected: boolean }>;
}
export interface IntegratedItemEdge {
  id: string; source: string; target: string; itemKey: string; itemName: string;
  value: number; mofAmount: number; status: 'connected' | 'unconnected' | 'excess';
  projectId?: number; sourceUrl?: string; page?: number | null;
}
export interface IntegratedGraph {
  metadata: { budgetYear: number; rsYear: number; mofAmount: number; connectedAmount: number;
    unconnectedAmount: number; excessAmount: number; sectionCount: number; projectCount: number; itemCount: number };
  sections: IntegratedSectionNode[]; projects: IntegratedProjectNode[]; edges: IntegratedItemEdge[];
}
export interface IntegratedProjectSource {
  projectId: number; budgetSummary?: BudgetSummary; budgetBreakdown?: BudgetBreakdownItem[];
}

export const sectionKey = (l: MofRsKouMokuLinkageRecord) =>
  [l.mofAccountType, l.mofBudgetType, l.mofMinistry, l.mofOrganization, l.mofSubAccount, l.sectionCode].join('|');
export const itemSectionKey = (item: MOFKouMokuItem) =>
  [item.accountType, item.budgetType, item.ministry,
    item.accountType === 'special' ? item.specialAccount : item.organization,
    item.subAccount, item.sectionCode].join('|');

const norm = (value: string) => value.normalize('NFKC').replace(/[\s　]+/g, '');
function budgetItemMatchesLink(item: BudgetBreakdownItem, link: MofRsKouMokuLinkageRecord): boolean {
  const accountMatches = (link.mofAccountType === 'general' && item.accountCategory === '一般会計') ||
    (link.mofAccountType === 'special' && item.accountCategory === '特別会計');
  return accountMatches && item.budgetType === '当初予算' && norm(item.item) === norm(link.sectionName) &&
    norm(item.subItem) === norm(link.subItemName);
}

export function buildIntegratedGraph(allItems: MOFKouMokuItem[], allLinks: MofRsKouMokuLinkageRecord[],
  projectSources: IntegratedProjectSource[], budgetYear = 2024, rsYear = 2025): IntegratedGraph {
  const items = allItems.filter((item): item is MOFKouMokuItem & { accountType: IntegratedAccountType } =>
    item.budgetType === '当初予算' && (item.accountType === 'general' || item.accountType === 'special'));
  const links = allLinks.filter(link => link.mofBudgetType === '当初予算' && !link.carriedOverFrom && link.rsAmount > 0);
  const linksByItem = new Map<string, MofRsKouMokuLinkageRecord[]>();
  for (const link of links) linksByItem.set(link.kouMokuKey, [...(linksByItem.get(link.kouMokuKey) ?? []), link]);
  const lastItemByKey = new Map<string, MOFKouMokuItem>();
  for (const item of items) lastItemByKey.set(item.key, item);

  const sections = new Map<string, IntegratedSectionNode>();
  const edges = new Map<string, IntegratedItemEdge>();
  let connectedAmount = 0, unconnectedAmount = 0, excessAmount = 0;
  for (const item of items) {
    const source = itemSectionKey(item);
    const section = sections.get(source) ?? { id: source, name: item.sectionName, accountType: item.accountType,
      ministry: item.ministry, organization: item.accountType === 'special' ? item.specialAccount : item.organization,
      subAccount: item.subAccount, amount: 0, itemCount: 0, previousAmount: 0, difference: 0 };
    section.amount += item.amount; section.itemCount += 1;
    section.previousAmount += item.previousAmount ?? 0; section.difference += item.difference ?? 0;
    sections.set(source, section);
    const itemLinks = lastItemByKey.get(item.key) === item ? linksByItem.get(item.key) ?? [] : [];
    const linked = itemLinks.reduce((sum, link) => sum + link.rsAmount, 0);
    for (const link of itemLinks) {
      const id = `${item.id}|project:${link.projectId}`;
      const old = edges.get(id);
      if (old) old.value += link.rsAmount;
      else edges.set(id, { id, source, target: `project:${link.projectId}`, itemKey: item.key,
        itemName: item.subItemName, value: link.rsAmount, mofAmount: item.amount, status: 'connected',
        projectId: link.projectId, sourceUrl: item.sourceUrl, page: item.page });
      connectedAmount += link.rsAmount;
    }
    const residual = item.amount - linked;
    if (residual > 0) {
      edges.set(`${item.id}|unconnected`, { id: `${item.id}|unconnected`, source, target: 'rs-unconnected',
        itemKey: item.key, itemName: item.subItemName, value: residual, mofAmount: item.amount,
        status: 'unconnected', sourceUrl: item.sourceUrl, page: item.page });
      unconnectedAmount += residual;
    } else if (residual < 0) {
      edges.set(`${item.id}|excess`, { id: `${item.id}|excess`, source, target: 'rs-excess', itemKey: item.key,
        itemName: item.subItemName, value: -residual, mofAmount: item.amount, status: 'excess',
        sourceUrl: item.sourceUrl, page: item.page });
      excessAmount += -residual;
    }
  }

  const projectLinks = new Map<number, MofRsKouMokuLinkageRecord[]>();
  for (const link of links) projectLinks.set(link.projectId, [...(projectLinks.get(link.projectId) ?? []), link]);
  const sourceMap = new Map(projectSources.map(source => [source.projectId, source]));
  const projects: IntegratedProjectNode[] = [];
  for (const [projectId, rows] of projectLinks) {
    const source = sourceMap.get(projectId); const linkedAmount = rows.reduce((sum, link) => sum + link.rsAmount, 0);
    const initialBudget = source?.budgetSummary?.initialBudget ?? linkedAmount;
    // 政府関係機関(agency)はRSに対応する会計区分が無く対象外のはずだが、型上は
    // 除外しきれないため念のためフィルタする（実データでは一般・特別のみのはず）
    const accountTypes = new Set(
      rows.map(r => r.mofAccountType).filter((t): t is IntegratedAccountType => t === 'general' || t === 'special'),
    );
    const accountType: IntegratedProjectAccountType =
      accountTypes.size > 1 ? 'mixed' : accountTypes.size === 1 ? [...accountTypes][0] : 'general';
    projects.push({ id: `project:${projectId}`, projectId, name: rows[0].projectName, ministry: rows[0].projectMinistry,
      linkedAmount, initialBudget, mofUnlinkedAmount: Math.max(0, initialBudget - linkedAmount), accountType,
      budgetSummary: source?.budgetSummary,
      budgetItems: (source?.budgetBreakdown ?? []).filter(item => item.fiscalYear === budgetYear && item.budgetType === '当初予算')
        .map(item => ({ connected: rows.some(link => budgetItemMatchesLink(item, link)), ...item })) });
  }
  return { metadata: { budgetYear, rsYear, mofAmount: items.reduce((sum, item) => sum + item.amount, 0),
    connectedAmount, unconnectedAmount, excessAmount, sectionCount: sections.size, projectCount: projects.length,
    itemCount: items.length }, sections: [...sections.values()].sort((a, b) => b.amount - a.amount),
    projects: projects.sort((a, b) => b.linkedAmount - a.linkedAmount), edges: [...edges.values()] };
}
