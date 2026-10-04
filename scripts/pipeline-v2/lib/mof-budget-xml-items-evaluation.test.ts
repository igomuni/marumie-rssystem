import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const load = (f: string) => JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', f), 'utf8')) as Ev;
interface Ev {
  decision: string; conditions: Record<string, boolean>; frozenInputs: { match: boolean }[]; implementation: { commit: string; parserSha256: string };
  structural: { recognizedTargetFiles: number; nonTargetFilesCorrectlyNotTarget: number; structuralFailures: number; unsupported: number };
  coverage: { expected: number; actual: number; missing: number; extra: number; duplicate: number };
  fieldExactness: Record<string, { exact: number; mismatch: number }>; mismatches: unknown[];
  sourceSetCompleteness?: { complete: boolean; localCount: number }; failClosedTests?: { numFailedTests: number; numTotalTests: number };
}

// frozen evaluation result artifact の整合性（結果の値そのものは snapshot。判定規則の適用は evaluator が行った）
describe.each([['初回評価', '202411001-frozen-evaluation.json'], ['厳密化した再実行', '202411001-frozen-evaluation-hardened.json']] as const)('MOF XML item parser v0 frozen evaluation artifact（%s）', (_n, file) => {
  const ev = load(file);
  it('decision は全 condition の真偽と整合し、frozen 入力の hash は全件一致', () => {
    expect(ev.frozenInputs.every(h => h.match)).toBe(true);
    expect(ev.decision).toBe(Object.values(ev.conditions).every(Boolean) ? 'GO' : 'STOP');
  });
  it('328 ファイルが過不足なく target 94 + not_target 234 に分類され、mismatch 件数が field 別合計と一致する', () => {
    expect(ev.structural.recognizedTargetFiles + ev.structural.nonTargetFilesCorrectlyNotTarget + ev.structural.structuralFailures + ev.structural.unsupported).toBe(328);
    expect(ev.structural.recognizedTargetFiles).toBe(94);
    expect(ev.structural.nonTargetFilesCorrectlyNotTarget).toBe(234);
    expect(ev.coverage.expected).toBe(1256);
    expect(ev.mismatches).toHaveLength(Object.values(ev.fieldExactness).reduce((n, f) => n + f.mismatch, 0) - (ev.fieldExactness['provenance.sourceSha256']?.mismatch ?? 0));
  });
  it('評価した parser は実装 freeze の source hash と一致する', () => {
    expect(ev.implementation.commit).toMatch(/^[0-9a-f]{40}$/);
    const hash = require('crypto').createHash('sha256').update(fs.readFileSync('scripts/pipeline-v2/lib/mof-budget-xml-items.ts')).digest('hex') as string;
    expect(hash).toBe(ev.implementation.parserSha256);
  });
});

describe('厳密化した再実行 artifact の追加条件', () => {
  const ev = load('202411001-frozen-evaluation-hardened.json');
  it('source set の完全性・non-target 234/234・fail-closed test 通過が GO 条件に含まれ、満たされている', () => {
    expect(Object.keys(ev.conditions)).toEqual(expect.arrayContaining(['sourceSetComplete328', 'nonTarget234of234', 'failClosedTestsPass']));
    expect(ev.sourceSetCompleteness).toMatchObject({ complete: true, localCount: 328 });
    expect(ev.failClosedTests?.numFailedTests).toBe(0);
    expect(ev.failClosedTests?.numTotalTests).toBeGreaterThanOrEqual(44);
  });
});
