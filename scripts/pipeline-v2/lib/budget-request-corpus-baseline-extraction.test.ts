import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const ev = JSON.parse(fs.readFileSync(path.join(DIR, 'extraction-baseline.json'), 'utf8')) as {
  document: { totalPdfs: number; status: Record<string, number>; pages: { total: number; attempted: number; processed: number }; byExecutionClass: Record<string, { pdfs: number; pages: number; success: number; failed: number }>; failures: unknown[] };
  records: { total: number; byKind: Record<string, number> };
  items: { total: number }; requests: { total: number; parentItemStatus: Record<string, number> };
  perDocument: { localPath: string; items: number; requests: number }[];
};
const pop = JSON.parse(fs.readFileSync(path.join(DIR, 'extraction-population.json'), 'utf8')) as { records: number; items: number; requests: number; population: { recordKind: string; localPath: string; page: number; logicalRowIndex: number; parentItem: unknown }[] };
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// extraction-only baseline artifact の整合性（freeze 済み。MOF との照合結果は含まない）
describe('budget-request full-corpus baseline extraction artifact', () => {
  it('82 PDF すべての status が記録され、実行分類・ページ数が整合する', () => {
    expect(ev.document.totalPdfs).toBe(82);
    expect(sum(ev.document.status)).toBe(82);
    expect(ev.document.failures).toHaveLength((ev.document.status.hard_failure ?? 0) + (ev.document.status.exception ?? 0));
    expect(Object.values(ev.document.byExecutionClass).reduce((n, c) => n + c.pdfs, 0)).toBe(82);
    expect(Object.values(ev.document.byExecutionClass).reduce((n, c) => n + c.success + c.failed, 0)).toBe(82);
    expect(ev.document.pages.attempted).toBe(ev.document.pages.total);
    expect(ev.document.pages.processed).toBeLessThanOrEqual(ev.document.pages.total);
  });
  it('record 数が種別別・PDF 別・population と一致し、locator に重複がない', () => {
    expect(sum(ev.records.byKind)).toBe(ev.records.total);
    expect(ev.items.total).toBe(ev.records.byKind.item ?? 0);
    expect(ev.requests.total).toBe(ev.records.byKind.request ?? 0);
    expect(sum(ev.requests.parentItemStatus)).toBe(ev.requests.total);
    expect(ev.perDocument.reduce((n, d) => n + d.items, 0)).toBe(pop.items);
    expect(ev.perDocument.reduce((n, d) => n + d.requests, 0)).toBe(pop.requests);
    expect(pop.population).toHaveLength(pop.records);
    expect(new Set(pop.population.map(p => `${p.localPath}#${p.page}:${p.logicalRowIndex}`)).size).toBe(pop.records);
    expect(pop.population.every(p => (p.recordKind === 'request') === (p.parentItem !== null))).toBe(true);
  });
});
