import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const res = JSON.parse(fs.readFileSync(path.join(DIR, 'reconciliation-result.json'), 'utf8')) as {
  accountScope: { generalRecords: number; outOfScopeMofGeneralAccount: number; accountScopeUnresolved: number };
  items: { extracted: number; generalAccount: number; total: number; byClass: Record<string, number> };
  requests: { extracted: number; generalAccount: number; total: number; byClass: Record<string, number>; parentResolvedToMofSection: number };
  funnel: { requestsExtracted: number; requestsGeneralAccount: number; requestsOutOfScopeSpecialAccount: number; requestsAccountScopeUnresolved: number; requestsExactUnique: number };
  decision: { value: string; failedPdfs: number; comparableRequests: number };
  records: { classification: string; accountType: string; recordKind: string; matchedId: string | null; diagnostic: string | null }[];
};
const pop = JSON.parse(fs.readFileSync(path.join(DIR, 'extraction-population.json'), 'utf8')) as { records: number; items: number; requests: number };
const ext = JSON.parse(fs.readFileSync(path.join(DIR, 'extraction-baseline.json'), 'utf8')) as { document: { status: Record<string, number> } };
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// full-corpus baseline の照合 result artifact の整合性（freeze 済み。matcher は P1 の無修正版）
describe('budget-request full-corpus baseline reconciliation artifact', () => {
  it('population と会計 scope が整合し、一般会計の分類の合計が denominator に等しい（special は out_of_scope）', () => {
    expect(res.accountScope.generalRecords + res.accountScope.outOfScopeMofGeneralAccount + res.accountScope.accountScopeUnresolved).toBe(pop.records);
    expect(res.items.extracted + res.requests.extracted).toBe(pop.records);
    expect(sum(res.items.byClass)).toBe(res.items.generalAccount);
    expect(sum(res.requests.byClass)).toBe(res.requests.generalAccount);
    expect(res.funnel.requestsGeneralAccount + res.funnel.requestsOutOfScopeSpecialAccount + res.funnel.requestsAccountScopeUnresolved).toBe(res.funnel.requestsExtracted);
    expect(res.records).toHaveLength(pop.records - res.accountScope.accountScopeUnresolved);
  });
  it('exact_unique には matchedId、それ以外には診断があり、special の record は out_of_scope', () => {
    for (const r of res.records) {
      if (r.classification === 'exact_unique') { expect(r.matchedId).not.toBeNull(); expect(r.diagnostic).toBeNull(); } else { expect(r.matchedId).toBeNull(); expect(r.diagnostic).not.toBeNull(); }
      if (r.accountType === 'special') expect(r.classification).toBe('out_of_scope');
    }
    expect(res.requests.byClass.exact_unique).toBe(res.funnel.requestsExactUnique);
  });
  it('decision は事前登録の規則（失敗 PDF 25% 以上 / 比較可能 request 30 件未満）と一致する', () => {
    const failed = (ext.document.status.hard_failure ?? 0) + (ext.document.status.exception ?? 0);
    expect(res.decision.failedPdfs).toBe(failed);
    expect(res.decision.value).toBe(failed >= Math.ceil(0.25 * 82) || res.decision.comparableRequests < 30 ? 'NEEDS_BASELINE_INFRASTRUCTURE' : 'GO_TO_FAILURE_PRIORITIZATION');
  });
});
