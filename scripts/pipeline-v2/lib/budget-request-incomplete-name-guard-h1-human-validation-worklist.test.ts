import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as T;
interface Unit { unitId: string; documentKey: string; canonicalUrl: string; physicalPage: number; code: string; anchorYPt: [number, number] }
const wl = read<{ sources: { canonicalUrl: string; unitCount: number }[]; units: Unit[] }>('h1-human-validation-worklist.json');
const prov = read<{ humanFacingWorklist: { sha256: string }; sourceArtifacts: Record<string, { path: string; sha256: string }> }>('h1-human-validation-provenance.json');
const firedL27 = read<{ units: { unitId: string; guardFired: boolean }[] }>('p3-evaluation.json').units.filter(u => u.guardFired).map(u => u.unitId);
const u38 = read<{ units: { unitId: string }[] }>('h1-scope-completion-worklist.json').units.map(u => u.unitId);

describe('H1 human-validation worklist（凍結成果物の静的検証）', () => {
  it('65 unit = L27 ∪ U38（27 + 38、交差なし、重複なし）で辞書順', () => {
    const ids = wl.units.map(u => u.unitId);
    expect(ids).toHaveLength(65);
    expect(new Set(ids).size).toBe(65);
    expect(firedL27).toHaveLength(27);
    expect(u38).toHaveLength(38);
    expect(firedL27.filter(i => u38.includes(i))).toEqual([]);
    expect([...ids].sort()).toEqual([...firedL27, ...u38].sort());
    expect(ids).toEqual([...ids].sort());
  });
  it('locator のみを持ち、label・baseline・guard 等の anchoring 項目を含まない', () => {
    for (const u of wl.units) expect(Object.keys(u).sort()).toEqual(['anchorYPt', 'canonicalUrl', 'code', 'documentKey', 'physicalPage', 'unitId']);
    expect(Object.keys(wl).sort()).toEqual(['canonicalOrdering', 'populationSize', 'purpose', 'schema', 'sources', 'units']);
    expect(JSON.stringify([wl.units, wl.sources])).not.toMatch(/label|baseline|guard|reasonCode|stratum|predicate|knownFailure|agreement/i);
  });
  it('source inventory が 65 unit を覆い、hash が provenance と一致', () => {
    expect(wl.sources.reduce((s, x) => s + x.unitCount, 0)).toBe(65);
    for (const s of wl.sources) expect(wl.units.filter(u => u.canonicalUrl === s.canonicalUrl)).toHaveLength(s.unitCount);
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, 'h1-human-validation-worklist.json'))).digest('hex');
    expect(h).toBe(prov.humanFacingWorklist.sha256);
    for (const a of Object.values(prov.sourceArtifacts)) expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  });
});
