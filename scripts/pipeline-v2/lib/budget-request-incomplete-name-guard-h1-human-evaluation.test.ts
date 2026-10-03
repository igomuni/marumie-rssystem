import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const ev = JSON.parse(fs.readFileSync(path.join(DIR, 'h1-human-validation-evaluation.json'), 'utf8')) as {
  frozenInputs: Record<string, { path: string; sha256: string }>; humanCounts: Record<string, number>; agreement: { total: number; exactAgreementCount: number; disagreementCount: number; disagreementUnitIds: string[] }; aiPopulation: { size: number }; blindness: { protocolDeviation: boolean };
};

// artifact の整合性（入力 hash・件数の合計・protocolDeviation の保存）のみ。判定規則そのものの test は evaluator.test.ts
describe('H1 human-validation evaluation artifact', () => {
  it('凍結入力の hash が現在の artifact と一致する', () => {
    for (const a of Object.values(ev.frozenInputs)) expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  });
  it('件数の合計が 65、agreement の内訳が整合する', () => {
    expect(ev.humanCounts.H_complete + ev.humanCounts.H_incomplete + ev.humanCounts.H_unclear).toBe(65);
    expect(ev.aiPopulation.size).toBe(65);
    expect(ev.agreement.total).toBe(65);
    expect(ev.agreement.exactAgreementCount + ev.agreement.disagreementCount).toBe(65);
    expect(ev.agreement.disagreementUnitIds).toHaveLength(ev.agreement.disagreementCount);
  });
  it('Case B の protocolDeviation が評価 artifact に保存されている', () => {
    expect(ev.blindness.protocolDeviation).toBe(true);
  });
});
