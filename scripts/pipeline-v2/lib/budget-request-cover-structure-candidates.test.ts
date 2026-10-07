import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const cand = read<{
  frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string };
  population: { allCover: number; developmentExploredCover: number; frozenCandidates: number; overlapWithExplored: number; hashMismatch: number };
  candidateDigestSha256: string;
  candidates: { filePath: string; fileSha256: string; physicalPage: number; textSha256: string; classifierPageType: string; evaluationRole: string }[];
}>(path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024', 'frozen-candidates.json'));
const ledger = read<{ pages: { localPdfPath: string; physicalPage: number; classifierPageType: string }[] }>(path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024', 'development-explored-pages.json'));
const raw = read<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const cls = read<{ summary: { corpusClassificationDigestSha256: string; pageType: Record<string, number> } }>(path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-implementation-manifest.json'));

describe('cover structure v0 frozen candidates（preregistration freeze）', () => {
  it('母集団 = COVER 全 page − PR-3A explored COVER（69 − 14 = 55）で、explored と重ならない', () => {
    expect(cand.frozenInput.rawTextCorpusDigestSha256).toBe(raw.frozenInput.corpusDigestSha256);
    expect(cand.frozenInput.pageClassificationCorpusDigestSha256).toBe(cls.summary.corpusClassificationDigestSha256);
    expect(cand.population.allCover).toBe(cls.summary.pageType.COVER);
    const explored = ledger.pages.filter(p => p.classifierPageType === 'COVER');
    expect(cand.population.developmentExploredCover).toBe(explored.length);
    expect(cand.population.frozenCandidates).toBe(cand.population.allCover - explored.length);
    expect(cand.population.frozenCandidates).toBe(55);
    const ex = new Set(explored.map(p => `${p.localPdfPath}#${p.physicalPage}`));
    expect(cand.candidates.filter(c => ex.has(`${c.filePath}#${c.physicalPage}`))).toEqual([]);
    expect([cand.population.overlapWithExplored, cand.population.hashMismatch]).toEqual([0, 0]);
  });
  it('key が unique で hash が Raw Text manifest と一致し、label / Raw Text 本文を含まない', () => {
    expect(new Set(cand.candidates.map(c => `${c.filePath}#${c.physicalPage}`)).size).toBe(cand.candidates.length);
    const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
    for (const c of cand.candidates) {
      const d = docs.get(c.filePath)!;
      expect([d.pdfSha256, d.pageTextSha256[c.physicalPage - 1]]).toEqual([c.fileSha256, c.textSha256]);
      expect([c.classifierPageType, c.evaluationRole]).toEqual(['COVER', 'FROZEN_EVALUATION']);
      expect(Object.keys(c).sort()).toEqual(['classifierPageType', 'evaluationRole', 'filePath', 'fileSha256', 'physicalPage', 'textSha256']);
    }
  });
  it('candidate digest が candidate 行から再計算できる', () => {
    expect(cand.candidateDigestSha256).toBe(sha256Hex(cand.candidates.map(r => `${r.filePath} ${r.fileSha256} ${r.physicalPage} ${r.textSha256}`).join('\n')));
  });
});
