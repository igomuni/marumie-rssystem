import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-human-review-failure-isolation', '2024');
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const obs = read(path.join(dir, 'observations.json'));
const P = (id: string) => obs.pages.find((p: { id: string }) => p.id === id);

describe('human review failure isolation の観測（read-only。parser / H1 / GT / 評価 contract は変更しない）', () => {
  it('#403 の出力・H1・#393・#402 の hash が不変で、7 page 全てで保存済み出力を再現できる', () => {
    expect(sha('tests/fixtures/budget-request-toc-full-corpus-status/2024/full-corpus-h1-output.json')).toBe(obs.frozen.full_corpus_h1_output_403_sha256);
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts')).toBe('ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343');
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe('f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd');
    expect(sha('tests/fixtures/budget-request-toc-h1-formal-evaluation/2024/formal-evaluation-result.json')).toBe('7b024a25dd3f62b4987126fd275f9275b4afbf40b7569df490175fb9c83f2283');
    expect(obs.pages.map((p: { id: string }) => p.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
    for (const p of obs.pages) expect(p.reproducesSaved403Output).toBe(true);
  });
  it('H4 / H5 / H6: 右 column の request-kind evidence はちょうど 1 件で、RIGHT_EVIDENCE_INSUFFICIENT の exact condition（evidence 件数 = 1）に一致する', () => {
    for (const id of ['H4', 'H5', 'H6']) { const p = P(id); expect(p.pageState).toBe('PAGE_ABSTAINED'); expect(p.pageAbstentionReason).toBe('RIGHT_EVIDENCE_INSUFFICIENT'); expect(p.evidence.countedEvidence).toBe(1); expect(p.evidence.bandMinEvidence).toBe(2); }
    expect(P('H4').evidence.requestTokenCandidatesAll).toBe(20); expect(P('H6').evidence.requestTokenCandidatesAll).toBe(23);
    // H5: 右 column の request token 30 件は index 55 に揃うが、全て先頭 token（右のみの raw line）で evidence に数えられない
    const h = P('H5').evidence.requestTokenStartHistogram;
    expect(h['55']).toEqual({ all: 30, counted: 0 }); expect(h['53']).toEqual({ all: 1, counted: 1 });
    expect(P('H5').evidence.notCountedByReason.notPrecededByDigitsAndWhitespace_nonFirst).toBe(0);
  });
  it('H2: human 3 continuation のうち req18 は header zone の whole-line TITLE（line 10）、req19 / req23 は GT owner と一致して attach', () => {
    const p = P('H2');
    expect(p.titleUnits.some((t: { column: string; lineIndex: number; slice: string }) => t.column === 'UNSPLIT' && t.lineIndex === 10 && t.slice === 'に必要な経費')).toBe(true);
    expect(p.fragmentAttachments.map((a: { owner: { rowStartTokenRaw: string }; fragments: { lineIndex: number }[] }) => [a.owner.rowStartTokenRaw.split(/\s+/)[0], a.fragments[0].lineIndex])).toEqual([['19', 15], ['23', 32]]);
    expect(p.gt.evaluation.fragments).toMatchObject({ gt: 3, correct: 2, incorrect: 1, wrongAttachment: 0 });
    expect(p.gt.evaluation.instances.map((i: { family: string }) => i.family)).toEqual(['OMITTED_SILENTLY_FRAGMENT']);
  });
  it('H3: 5 attach の owner は GT owner と key 一致。4 件 CORRECT、1 件は duplicate 項 030 の group（n=2, m=2）で UNRESOLVED（GT 側と parser 側で 2 件に数えられる）', () => {
    const p = P('H3');
    expect(p.fragmentAttachments).toHaveLength(5);
    expect(p.gt.evaluation.fragments).toMatchObject({ gt: 5, correct: 4, incorrect: 0, unresolved: 2, wrongAttachment: 0 });
    expect(p.gt.evaluation.groupsNotOneToOne.find((g: { key: string }) => g.key === 'M|（項）|030')).toMatchObject({ n: 2, m: 2 });
    expect(p.gt.evaluation.instances.every((i: { family: string }) => i.family === 'AMBIGUOUS_OWNER_GROUP')).toBe(true);
    expect(p.pageState).toBe('ASSEMBLED_UNSPLIT_NO_RIGHT_COLUMN_EVIDENCE');
  });
  it('H7: machine の fragment（owner req18・line 62）は human の req23 continuation（header zone の line 8）とは別の raw line', () => {
    const p = P('H7');
    expect(p.fragmentAttachments).toHaveLength(1);
    expect(p.fragmentAttachments[0].owner.rowStartTokenRaw.split(/\s+/)[0]).toBe('18');
    expect(p.fragmentAttachments[0].fragments[0].lineIndex).toBe(62);
    expect(p.titleUnits.some((t: { column: string; lineIndex: number; slice: string }) => t.column === 'UNSPLIT' && t.lineIndex === 8 && t.slice === 'に必要な経費')).toBe(true);
    expect(p.gt.available).toBe(false);
  });
  it('H1: 右 column の evidence は 0 で UNSPLIT。parser は入力に geometry を持たない（text のみ）', () => {
    expect(P('H1').evidence.countedEvidence).toBe(0);
    const src = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts', 'utf8');
    const iface = src.slice(src.indexOf('export interface TocPageInput'), src.indexOf('export interface Provenance'));
    expect(iface).not.toMatch(/geometry|stroke|rule|bbox|x0|y0/i);
  });
});
