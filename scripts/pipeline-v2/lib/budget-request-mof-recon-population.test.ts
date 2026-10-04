import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const pop = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024', 'p1-pdf-population.json'), 'utf8')) as {
  runs: { items: number; requests: number }[];
  counts: { items: number; requests: number; duplicateRunLocators: unknown[]; duplicateSourceLocators: unknown[] };
  records: { runId: string; page: number; logicalRowIndex: number; recordKind: string; sourceSha256: string; accountType: string; parentItem: unknown }[];
};

// P1-A population artifact の整合性（freeze 済み。MOF とのマッチ結果は含まない）
describe('budget-request × MOF reconciliation P1 PDF population', () => {
  it('records は item / request のみで、件数が runs・counts と整合し locator の重複がない', () => {
    expect(pop.records.every(r => r.recordKind === 'item' || r.recordKind === 'request')).toBe(true);
    expect(pop.records.filter(r => r.recordKind === 'item')).toHaveLength(pop.counts.items);
    expect(pop.records.filter(r => r.recordKind === 'request')).toHaveLength(pop.counts.requests);
    expect(pop.runs.reduce((n, r) => n + r.items, 0)).toBe(pop.counts.items);
    expect(pop.runs.reduce((n, r) => n + r.requests, 0)).toBe(pop.counts.requests);
    expect(new Set(pop.records.map(r => `${r.runId}#${r.page}:${r.logicalRowIndex}`)).size).toBe(pop.records.length);
    expect(pop.counts.duplicateRunLocators).toEqual([]);
    expect(pop.counts.duplicateSourceLocators).toEqual([]);
  });
  it('各 record が source の SHA-256 と会計を持ち、request だけが親の項を持つ', () => {
    for (const r of pop.records) {
      expect(r.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(['general', 'special']).toContain(r.accountType);
      expect(r.parentItem === null).toBe(r.recordKind === 'item');
    }
  });
});
