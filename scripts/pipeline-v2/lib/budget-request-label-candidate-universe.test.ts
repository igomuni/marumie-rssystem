import * as fs from 'fs';
import * as zlib from 'zlib';
import { describe, expect, it } from 'vitest';

const FILE = 'tests/fixtures/budget-request-label-candidate/2024/candidate-universe.json.gz';
describe('candidate universe artifact の integrity（frozen）', () => {
  const u = JSON.parse(zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8')) as { accounting: { evaluablePages: number; ambiguousPages: number; candidateRows: number; uniqueIds: number; byPopulation: Record<string, number> }; candidates: { id: string; frozen: { population: string }; tokenIndexes: number[]; localPath: string; page: number; logicalRowIndex: number }[] };
  it('accounting が完全（id は一意、population の合計 = 総 candidate、provenance の欠落なし）', () => {
    expect(u.accounting).toMatchObject({ evaluablePages: 9145, ambiguousPages: 1123, candidateRows: 14675, uniqueIds: 14675 });
    expect(new Set(u.candidates.map(c => c.id)).size).toBe(u.candidates.length);
    expect(Object.values(u.accounting.byPopulation).reduce((a, b) => a + b, 0)).toBe(u.candidates.length);
    expect(u.candidates.filter(c => !c.localPath || !c.page || c.tokenIndexes.length === 0).length).toBe(0);
  });
  it('既知値: P1 = 2,532（recovered）、P2 = 1,786', () => {
    expect(u.accounting.byPopulation.P1_projected_same_row).toBe(2532);
    expect(u.accounting.byPopulation.P2_ambiguity_additional_after_code).toBe(1786);
  });
});
