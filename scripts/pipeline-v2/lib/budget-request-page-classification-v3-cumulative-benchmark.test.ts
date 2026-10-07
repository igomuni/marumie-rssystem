import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { THRESHOLDS, computeAdequacy, judge, keyOf, type CumulativeRow } from './budget-request-page-classification-v3-cumulative';

const dir = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
const bench = read<{
  preregistrationCommit: string;
  frozenInput: { rawTextCorpusDigestSha256: string; files: Record<string, string> };
  summary: { sourceRows: Record<string, number>; uniqueRows: number; pairwiseOverlap: Record<string, number>; duplicateOrAmbiguousJoin: number; hashMismatch: number; bySourceEvaluationRole: Record<string, number> };
  adequacy: ReturnType<typeof computeAdequacy> & { judgment: string };
  rows: CumulativeRow[];
}>('page-classification-v3-cumulative-benchmark.json');
const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] };
const gtFiles = { v0: 'page-classification-v0-visual-gt.json', v1: 'page-classification-v1-eval-visual-gt.json', v2: 'page-classification-v2-visual-gt.json' } as const;

describe('page classification v3 cumulative benchmark（mechanical freeze）', () => {
  it('v0/v1/v2 GT の件数・overlap・unique 数と original role が保存されている', () => {
    expect(bench.summary.sourceRows).toEqual({ v0: 172, v1: 89, v2: 170 });
    expect(Object.values(bench.summary.pairwiseOverlap).every(n => n === 0)).toBe(true);
    expect(bench.summary.uniqueRows).toBe(431);
    expect(new Set(bench.rows.map(keyOf)).size).toBe(431);
    expect([bench.summary.duplicateOrAmbiguousJoin, bench.summary.hashMismatch]).toEqual([0, 0]);
    expect(bench.summary.bySourceEvaluationRole).toEqual({ 'v0|DEVELOPMENT': 142, 'v0|FROZEN_EVALUATION': 30, 'v1|FROZEN_EVALUATION_V1': 89, 'v2|FROZEN_EVALUATION_V2': 170 });
  });
  it('各 row の GT・role・hash が source GT fixture と一致し（label 無変更）、Raw Text manifest とも整合する', () => {
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    expect(bench.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    for (const v of ['v0', 'v1', 'v2'] as const) {
      const src = read<{ rows: { localPdfPath: string; physicalPage: number; pdfSha256: string; textSha256: string; evaluationRole: string; gt: { pageType: string } }[] }>(gtFiles[v]).rows;
      const mine = new Map(bench.rows.filter(r => r.sourceVersion === v).map(r => [keyOf(r), r]));
      expect(mine.size).toBe(src.length);
      for (const s of src) {
        const r = mine.get(keyOf(s))!;
        expect([r.gt.pageType, r.sourceEvaluationRole, r.pdfSha256, r.textSha256]).toEqual([s.gt.pageType, s.evaluationRole, s.pdfSha256, s.textSha256]);
        const d = docs.get(s.localPdfPath)!;
        expect([d.pdfSha256, d.pageTextSha256[s.physicalPage - 1]]).toEqual([s.pdfSha256, s.textSha256]);
      }
    }
  });
  it('matched 条件は machine family == GT family を要求する', () => {
    for (const r of bench.rows) {
      if (r.directMatched) expect(r.machineEvidence.directFamily).toBe(r.gt.pageType);
      if (r.continuationMatched) expect(r.machineEvidence.activeStateFamily).toBe(r.gt.pageType);
    }
  });
  it('adequacy が fixture の rows から決定的に再計算でき、threshold は v2 のまま、openSetSafety は NOT_EVALUATED', () => {
    const a = computeAdequacy(bench.rows);
    const { judgment, ...stored } = bench.adequacy;
    expect(a).toEqual(stored);
    expect(judgment).toBe(judge(a, bench.summary.hashMismatch + bench.summary.duplicateOrAmbiguousJoin));
    expect(THRESHOLDS).toEqual({ corePerFamily: 10, directPerCoreFamily: 5, continuationPerFamily: 5 });
    expect(a.openSetSafety).toBe('NOT_EVALUATED');
    expect(bench.preregistrationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
  it('既存 v0/v1/v2 fixture の hash が frozenInput に記録されたものと一致する（無変更）', () => {
    // frozen input の file hash は freeze 時点の記録。後続で書き換わればここで検出する
    for (const [f, h] of Object.entries(bench.frozenInput.files)) expect(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')).toBe(h);
  });
});
