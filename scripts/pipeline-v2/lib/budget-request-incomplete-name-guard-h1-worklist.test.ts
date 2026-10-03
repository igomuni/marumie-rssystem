import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as T;

interface Unit { unitId: string; canonicalUrl: string; physicalPage: number; code: string; anchorYPt: [number, number] }
const wl = read<{ schema: string; provenance: Record<string, unknown>; units: Unit[] }>('h1-scope-completion-worklist.json');
const labeled = new Set(read<{ units: { unitId: string }[] }>('visual-gt.json').units.map(u => u.unitId));

describe('H1 scope-completion worklist（凍結成果物の静的検証）', () => {
  it('38 unit・重複なし・辞書順', () => {
    const ids = wl.units.map(u => u.unitId);
    expect(ids).toHaveLength(38);
    expect(new Set(ids).size).toBe(38);
    expect(ids).toEqual([...ids].sort());
  });
  it('P3 時点の Visual GT 43 unit と重ならない', () => {
    expect(wl.units.filter(u => labeled.has(u.unitId))).toEqual([]);
  });
  it('既存 gt-worklist と互換な locator のみを持ち、GT anchoring になる項目を含まない', () => {
    for (const u of wl.units) expect(Object.keys(u).sort()).toEqual(['anchorYPt', 'canonicalUrl', 'code', 'physicalPage', 'unitId']);
    expect(JSON.stringify(wl.units)).not.toMatch(/baselineName|reasonCode|stratum|visualLabel|predicate[ABCD]/);
  });
  it('provenance の入力 hash が現在の凍結成果物と一致し、件数が 65 / 27 / 38', () => {
    const p = wl.provenance as { guardFireCount: number; previouslyLabeledCount: number; auditUnitCount: number; inputArtifacts: Record<string, { path: string; sha256: string }> };
    expect([p.guardFireCount, p.previouslyLabeledCount, p.auditUnitCount]).toEqual([65, 27, 38]);
    for (const a of Object.values(p.inputArtifacts)) expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  });
});
