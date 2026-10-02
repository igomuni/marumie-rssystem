import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { HeldoutManifest } from './budget-request-field-resolver-heldout-manifest';
import { summarizeHeldoutGt, validateHeldoutGolden, type HeldoutGolden } from './budget-request-field-resolver-heldout-gt';

const dir = path.join(__dirname, '../../../tests/fixtures/budget-request-field-resolver/heldout-v0');
const load = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;

describe('held-out GT', () => {
  const m = load<HeldoutManifest>('manifest.json');
  it('manifest と整合し、値・blank・zero・sign が内部矛盾しない', () => {
    expect(validateHeldoutGolden(load<HeldoutGolden>('golden.json'), m)).toEqual([]);
  });
  it('事前登録した quota と informative 要件（最低3種類）', () => {
    const s = summarizeHeldoutGt(load<HeldoutGolden>('golden.json'));
    expect(s.pages).toBe(16);
    expect(s.informative).toBe(true);
    expect(s.informativeKinds.length).toBeGreaterThanOrEqual(3);
    expect(s.quota.blankObserved).toBeGreaterThanOrEqual(0); // quota 未達でもページは変えない。未達は結果に記録する
  });
  it('矛盾する GT を検出する（blank に値・0 に符号・normalized 不整合・manifest 外ページ）', () => {
    const mut = (f: (g: HeldoutGolden) => void) => { const g = load<HeldoutGolden>('golden.json'); f(g); return validateHeldoutGolden(g, m); };
    expect(mut(g => { const t = g.samples[0].targets[0]; t.rowLocal.previousBudget.cellState = 'visual blank'; }).length).toBeGreaterThan(0);
    expect(mut(g => { const t = g.samples[1].targets[1]; t.rowLocal.previousBudget.sign = { status: 'resolved', raw: '△' }; t.rowLocal.previousBudget.magnitudeRaw = '0'; t.rowLocal.previousBudget.magnitudeNumeric = 0; t.rowLocal.previousBudget.explicitZero = true; t.rowLocal.previousBudget.cellState = 'explicit zero'; }).some(e => e.includes('0 に符号'))).toBe(true);
    expect(mut(g => { g.samples[0].targets[0].rowLocal.name.normalized = 'x'; }).some(e => e.includes('normalized'))).toBe(true);
    expect(mut(g => { g.samples[0].sourcePage = 9999; }).some(e => e.includes('manifest'))).toBe(true);
  });
});
