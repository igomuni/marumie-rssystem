export interface EntitySummary {
  id: string; fiscalYear: number; sourceYear: number; accountType: string;
  ministry: string; organization: string; specialAccount: string; subAccount: string;
  agency: string; sectionCode: string; sectionName: string; stages: string[];
  eventCount: number; relationCount: number;
}
export interface Source { path: string; zipEntry: string; rowNumber: number }
export interface RawRecord {
  recordId: string; itemNaturalKey: string; sectionNaturalKey: string;
  phase: string; budgetStatus: string; revision: number | null; sourceAmountColumn: string | null; source: Source;
}
export interface Evidence { eventId: string; amountYen: number; itemName: string; sourceRecordIds: string[] }
export interface EventGroup { eventType: string; budgetStatus: string; revision: number | null; amountYen: number; evidence: Evidence[] }
export interface EntityDetail extends EntitySummary {
  identityMethod: string; rawKeys: string[]; events: EventGroup[]; records: RawRecord[];
  sources: Record<string, { path: string; sha256: string; sizeBytes: number }>;
  relations: { relationId: string; relationType: string; evidenceMethod: string; entityIds: string[]; sourceRecordIds: string[]; targetRecordIds: string[] }[];
  links: { linkId: string; sourceYear: number; fiscalYear: number; phase: string; matchMethod: string; projectIds: string[]; spansEntities: boolean }[];
  comparisons: { budgetType: string; eventType: string; v1Amount: number; v2Amount: number; differenceYen: number; v1Id: string }[];
}
export interface Index { fiscalYear: number; archiveSha256: string; v1File: string; v1Sha256: string; eventCount: number; recordCount: number; settlementChecks: number; entities: EntitySummary[] }
export const accounts: Record<string, string> = { general: '一般会計', special: '特別会計', agency: '政府関係機関' };
export const eventNames: Record<string, string> = {
  initial_budget_state: '当初予算', parliamentary_amendment: '国会修正（提出→成立）',
  supplement_adjustment: '補正増減', settlement_budget_appropriation: '決算書の歳出予算額',
  carryover_in: '前年度からの繰越', reserve_use: '予備費使用', budget_rule_increase: '予算総則による増加',
  transfer_adjustment: '移替増減（純額）', reallocation: '流用等増減', current_budget_state: '歳出予算現額',
  spent: '支出済歳出額', carryover_out: '翌年度繰越額', unused: '不用額',
};
const order = ['initial_budget_state', 'parliamentary_amendment', 'supplement_adjustment', 'settlement_budget_appropriation', 'carryover_in', 'reserve_use', 'budget_rule_increase', 'transfer_adjustment', 'reallocation', 'current_budget_state', 'spent', 'carryover_out', 'unused'];
export function orderedEvents(events: EventGroup[]) {
  return [...events].sort((a, b) => order.indexOf(a.eventType) - order.indexOf(b.eventType)
    || (a.budgetStatus === 'submitted' ? -1 : b.budgetStatus === 'submitted' ? 1 : 0)
    || (a.revision ?? 0) - (b.revision ?? 0));
}
export function eventLabel(e: EventGroup) {
  return (eventNames[e.eventType] ?? e.eventType) + (e.budgetStatus === 'submitted' ? '・提出案' : e.budgetStatus === 'enacted' ? '・成立' : '') + (e.revision === null ? '' : `・第${e.revision}号`);
}
export function isAdjustment(type: string) { return ['parliamentary_amendment', 'supplement_adjustment', 'carryover_in', 'reserve_use', 'budget_rule_increase', 'transfer_adjustment', 'reallocation'].includes(type); }
export function filterEntities(entities: EntitySummary[], account: string, query: string, mode: string) {
  const q = query.trim().normalize('NFKC').toLowerCase();
  return entities.filter(e => (!account || e.accountType === account)
    && (mode !== 'settlement' || e.stages.includes('settlement'))
    && [e.sectionName, e.sectionCode, e.ministry, e.organization, e.specialAccount, e.subAccount, e.agency].join(' ').normalize('NFKC').toLowerCase().includes(q));
}
export const yen = (n: number) => `${n.toLocaleString('ja-JP')} 円`;
