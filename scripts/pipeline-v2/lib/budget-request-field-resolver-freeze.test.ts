import { describe, expect, it } from 'vitest';
import { INFERENCE_FREEZE_FILES, verifyFreeze, type GitRunner } from './budget-request-field-resolver-freeze';

const git = (current: Record<string, string>, atFreeze: Record<string, string>): GitRunner => args => {
  if (args[0] === 'rev-parse') {
    const p = args[1].split(':')[1];
    if (!(p in atFreeze)) throw new Error('missing');
    return atFreeze[p];
  }
  const p = args[1];
  if (!(p in current)) throw new Error('missing');
  return current[p];
};

describe('freeze verification', () => {
  const files = ['a.ts', 'b.ts'];
  it('全て一致なら allMatch', () => {
    const r = verifyFreeze('abc', files, git({ 'a.ts': '1', 'b.ts': '2' }, { 'a.ts': '1', 'b.ts': '2' }));
    expect(r.allMatch).toBe(true);
    expect(r.entries.every(e => e.match)).toBe(true);
  });
  it('1ファイルでも blob が違う／欠けていれば不一致', () => {
    expect(verifyFreeze('abc', files, git({ 'a.ts': '1', 'b.ts': 'X' }, { 'a.ts': '1', 'b.ts': '2' })).allMatch).toBe(false);
    expect(verifyFreeze('abc', files, git({ 'a.ts': '1' }, { 'a.ts': '1', 'b.ts': '2' })).allMatch).toBe(false);
  });
  it('freeze 対象に推論側の主要ファイルと Golden / Contract を含む', () => {
    for (const f of ['budget-request-field-resolver.ts', 'budget-request-field-resolver-evaluator.ts', 'extract-budget-request-field-resolver.ts', 'golden.json', 'Contract.md']) {
      expect(INFERENCE_FREEZE_FILES.some(x => x.endsWith(f))).toBe(true);
    }
  });
});
