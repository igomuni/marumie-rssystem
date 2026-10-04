import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const ev = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-frozen-evaluation.json'), 'utf8')) as {
  decision: string; conditions: Record<string, boolean>; frozenInputs: { match: boolean }[]; implementation: { commit: string; parserSha256: string };
  structural: { recognizedTargetFiles: number; nonTargetFilesCorrectlyNotTarget: number; structuralFailures: number; unsupported: number };
  coverage: { expected: number; actual: number; missing: number; extra: number; duplicate: number };
  fieldExactness: Record<string, { exact: number; mismatch: number }>; mismatches: unknown[];
};

// frozen evaluation result artifact の整合性（結果の値そのものは snapshot。判定規則の適用は evaluator が行った）
describe('MOF XML item parser v0 frozen evaluation artifact', () => {
  it('decision は全 condition の真偽と整合し、frozen 入力の hash は全件一致', () => {
    expect(ev.frozenInputs.every(h => h.match)).toBe(true);
    expect(ev.decision).toBe(Object.values(ev.conditions).every(Boolean) ? 'GO' : 'STOP');
  });
  it('集計の内訳が整合し、mismatch の件数が field 別の mismatch 合計と一致する', () => {
    expect(ev.structural.recognizedTargetFiles + ev.structural.nonTargetFilesCorrectlyNotTarget + ev.structural.structuralFailures + ev.structural.unsupported).toBeLessThanOrEqual(328);
    expect(ev.coverage.expected).toBe(1256);
    expect(ev.mismatches).toHaveLength(Object.values(ev.fieldExactness).reduce((n, f) => n + f.mismatch, 0) - (ev.fieldExactness['provenance.sourceSha256']?.mismatch ?? 0));
  });
  it('評価した parser は実装 freeze の source hash と一致する', () => {
    expect(ev.implementation.commit).toMatch(/^[0-9a-f]{40}$/);
    const hash = require('crypto').createHash('sha256').update(fs.readFileSync('scripts/pipeline-v2/lib/mof-budget-xml-items.ts')).digest('hex') as string;
    expect(hash).toBe(ev.implementation.parserSha256);
  });
});
