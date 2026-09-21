export interface EntitySummary {
  id: string; fiscalYear: number; sourceYear: number; accountType: string;
  ministry: string; organization: string; specialAccount: string; subAccount: string;
  agency: string; sectionCode: string; sectionName: string; stages: string[];
  eventCount: number; relationCount: number; rsProjectCount?: number;
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
/**
 * 入れ子の量指定子（例: `(.+)+`）を検出する。この形は破局的バックトラックを起こし、
 * メインスレッドで同期実行する`RegExp.test`をフリーズさせうるため事前に弾く
 * （簡易ヒューリスティックであり全パターンを検出できるわけではないが、
 * CodeRabbitが実証した典型形はこれで防げる。2026-09-19対応）。
 */
function hasCatastrophicBacktrackingShape(pattern: string): boolean {
  return /\([^()]*[+*][^()]*\)[+*]/.test(pattern);
}

export function searchMatcher(query: string, regex = false): { matches: (value: string) => boolean; error: string } {
  const q = query.trim().normalize('NFKC');
  if (regex && hasCatastrophicBacktrackingShape(q)) {
    return { matches: () => false, error: '入れ子の繰り返し（例: (.+)+）を含む正規表現は使えません。' };
  }
  try {
    const pattern = regex ? new RegExp(q, 'i') : null;
    return { matches: value => pattern ? pattern.test(value.normalize('NFKC')) : value.normalize('NFKC').toLowerCase().includes(q.toLowerCase()), error: '' };
  } catch {
    return { matches: () => false, error: '正規表現が正しくありません。' };
  }
}
export const organizationNames = (e: EntitySummary) => [e.ministry, e.organization, e.agency].filter(Boolean);
export function filterEntities(entities: EntitySummary[], account: string | string[], query: string, mode: string, organizations: string[] = [], regex = false) {
  const selectedAccounts = typeof account === 'string' ? (account ? [account] : []) : account;
  const { matches } = searchMatcher(query, regex);
  return entities.filter(e => (!selectedAccounts.length || selectedAccounts.includes(e.accountType))
    && (!organizations.length || organizationNames(e).some(name => organizations.includes(name)))
    && (mode !== 'settlement' || e.stages.includes('settlement'))
    && matches([e.sectionName, e.sectionCode, e.ministry, e.organization, e.specialAccount, e.subAccount, e.agency].join(' ')));
}
export function initialEnactedAmount(events: EventGroup[]): number | null {
  return events.find(e => e.eventType === 'initial_budget_state' && e.budgetStatus === 'enacted' && e.revision === null)?.amountYen ?? null;
}
export const yen = (n: number) => `${n.toLocaleString('ja-JP')} 円`;

export type EntitySortKey = 'sectionName' | 'organization' | 'accountType' | 'sectionCode' | 'amount' | 'rsProjectCount';
export type EntitySort = { key: EntitySortKey; direction: 'asc' | 'desc' };
export function parseAmountRange(minText: string, maxText: string) {
  const parse = (text: string) => {
    const normalized = text.normalize('NFKC').trim().replaceAll(',', '');
    if (!normalized) return null;
    return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized)) ? Number(normalized) : NaN;
  };
  const min = parse(minText), max = parse(maxText);
  const error = Number.isNaN(min) || Number.isNaN(max) ? '金額は0以上の整数（円）で入力してください。'
    : min !== null && max !== null && min > max ? '下限は上限以下にしてください。' : '';
  return { min, max, error, active: min !== null || max !== null };
}
export function filterAmountRange(entities: EntitySummary[], amounts: Record<string, number | null>, range: ReturnType<typeof parseAmountRange>) {
  if (range.error) return [];
  if (!range.active) return entities;
  return entities.filter(e => {
    const amount = amounts[e.id];
    return amount !== undefined && amount !== null && (range.min === null || amount >= range.min) && (range.max === null || amount <= range.max);
  });
}
export function sortEntities(entities: EntitySummary[], amounts: Record<string, number | null>, sort: EntitySort | null) {
  if (!sort) return entities;
  const direction = sort.direction === 'asc' ? 1 : -1;
  const text = (e: EntitySummary) => sort.key === 'organization' ? organizationNames(e).join(' / ')
    : sort.key === 'accountType' ? accounts[e.accountType] ?? e.accountType : e[sort.key as 'sectionName' | 'sectionCode'];
  return [...entities].sort((a, b) => {
    if (sort.key === 'amount') {
      const x = amounts[a.id], y = amounts[b.id];
      // Missing and not-yet-loaded values stay last in either direction. Zero is a value.
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (x - y) * direction;
    }
    if (sort.key === 'rsProjectCount') return ((a.rsProjectCount ?? 0) - (b.rsProjectCount ?? 0)) * direction;
    return text(a).localeCompare(text(b), 'ja', { numeric: true }) * direction;
  });
}
