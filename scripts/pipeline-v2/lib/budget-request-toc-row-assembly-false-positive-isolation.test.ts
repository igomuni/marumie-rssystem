import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';

const iso = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-false-positive-failure-isolation', '2024');
const ev = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024');
const asm = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const obs = read(path.join(iso, 'observations.json'));
const fam = read(path.join(iso, 'failure-families.json'));
const res = read(path.join(ev, 'evaluation-result.json'));
const out = read(path.join(ev, 'heldout-parser-output.json'));

describe('FALSE_POSITIVE failure isolation（観測の保存。#396 を再判定せず、parser・GT・evaluator を変更しない）', () => {
  it('#396 の result / parser output と frozen 入力の hash が不変', () => {
    expect(sha(path.join(ev, 'evaluation-result.json'))).toBe('fcb1e40cc25969748516c4bbe1673d15418051a5d01d912310118abba4d05f66');
    expect(sha(path.join(ev, 'heldout-parser-output.json'))).toBe('d95abb76ea63e660189167d6d8d6f8f34e9234cb879be18854b44c8b375b6f6b');
    expect(obs.frozen.evaluationResultSha256).toBe(sha(path.join(ev, 'evaluation-result.json')));
    expect(sha(path.join(asm, 'ground-truth.json'))).toBe(obs.frozen.groundTruthSha256);
    expect(sha(path.join(asm, 'evaluation-protocol-amendment.json'))).toBe('958985cc7d895071bb77ad6d57a45de0e82c65677ea45828fb3e916389933f00');
    expect(sha(path.join(asm, 'preregistration.json'))).toBe('0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8');
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe('f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd');
    expect(res.finalJudgment).toBe('STOP_SAFETY');
    expect(res.formalExecutionCount).toBe(1);
    expect(fs.readdirSync(ev).sort()).toEqual(['evaluation-launch-manifest.json', 'evaluation-result.json', 'execution-started.json', 'heldout-parser-output.json']);
  });
  it('severe 10 件が evidence ID ごとに重複・欠落なく観測 table に 1 回ずつ表現されている', () => {
    const evidence = res.summary.severe.FALSE_POSITIVE_ROW_ASSEMBLY.evidence as { gtRowId: string; parserUnit: string }[];
    expect(res.summary.severe.total).toBe(10);
    expect(obs.severeExpected).toBe(10); expect(obs.severeObserved).toBe(10); expect(obs.observations).toHaveLength(10);
    expect(new Set(obs.observations.map((o: { evidenceId: string }) => o.evidenceId)).size).toBe(10);
    expect(obs.observations.map((o: { gtRowId: string; parserUnitId: string }) => `${o.gtRowId}|${o.parserUnitId}`)).toEqual(evidence.map(e => `${e.gtRowId}|${e.parserUnit}`));
    expect(new Set(obs.observations.map((o: { localPdfPath: string; physicalPage: number }) => `${o.localPdfPath}#${o.physicalPage}`)).size).toBe(5);
    for (const o of obs.observations) expect(o.severeFamily).toBe('FALSE_POSITIVE_ROW_ASSEMBLY');
  });
  it('family assignment が 10 件全てを 1 回ずつ覆い、件数合計 = 10、causal status が分離されている', () => {
    expect(fam.assignment).toHaveLength(10);
    expect(fam.assignment.every((a: { family: string }) => a.family !== 'UNCLASSIFIED')).toBe(true);
    expect(fam.accounting).toMatchObject({ severeTotal: 10, familyCountSum: 10, unclassified: 0, uniqueEvidenceIds: 10, affectedPages: 5 });
    expect(fam.families.reduce((a: number, f: { count: number }) => a + f.count, 0)).toBe(10);
    expect(fam.accounting.mechanisticallyExplained + fam.accounting.hypothesized + fam.accounting.unresolved).toBe(10);
    for (const f of fam.families) expect(['OBSERVED_PATTERN', 'MECHANISTICALLY_EXPLAINED', 'HYPOTHESIZED_CAUSE', 'UNRESOLVED']).toContain(f.causalStatus);
    expect(fam.judgment).toBe('READY_FOR_FALSE_POSITIVE_HYPOTHESIS_FORMATION');
  });
  it('観測の sourceRawSlice / provenance が保存済み parser output と一致する（再実行なし）', () => {
    for (const o of obs.observations) {
      const page = out.pages.find((p: { localPdfPath: string; physicalPage: number }) => p.localPdfPath === o.localPdfPath && p.physicalPage === o.physicalPage);
      const u = page.rows.find((r: { provenance: { lineIndex: number; sourceRawSlice: string }; column: string; sourceOrder: number }) => r.provenance.lineIndex === o.sourceLineIndex && `${r.column}:${r.sourceOrder}` === o.parserUnitId.split('#')[1].split('@')[0].split(':').slice(1).join(':'));
      expect(u.provenance.sourceRawSlice).toBe(o.sourceRawSlice);
      expect(page.pageState).toBe(o.parserPageState);
      expect(Array.from(o.sourceRawLine).slice(u.provenance.charStart, u.provenance.charEnd).join('')).toBe(o.sourceRawSlice);
    }
  });
  it('visual inspection・GT 変更・fix simulation を行っていない', () => {
    expect(fam.visualInspection).toMatchObject({ performed: false, gtChanged: false });
    expect(fs.existsSync(path.join(iso, 'visual-inspection-ledger.json'))).toBe(false);
    expect(JSON.stringify(fam)).not.toMatch(/fix simulation の結果|何件直る/);
  });
});
