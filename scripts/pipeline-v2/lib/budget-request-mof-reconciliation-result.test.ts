import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { decide, type MatchResult } from './budget-request-mof-reconciliation';

const DIR = path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024');
const res = JSON.parse(fs.readFileSync(path.join(DIR, 'p1-reconciliation-result.json'), 'utf8')) as {
  frozenInputs: { pdfPopulation: { sha256: string } }; decision: string;
  items: { total: number; byClass: Record<string, number> }; requests: { total: number; byClass: Record<string, number> };
  records: (MatchResult & { name: string | null })[];
};
const pop = JSON.parse(fs.readFileSync(path.join(DIR, 'p1-pdf-population.json'), 'utf8')) as { counts: { items: number; requests: number }; records: { sourceAuthority: string; accountType: string; name: unknown }[] };
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// P1 frozen evaluation の result artifact の整合性（snapshot。規則そのものの test は reconciliation.test.ts）
describe('budget-request × MOF reconciliation P1 result artifact', () => {
  it('population と件数が一致し、分類の合計が total に等しい', () => {
    expect(res.items.total).toBe(pop.counts.items);
    expect(res.requests.total).toBe(pop.counts.requests);
    expect(sum(res.items.byClass)).toBe(res.items.total);
    expect(sum(res.requests.byClass)).toBe(res.requests.total);
    expect(res.records).toHaveLength(pop.records.length);
  });
  it('exact_unique 以外には診断が付き、exact_unique には matchedId があり、金額・コードに依存した分類がない', () => {
    for (const r of res.records) {
      if (r.classification === 'exact_unique') { expect(r.matchedId).not.toBeNull(); expect(r.diagnostic).toBeNull(); }
      else { expect(r.matchedId).toBeNull(); expect(r.diagnostic).not.toBeNull(); }
    }
  });
  it('decision は preregistration §9 の規則を records に機械適用した結果と一致する', () => {
    const comparable = pop.records.filter(p => p.accountType === 'general' && p.name !== null).length;
    expect(decide(res.records, comparable).decision).toBe(res.decision);
  });
});
