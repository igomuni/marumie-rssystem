import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
const man = read<{
  frozenInput: { plainTextCorpusDigestSha256: string };
  summary: { totalPages: number; rawStatus: Record<string, number>; classificationStatus: Record<string, number>; source: Record<string, number>; pageLossOrDuplicate: number; corpusClassificationDigestSha256: string };
  conformance: { totalMismatch: number; v0: { directMismatch: number; stateMismatch: number }; v1: { directMismatch: number; stateMismatch: number }; v2: { directMismatch: number; stateMismatch: number } };
  perPdf: { pageCount: number }[];
}>('page-classification-v0-implementation-manifest.json');
const reg = read<{
  overall: { rows: number; wrongFamilyResolution: number; knownFormResolvedPrecision: number; knownFormCoverage: number; resolved: number; abstained: number; knownFormGtRows: number };
  bySourceVersion: Record<string, { rows: number }>;
  wrongFamilyRows: unknown[];
  otherOrUnresolvedGtRows: number;
  openSetSafety: string;
  engineeringJudgment: string;
  implementationCommit: string;
  v3Fixture: { sha256: string };
}>('page-classification-v0-descriptive-regression.json');
const rep = read<{ records: { classification: { status: string; pageType: string | null; source: string | null } }[] }>('page-classification-v0-implementation-representative.json');
// 入力の識別子: FY2024 の PDF corpus 記録（tests/fixtures/budget-request-pdf-corpus/2024/pdf-corpus-freeze.json。凍結後に取得した PDF を統合済み）のダイジェスト
const corpus = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-pdf-corpus', '2024', 'pdf-corpus-freeze.json'), 'utf8')) as { frozenInput: { corpusDigestSha256: string; physicalPages: number } };
const plain = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-plain-text', '2024', 'plain-text-manifest.json'), 'utf8')) as { frozenPdfCorpus: { sha256: string } };
const PAGES = corpus.frozenInput.physicalPages;

describe('page classifier v0 implementation result', () => {
  it('full corpus の全 page を欠落・重複なく分類し、status 集計が整合する', () => {
    expect(man.frozenInput.plainTextCorpusDigestSha256).toBe(plain.frozenPdfCorpus.sha256);
    expect(man.summary.totalPages).toBe(PAGES);
    expect(man.perPdf.reduce((n, p) => n + p.pageCount, 0)).toBe(PAGES);
    expect(man.summary.pageLossOrDuplicate).toBe(0);
    expect(Object.values(man.summary.classificationStatus).reduce((a, b) => a + b, 0)).toBe(PAGES);
    expect(man.summary.classificationStatus.NO_TEXT).toBe(man.summary.rawStatus.EMPTY);
  });
  it('frozen candidate の machine observation と実装出力が一致する（conformance mismatch 0）', () => {
    expect(man.conformance.totalMismatch).toBe(0);
    for (const v of ['v0', 'v1', 'v2'] as const) expect([man.conformance[v].directMismatch, man.conformance[v].stateMismatch]).toEqual([0, 0]);
  });
  it('representative は NO_TEXT に semantic type を付けず、INHERITED は RESOLVED のみ', () => {
    for (const r of rep.records) {
      if (r.classification.status === 'NO_TEXT') expect([r.classification.pageType, r.classification.source]).toEqual([null, null]);
      if (r.classification.source === 'INHERITED') expect(r.classification.status).toBe('RESOLVED');
    }
  });
  it('431 descriptive regression: wrong-family 0 / precision 100% / open-set は NOT_EVALUATED、coverage は報告値として整合', () => {
    expect(reg.overall.rows).toBe(431);
    expect(Object.values(reg.bySourceVersion).reduce((n, v) => n + v.rows, 0)).toBe(431);
    expect(reg.overall.wrongFamilyResolution).toBe(0);
    expect(reg.wrongFamilyRows).toEqual([]);
    expect(reg.overall.knownFormResolvedPrecision).toBe(1);
    expect(reg.overall.knownFormCoverage).toBeCloseTo(reg.overall.resolved / reg.overall.knownFormGtRows, 10);
    expect(reg.overall.resolved + reg.overall.abstained).toBe(reg.overall.knownFormGtRows);
    expect(reg.otherOrUnresolvedGtRows).toBe(0);
    expect(reg.openSetSafety).toBe('NOT_EVALUATED');
    expect(reg.engineeringJudgment).toBe('IMPLEMENTATION_CONFORMANT / STOP FOR REVIEW');
    expect(reg.implementationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});
