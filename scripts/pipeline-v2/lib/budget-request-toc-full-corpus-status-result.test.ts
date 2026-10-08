import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';
import { CANDIDATE_REASONS, PARTITIONS, summarize, type PageObservation } from './budget-request-toc-full-corpus-status';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-full-corpus-status', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const status = read(path.join(dir, 'full-corpus-status.json'));
const queue = read(path.join(dir, 'human-review-queue.json'));
const out = read(path.join(dir, 'full-corpus-h1-output.json'));
const man = read(path.join(dir, 'assessment-manifest.json'));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const inv = read('tests/fixtures/budget-request-toc-physical-row/2024/candidate-inventory.json').pages as { localPdfPath: string; physicalPage: number }[];

describe('POST_HOC full-corpus status assessment の integrity（H1 / GT / formal result は変更しない）', () => {
  it('status が POST_HOC で、formal 結果・H1・#393 の hash が不変、出力 hash が manifest と一致する', () => {
    expect(man.status).toBe('POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT');
    expect(status.status).toBe('POST_HOC_FULL_CORPUS_STATUS_ASSESSMENT');
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts')).toBe('ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343');
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe(man.parser393SourceSha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly-evaluation/2024/evaluation-result.json')).toBe(man.formalResultHashes.result396);
    expect(sha('tests/fixtures/budget-request-toc-h1-formal-evaluation/2024/formal-evaluation-result.json')).toBe(man.formalResultHashes.result402);
    expect(sha('tests/fixtures/budget-request-toc-h1-formal-evaluation/2024/new-heldout-h1-output.json')).toBe(man.formalResultHashes.newHeldoutH1Output402);
    expect(sha(path.join(dir, 'full-corpus-h1-output.json'))).toBe(man.outputHashes.fullCorpusH1Output);
    expect(sha(path.join(dir, 'full-corpus-status.json'))).toBe(man.outputHashes.fullCorpusStatus);
    expect(sha(path.join(dir, 'human-review-queue.json'))).toBe(man.outputHashes.humanReviewQueue);
    expect(fs.readdirSync(dir).sort()).toEqual(['assessment-manifest.json', 'full-corpus-h1-output.json', 'full-corpus-status.json', 'human-review-queue.json']);
    expect(man.claimBoundary).toMatch(/formal held-out evaluation ではない/);
  });
  it('34 + 23 + 25 = 82、overlap 0、出力は canonical TOC 82 page と一致し重複がない', () => {
    expect(status.population).toMatchObject({ total: 82, DEVELOPMENT_EXPLORED: 34, FIRST_HELDOUT_POSTHOC: 23, NEW_HELDOUT_POSTHOC: 25, overlaps: 0, deterministicRerunIdentical: true, new25OutputIdenticalToFormal402Output: true });
    const pages = status.pages as PageObservation[];
    expect(pages).toHaveLength(82); expect(out.pages).toHaveLength(82);
    expect(new Set(pages.map(key)).size).toBe(82);
    expect([...new Set(pages.map(key))].sort()).toEqual(inv.map(key).sort());
    expect(out.pages.map(key)).toEqual(pages.map(key));
    for (const p of PARTITIONS) expect(pages.filter(x => x.partition === p).length).toBe({ DEVELOPMENT_EXPLORED: 34, FIRST_HELDOUT_POSTHOC: 23, NEW_HELDOUT_POSTHOC: 25 }[p]);
    expect(man.partitions).toMatchObject({ total: 82, overlaps: 0 });
  });
  it('集計は deterministic に再計算でき、partition 別の合計が ALL と一致する', () => {
    const pages = status.pages as PageObservation[];
    expect(JSON.stringify(summarize(pages))).toBe(JSON.stringify(status.byPartition.ALL));
    const parts = [status.byPartition.DEVELOPMENT_EXPLORED, status.byPartition.FIRST_HELDOUT_POSTHOC_POSTHOC_REEXECUTION, status.byPartition.NEW_HELDOUT_POSTHOC_POSTHOC_REEXECUTION];
    for (const f of [(s: typeof status.byPartition.ALL) => s.pages, (s: typeof status.byPartition.ALL) => s.units.total, (s: typeof status.byPartition.ALL) => s.h1.triggerLines, (s: typeof status.byPartition.ALL) => s.h1.negativeControlLines]) expect(parts.reduce((a: number, s: typeof status.byPartition.ALL) => a + f(s), 0)).toBe(f(status.byPartition.ALL));
    const a = status.byPartition.ALL;
    expect(a.pageState.SPLIT + a.pageState.UNSPLIT + a.pageState.ABSTAINED).toBe(82);
    expect(a.rightBand.resolved + a.rightBand.unresolvedOrNoEvidence).toBe(82);
    expect(a.h1.splitLines).toBe(a.h1.triggerLines);
  });
  it('human review queue は 82 population 内で、candidate reason は定義済み enum のみ、priority を持たない', () => {
    const all = new Set((status.pages as PageObservation[]).map(key));
    for (const q of queue.pages) { expect(all.has(key(q))).toBe(true); expect(q.candidateReasons.length).toBeGreaterThan(0); for (const r of q.candidateReasons) expect(CANDIDATE_REASONS).toContain(r); expect(['GT_AVAILABLE', 'GT_UNAVAILABLE']).toContain(q.gtStatus); }
    expect(new Set(queue.pages.map(key)).size).toBe(queue.pages.length);
    expect(JSON.stringify(queue)).not.toMatch(/priority":|severity":/);
    expect(status.humanReviewQueue.pages).toBe(queue.pages.length);
    expect(queue.pages.filter((q: { partition: string; gtStatus: string }) => q.partition === 'DEVELOPMENT_EXPLORED').every((q: { gtStatus: string }) => q.gtStatus === 'GT_UNAVAILABLE')).toBe(true);
  });
  it('existing-GT status は 23 / 25 を独立集計し、combined48 は descriptive 限定、GT なしの development は GT_UNAVAILABLE', () => {
    const g = status.existingGtStatus;
    expect(g.label).toBe('POST_HOC_STATUS_ONLY');
    expect(g.combined48.label).toBe('DESCRIPTIVE_AGGREGATE_ONLY_NOT_A_FORMAL_HELDOUT_RESULT');
    expect(g.first23_currentH1_posthoc.pages).toBe(23); expect(g.new25_currentH1_posthoc.pages).toBe(25); expect(g.combined48.pages).toBe(48);
    expect(g.first23_currentH1_posthoc.rows.gtComparable + g.new25_currentH1_posthoc.rows.gtComparable).toBe(g.combined48.rows.gtComparable);
    expect(g.first23_currentH1_posthoc.severe.total + g.new25_currentH1_posthoc.severe.total).toBe(g.combined48.severe.total);
    expect(status.machineObservedStatusTaxonomy.GT_UNAVAILABLE).toBe(status.observability.E_evaluationApplicability.gtUnavailableParserComparableUnits);
    expect(status.claimBoundary).toMatch(/production GO・B 層 GO ではない/);
    expect(JSON.stringify(status)).not.toMatch(/acceptanceThreshold|passThreshold/);
  });
});
