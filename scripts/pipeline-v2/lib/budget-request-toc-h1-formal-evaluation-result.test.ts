import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';
import { aggregate, SEVERE_FAMILIES, type PageResult } from './budget-request-toc-row-assembly-evaluator';
import { h1FinalJudgment } from './budget-request-toc-h1-formal-evaluation';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-h1-formal-evaluation', '2024');
const h1d = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lm = read(path.join(dir, 'evaluation-launch-manifest.json'));
const res = read(path.join(dir, 'formal-evaluation-result.json'));
const out = read(path.join(dir, 'new-heldout-h1-output.json'));
const mem = read(path.join(h1d, 'new-heldout-membership.json'));

describe('H1 one-shot formal evaluation の保存結果の integrity（H1 は再実行せず、保存済み出力・結果の再集計のみ）', () => {
  it('H1 の formal execution は 1 回、retry・failure artifact なし、launch manifest と evaluator hash が一致する', () => {
    expect(res.formalExecutionCount).toBe(1); expect(out.formalExecutionCount).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual(['evaluation-launch-manifest.json', 'execution-started.json', 'formal-evaluation-result.json', 'new-heldout-h1-output.json']);
    expect(lm.h1ExecutionsOnNewHeldoutBefore).toBe(0);
    for (const [f, h] of Object.entries(lm.evaluatorSha256 as Record<string, string>)) expect(sha(f)).toBe(h);
    expect(res.launchManifestSha256).toBe(sha(path.join(dir, 'evaluation-launch-manifest.json')));
    expect(res.h1OutputSha256).toBe(sha(path.join(dir, 'new-heldout-h1-output.json')));
    expect(res.protocolCompliance).toMatchObject({ compliant: true, retries: 0, candidateDropOrReplacement: 0, evaluatorChangedAfterLaunch: false });
  });
  it('frozen 入力（H1 source・membership・GT・ledger・render・freeze manifest・#393・#395）の hash が launch 時のまま', () => {
    const h = lm.frozenDependencyHashes;
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts')).toBe(h.h1SourceSha256);
    expect(sha(path.join(h1d, 'new-heldout-membership.json'))).toBe(h.membershipFileSha256);
    expect(sha(path.join(h1d, 'new-heldout-ground-truth.json'))).toBe(h.groundTruthSha256);
    expect(sha(path.join(h1d, 'new-heldout-annotation-ledger.json'))).toBe(h.annotationLedgerSha256);
    expect(sha(path.join(h1d, 'new-heldout-render-manifest.json'))).toBe(h.renderManifestSha256);
    expect(sha(path.join(h1d, 'new-heldout-visual-gt-freeze-manifest.json'))).toBe(h.visualGtFreezeManifestSha256);
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe(h.parser393SourceSha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly/2024/evaluation-protocol-amendment.json')).toBe(h.amendment395Sha256);
    expect(mem.digestSha256).toBe('06c2e68d7ac178e7e0561d16976c47936ab9d52b59d91710cab145fa8822ab28');
  });
  it('25 page 全件が membership の canonical order で出力・評価され、保存済み page result の再集計が summary と一致する（決定的）', () => {
    expect(out.pages).toHaveLength(25); expect(res.pages).toHaveLength(25);
    expect(out.pages.map((p: { localPdfPath: string; physicalPage: number }) => `${p.localPdfPath}#${p.physicalPage}`)).toEqual(mem.members.map((m: { localPdfPath: string; physicalPage: number }) => `${m.localPdfPath}#${m.physicalPage}`));
    expect(JSON.stringify(aggregate(res.pages as PageResult[]))).toBe(JSON.stringify(res.summary));
  });
  it('severe 件数・分母分子・trigger 集計・final judgment が内部整合している', () => {
    const s = res.summary;
    expect(SEVERE_FAMILIES.reduce((a, f) => a + s.severe[f].count, 0)).toBe(s.severe.total);
    for (const f of SEVERE_FAMILIES) expect(s.severe[f].evidence).toHaveLength(s.severe[f].count);
    const st = s.rows.states;
    expect(st.CORRECT + st.INCORRECT + st.ABSTAINED + st.UNRESOLVED).toBe(s.rows.gtComparable);
    expect(s.coverage.physicalRowCoverage.denominator).toBe(s.rows.gtComparable);
    expect(s.coverage.pageResolutionCoverage.denominator).toBe(25);
    const t = res.h1Trigger;
    expect(t.tokenTypes.REQUEST + t.tokenTypes.MARKER + t.tokenTypes.OTHER_CODE).toBe(t.positiveTriggerLines);
    expect(t.splitLines).toBe(t.positiveTriggerLines);
    expect(res.finalJudgment).toBe(h1FinalJudgment(res.protocolCompliance.compliant, s.severe.total, t.positiveTriggerLines, s.blockingUnresolved.count));
  });
  it('acceptance threshold を新設していない', () => {
    expect(JSON.stringify(res)).not.toMatch(/acceptanceThreshold|passThreshold|coverageLowerBound/i);
    expect(res.note).toMatch(/retry をしない/);
    expect(res.note).toMatch(/paired comparison ではない/);
  });
});
