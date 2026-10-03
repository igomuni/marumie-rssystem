import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { projectHumanGt, validateRaw, type RawResponse } from '../build-budget-request-h1-human-validation-gt';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as T;
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex');
const raw = read<RawResponse>('h1-human-validation-reviewer-response-H01.json');
const gt = read<{ units: { unitId: string; label: string; reviewerType: string }[] }>('h1-human-validation-visual-gt.json');
const meta = read<{ rawResponseSha256: string; blindnessEvidenceStatus: string; reviewerAuthoredDeclaration: boolean; protocolDeviation: boolean }>('h1-human-validation-reviewer-metadata.json');
const wl = read<{ units: { unitId: string }[] }>('h1-human-validation-worklist.json').units.map(u => u.unitId);

// structural integrity のみ。ラベル件数の集計・AI GT との比較はここでも行わない
describe('H1 human GT integrity', () => {
  it('raw response は保全された hash のまま、構造検証を満たす（65 unit・集合一致・許可ラベル・human）', () => {
    expect(sha('h1-human-validation-reviewer-response-H01.json')).toBe(meta.rawResponseSha256);
    expect(validateRaw(raw, wl)).toEqual([]);
  });
  it('human GT は raw response の deterministic projection（順序・値とも不変）', () => {
    expect(gt.units).toEqual(projectHumanGt(raw));
    expect(gt.units.map(u => u.unitId).sort()).toEqual([...wl].sort());
  });
  it('構造検証は欠落・余剰・未知ラベル・reviewerType 違いを検出する', () => {
    const u = raw.units[0];
    expect(validateRaw({ ...raw, units: raw.units.slice(1) }, wl)).toContain('units != 65');
    expect(validateRaw({ ...raw, units: [{ ...u, label: 'x' }, ...raw.units.slice(1)] }, wl)).toContain(`unknown label: ${u.unitId}`);
    expect(validateRaw({ ...raw, units: [{ ...u, reviewerType: 'ai' }, ...raw.units.slice(1)] }, wl)).toContain(`reviewerType != human: ${u.unitId}`);
    expect(validateRaw({ ...raw, units: [{ ...u, unitId: 'zzz' }, ...raw.units.slice(1)] }, wl)).toContain('extra unitId');
  });
  it('blindness evidence は実際の状態（reviewer 本人の pre-review declaration なし・protocol deviation）を記録している', () => {
    expect(meta.blindnessEvidenceStatus).toBe('user_attested_independent_reviewer');
    expect(meta.reviewerAuthoredDeclaration).toBe(false);
    expect(meta.protocolDeviation).toBe(true);
  });
});
