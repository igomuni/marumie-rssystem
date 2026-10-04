import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const ev = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json'), 'utf8')) as {
  decision: string; conditions: Record<string, boolean>;
  population: { records: number; uniqueRecordIds: number; missing: string[]; extra: string[]; parentResolution: Record<string, number> };
  frozenReference: { fieldExact: Record<string, number>; mismatches: unknown[] };
  existingOutputs: { unchanged: boolean }[];
};

// production generation 評価 artifact の整合性（snapshot。生成物そのものは data/ にあり git 管理外）
describe('MOF jikou normalized integration evaluation artifact', () => {
  it('decision は全 condition と整合し、1,256 件・重複なし・親は全件解決（orphan・ambiguous 0）', () => {
    expect(ev.decision).toBe(Object.values(ev.conditions).every(Boolean) ? 'GO' : 'STOP');
    expect(ev.population).toMatchObject({ records: 1256, uniqueRecordIds: 1256, missing: [], extra: [], parentResolution: { both: 1256, orphan: 0, ambiguous: 0 } });
  });
  it('frozen reference との field 一致が全 field・全件で、mismatch 0。既存 output は不変', () => {
    for (const n of Object.values(ev.frozenReference.fieldExact)) expect(n).toBe(1256);
    expect(ev.frozenReference.mismatches).toEqual([]);
    expect(ev.existingOutputs.every(e => e.unchanged)).toBe(true);
  });
});
