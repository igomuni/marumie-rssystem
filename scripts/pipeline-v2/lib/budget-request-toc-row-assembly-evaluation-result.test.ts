import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';
import { aggregate, finalJudgment, SEVERE_FAMILIES, type PageResult } from './budget-request-toc-row-assembly-evaluator';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024');
const asm = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lm = read(path.join(dir, 'evaluation-launch-manifest.json'));
const res = read(path.join(dir, 'evaluation-result.json'));
const out = read(path.join(dir, 'heldout-parser-output.json'));

describe('one-shot held-out evaluation の保存結果の integrity（再実行せず、保存済み raw result の再集計のみ）', () => {
  it('formal execution は 1 回、retry・failure artifact なし、launch manifest の hash が現行と一致する', () => {
    expect(res.formalExecutionCount).toBe(1);
    expect(out.formalExecutionCount).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual(['evaluation-launch-manifest.json', 'evaluation-result.json', 'execution-started.json', 'heldout-parser-output.json']);
    expect(lm.formalExecutionCountBefore).toBe(0);
    for (const [f, h] of Object.entries(lm.evaluatorSha256 as Record<string, string>)) expect(sha(f)).toBe(h);
    expect(res.launchManifestSha256).toBe(sha(path.join(dir, 'evaluation-launch-manifest.json')));
    expect(res.parserOutputSha256).toBe(sha(path.join(dir, 'heldout-parser-output.json')));
    expect(res.protocolCompliance).toMatchObject({ compliant: true, retries: 0, candidateDropOrReplacement: 0, evaluatorChangedAfterLaunch: false });
  });
  it('frozen 入力の hash が launch 時の値のまま（#391 / #392 / #393 / #395 / membership）', () => {
    const h = lm.frozenDependencyHashes;
    expect(sha(path.join(asm, 'preregistration.json'))).toBe(h.preregistrationSha256);
    expect(sha(path.join(asm, 'ground-truth.json'))).toBe(h.groundTruthSha256);
    expect(sha(path.join(asm, 'evaluation-protocol-amendment.json'))).toBe(h.amendmentSha256);
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe(h.parserSourceSha256);
    expect(read(path.join(asm, 'heldout-candidates.json')).membershipDigestSha256).toBe(h.membershipDigestSha256);
  });
  it('23 page 全件が評価され、保存済み page result の再集計が summary と一致する（決定的）', () => {
    expect(res.pages).toHaveLength(23);
    expect(out.pages).toHaveLength(23);
    expect(JSON.stringify(aggregate(res.pages as PageResult[]))).toBe(JSON.stringify(res.summary));
  });
  it('severe 件数・分母分子・judgment が内部整合している', () => {
    const s = res.summary;
    expect(SEVERE_FAMILIES.reduce((a, f) => a + s.severe[f].count, 0)).toBe(s.severe.total);
    for (const f of SEVERE_FAMILIES) expect(s.severe[f].evidence).toHaveLength(s.severe[f].count);
    const st = s.rows.states;
    expect(st.CORRECT + st.INCORRECT + st.ABSTAINED + st.UNRESOLVED).toBe(s.rows.gtComparable);
    expect(s.coverage.physicalRowCoverage.denominator).toBe(s.rows.gtComparable);
    expect(s.coverage.pageResolutionCoverage.denominator).toBe(23);
    expect(res.finalJudgment).toBe(finalJudgment(res.protocolCompliance.compliant, s.severe.total, s.blockingUnresolved.count));
    expect(res.finalJudgment).toMatch(/^(STOP_PROTOCOL|STOP_SAFETY|REVIEW_REQUIRED|SAFETY_PASS_COVERAGE_REPORTED)$/);
  });
  it('acceptance threshold を新設していない（coverage は報告のみ）', () => {
    expect(JSON.stringify(res)).not.toMatch(/acceptanceThreshold|passThreshold|coverageLowerBound/i);
    expect(res.note).toMatch(/retry をしない/);
  });
});
