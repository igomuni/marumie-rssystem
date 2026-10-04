import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { hierarchyContractFor, planCorpusDocument } from './budget-request-corpus-plan';

const M = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024', 'corpus-manifest.json'), 'utf8')) as {
  corpus: { pdfs: number; found: number; totalPages: number; digestSha256: string };
  executionClasses: Record<string, { pdfs: number; pages: number }>;
  documents: { canonicalUrl: string; localPath: string; sha256: string; pages: number; state: string; accountType: string; plan: { executionClass: string; segments: { pages: [number, number]; mode: string }[] } }[];
};
const METI = 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf';

describe('実行計画（既存の hierarchy 契約だけから決める）', () => {
  it('hierarchy 契約は view=detail の A2 実験のうち最も広い範囲。無ければ null', () => {
    expect(hierarchyContractFor(METI)).toEqual({ id: 'meti-detail', pages: [9, 106] });
    expect(hierarchyContractFor('https://example.invalid/none.pdf')).toBeNull();
  });
  it('契約があれば null → hierarchy → null の連続区間（ページを過不足なく覆う）、無ければ全ページ null', () => {
    expect(planCorpusDocument(METI, 106, 'FOUND')).toMatchObject({ executionClass: 'runnable_existing_contract', segments: [{ pages: [1, 8], mode: 'null_hierarchy' }, { pages: [9, 106], mode: 'hierarchy_enabled' }] });
    expect(planCorpusDocument('https://example.invalid/none.pdf', 50, 'FOUND')).toMatchObject({ executionClass: 'unrunnable_missing_hierarchy', segments: [{ pages: [1, 50], mode: 'null_hierarchy' }] });
  });
  it('原本が FOUND でない・ページ数不明・範囲が収まらない場合は unrunnable_other（区間なし）', () => {
    expect(planCorpusDocument(METI, 106, 'MISSING').executionClass).toBe('unrunnable_other');
    expect(planCorpusDocument(METI, null, 'FOUND').executionClass).toBe('unrunnable_other');
    expect(planCorpusDocument(METI, 50, 'FOUND')).toMatchObject({ executionClass: 'unrunnable_other', segments: [] });
  });
});

describe('corpus manifest（freeze 済み）', () => {
  it('82 PDF・全件 FOUND・ページ数の合計と実行分類の合計が整合し、全 PDF の区間が全ページを過不足なく覆う', () => {
    expect(M.corpus).toMatchObject({ pdfs: 82, found: 82 });
    expect(M.documents).toHaveLength(82);
    expect(new Set(M.documents.map(d => d.localPath)).size).toBe(82);
    expect(M.documents.reduce((n, d) => n + d.pages, 0)).toBe(M.corpus.totalPages);
    expect(Object.values(M.executionClasses).reduce((n, c) => n + c.pdfs, 0)).toBe(82);
    expect(Object.values(M.executionClasses).reduce((n, c) => n + c.pages, 0)).toBe(M.corpus.totalPages);
    for (const d of M.documents) {
      expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(['general', 'special']).toContain(d.accountType);
      const covered = d.plan.segments.reduce((n, s) => n + (s.pages[1] - s.pages[0] + 1), 0);
      expect(covered).toBe(d.pages);
    }
  });
});
