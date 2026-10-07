import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
const man = read<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; summary: { coverPages: number; provenanceMismatch: number; parserErrors: number; status: Record<string, number>; outputDigestSha256: string; multilineScopeNamePages: number } }>('implementation-manifest.json');
const reg = read<{
  implementationCommit: string; observationOutputDigestSha256: string; scope: string;
  comparison55: { pages: number; comparedAtomicFields: number; matches: number; mismatches: number; abstentions: number; wrongEntryAttachmentPages: number; entryKindSequence: { pass: number; fail: number }; mismatchRows: unknown[]; descriptiveMatchRate: number };
  development14: { coverPages: number; multilineCases: number };
}>('descriptive-regression.json');
const cls = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-implementation-manifest.json'), 'utf8')) as { summary: { corpusClassificationDigestSha256: string; pageType: Record<string, number> } };
const cand = read<{ population: { allCover: number; developmentExploredCover: number; frozenCandidates: number } }>('frozen-candidates.json');

describe('cover structure v0 implementation（development / descriptive）', () => {
  it('COVER 69 page を provenance 不一致・parser error なしで処理し、population が 14 + 55 = 69 に整合する', () => {
    expect(man.summary.coverPages).toBe(cls.summary.pageType.COVER);
    expect(man.summary.coverPages).toBe(cand.population.developmentExploredCover + cand.population.frozenCandidates);
    expect([man.summary.provenanceMismatch, man.summary.parserErrors]).toEqual([0, 0]);
    expect(Object.values(man.summary.status).reduce((a, b) => a + b, 0)).toBe(69);
    expect(man.frozenInput.pageClassificationCorpusDigestSha256).toBe(cls.summary.corpusClassificationDigestSha256);
  });
  it('descriptive regression は同じ output digest に紐づき、formal validation ではないと明記されている', () => {
    expect(reg.observationOutputDigestSha256).toBe(man.summary.outputDigestSha256);
    expect(reg.scope).toMatch(/formal validation・held-out ではない/);
    expect(reg.scope).toMatch(/protocol-invalid/);
    expect(reg.implementationCommit).toMatch(/^[0-9a-f]{40}$/);
  });
  it('55 page 比較: field 数が整合し、entry 構造の不一致・wrong-entry attachment が 0', () => {
    const c = reg.comparison55;
    expect(c.matches + c.mismatches + c.abstentions).toBe(c.comparedAtomicFields);
    expect(c.pages).toBe(cand.population.frozenCandidates);
    expect([c.entryKindSequence.fail, c.wrongEntryAttachmentPages]).toEqual([0, 0]);
    expect(c.mismatchRows).toHaveLength(c.mismatches);
    expect(c.descriptiveMatchRate).toBeCloseTo(c.matches / c.comparedAtomicFields, 10);
  });
  it('PR-3A development 14 page を回帰対象に含み、multiline が観測されている', () => {
    expect(reg.development14.coverPages).toBe(cand.population.developmentExploredCover);
    expect(reg.development14.multilineCases).toBeGreaterThanOrEqual(2);
  });
});
