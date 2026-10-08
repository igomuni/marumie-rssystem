import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './budget-request-raw-text';
import * as h1 from './budget-request-toc-row-assembly-h1';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const m = JSON.parse(fs.readFileSync(path.join(dir, 'implementation-freeze-manifest.json'), 'utf8'));

describe('H1 implementation freeze の integrity（実装は変更しない）', () => {
  it('H1 source・#393 source・H1 prereg の hash が freeze 値のまま、entry point が export されている', () => {
    expect(m.status).toBe('H1_IMPLEMENTATION_FROZEN');
    expect(sha(m.h1.sourcePath)).toBe(m.h1.sourceSha256);
    expect(m.h1.sourceSha256).toBe('ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343');
    expect(sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts')).toBe(m.dependencies.parser393SourceSha256);
    expect(sha(path.join(dir, 'preregistration.json'))).toBe(m.dependencies.h1PreregistrationSha256);
    expect(m.h1.entryPoint).toBe('assembleTocPageH1');
    expect(typeof (h1 as Record<string, unknown>)[m.h1.entryPoint]).toBe('function');
    expect(m.h1.changedAfterDevelopmentEvaluation).toBe(false);
  });
  it('development result / synthetic / differential と関連 test・script の hash が固定値のまま', () => {
    expect(sha(path.join(dir, 'development-result.json'))).toBe(m.developmentArtifacts.resultSha256);
    expect(sha(path.join(dir, 'development-synthetic.json'))).toBe(m.developmentArtifacts.syntheticSha256);
    expect(sha(path.join(dir, 'development-differential.json'))).toBe(m.developmentArtifacts.differentialSha256);
    for (const [f, h] of Object.entries(m.fileSha256 as Record<string, string>)) expect(sha(f)).toBe(h);
    expect(m.developmentJudgment).toBe('READY_FOR_H1_DEVELOPMENT_FREEZE_AND_NEW_HELDOUT_GT');
    expect(m.developmentSummary).toMatchObject({ pages: 34, triggerLines: 19, triggerPages: 10, falsification: { safetyRegression: 0, triggerImplementationMismatch: 0 }, devSyntheticOnly: false });
  });
  it('#391 / #395 / #396 / #397 の dependency hash が不変で、held-out 実行は #396 の 1 回のみ', () => {
    const d = m.dependencies;
    expect(sha('tests/fixtures/budget-request-toc-row-assembly/2024/preregistration.json')).toBe(d.preregistration391Sha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly/2024/evaluation-protocol-amendment.json')).toBe(d.amendment395Sha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly-evaluation/2024/evaluation-result.json')).toBe(d.evaluationResult396Sha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly-evaluation/2024/heldout-parser-output.json')).toBe(d.heldoutParserOutput396Sha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly-false-positive-failure-isolation/2024/observations.json')).toBe(d.isolationObservations397Sha256);
    expect(sha('tests/fixtures/budget-request-toc-row-assembly-false-positive-failure-isolation/2024/failure-families.json')).toBe(d.isolationFamilies397Sha256);
    expect(m.heldoutExecutions).toEqual({ total396Only: 1, h1On396Heldout23: 0, h1OnNewHeldout: 0 });
    expect(fs.readdirSync('tests/fixtures/budget-request-toc-row-assembly-evaluation/2024').sort()).toEqual(['evaluation-launch-manifest.json', 'evaluation-result.json', 'execution-started.json', 'heldout-parser-output.json']);
    expect(fs.readdirSync(dir).filter(f => /parser-output|heldout-output|evaluation-result|h1-output/i.test(f))).toEqual([]);
  });
});
