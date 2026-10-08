import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';
import { ruleConfigSha256 } from './budget-request-toc-row-assembly';

const h1dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const res = read(path.join(h1dir, 'development-result.json'));
const diff = read(path.join(h1dir, 'development-differential.json'));
const held = new Set((read(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024', 'heldout-candidates.json')).pages as { localPdfPath: string; physicalPage: number }[]).map(p => `${p.localPdfPath}#${p.physicalPage}`));

describe('H1 development-only 結果の integrity（再集計のみ。held-out には実行していない）', () => {
  it('H1 source hash が評価時と同一（評価後の code 変更なし）で、#393 source・#398 preregistration も不変', () => {
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts')).toBe(res.h1.sourceSha256);
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe('f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd');
    expect(res.h1.baseline393SourceSha256).toBe('f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd');
    expect(sha(path.join(h1dir, 'preregistration.json'))).toBe('0c3a377ba9d32ec55701f8d0982ff9a48e8cd9f16ba8c81927fcedffcdec1b27');
    expect(res.h1.ruleConfigSha256).toBe(ruleConfigSha256());
  });
  it('development は exactly 34 page で、#396 held-out と重ならず、held-out / 将来 held-out への実行は 0', () => {
    expect(diff.pages).toHaveLength(34);
    expect(new Set(diff.pages.map((p: { localPdfPath: string; physicalPage: number }) => `${p.localPdfPath}#${p.physicalPage}`)).size).toBe(34);
    expect(diff.pages.filter((p: { localPdfPath: string; physicalPage: number }) => held.has(`${p.localPdfPath}#${p.physicalPage}`))).toEqual([]);
    expect(res.population).toEqual({ developmentPages: 34, heldout396Executed: 0, futureHeldoutExecuted: 0 });
    expect(fs.readdirSync(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024')).sort()).toEqual(['evaluation-launch-manifest.json', 'evaluation-result.json', 'execution-started.json', 'heldout-parser-output.json']);
  });
  it('differential の accounting が整合（trigger = expected = actual split、許可外差 0、falsification なし）', () => {
    const sum = (f: (p: { census: { triggerLines: number[]; negativeControlLines: number[] }; report: { triggerLineChanges: number; falseSplits: string[]; undeclared: string[]; provenanceMismatches: number; declaredDownstreamFragments: number } }) => number) => diff.pages.reduce((a: number, p: never) => a + f(p), 0);
    const trig = sum(p => p.census.triggerLines.length);
    expect(res.census.triggerLines).toBe(trig);
    expect(res.metrics.primaryTarget).toMatchObject({ eligibleTriggerCount: trig, expectedSplitCount: trig, actualSplitCount: sum(p => p.report.triggerLineChanges), triggerMismatches: 0 });
    expect(sum(p => p.report.falseSplits.length) + sum(p => p.report.undeclared.length) + sum(p => p.report.provenanceMismatches)).toBe(0);
    expect(res.metrics.primarySafety).toMatchObject({ falseSplitCount: 0, provenanceMismatch: 0, unrelatedRowOutputChanges: 0, unexpectedPageStateChanges: 0 });
    expect(res.census.tokenTypes.REQUEST + res.census.tokenTypes.MARKER + res.census.tokenTypes.OTHER_CODE).toBe(trig);
    expect(res.metrics.secondary.leftTitleCount).toBe(trig);
    expect(res.differentialSummary.identicalToBaselinePages + res.differentialSummary.pagesWithDifferences).toBe(34);
    expect(res.differentialSummary.pagesWithDifferences).toBe(diff.pages.filter((p: { census: { triggerLines: number[] } }) => p.census.triggerLines.length > 0).length);
    expect(res.falsification).toEqual({ safetyRegression: 0, triggerImplementationMismatch: 0 });
  });
  it('judgment と DEV_SYNTHETIC_ONLY が trigger 件数と整合し、#396 severe を metric に使わない', () => {
    expect(res.devSyntheticOnly).toBe(res.census.triggerLines === 0);
    expect(res.judgment).toBe(res.devSyntheticOnly ? 'READY_FOR_H1_SYNTHETIC_ONLY_FREEZE_AND_NEW_HELDOUT_GT' : 'READY_FOR_H1_DEVELOPMENT_FREEZE_AND_NEW_HELDOUT_GT');
    expect(JSON.stringify(res.metrics)).not.toMatch(/severe|396/i);
    expect(res.claimBoundary).toMatch(/確認していない/);
  });
});
