import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const dir = path.join(__dirname, '../../../tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0');
const load = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
interface GtUnit { unitId: string; canonicalUrl: string; physicalPage: number; codeVisual: string; visualNameLines: string[]; linesWithinAnchorRow: number; visualLabel: string; reviewNote: string }

describe('incomplete-name guard visual GT（P2）', () => {
  const gt = load<{ units: GtUnit[]; humanReview: { status: string } }>('visual-gt.json');
  const wl = load<{ units: { unitId: string; canonicalUrl: string; physicalPage: number; code: string }[] }>('gt-worklist.json').units;
  it('作業リストの 43 unit と 1 対 1（unitId・URL・ページ・code が一致）', () => {
    expect(gt.units).toHaveLength(43);
    expect(gt.units.map(u => u.unitId)).toEqual(wl.map(u => u.unitId));
    gt.units.forEach((u, i) => expect([u.canonicalUrl, u.physicalPage, u.codeVisual]).toEqual([wl[i].canonicalUrl, wl[i].physicalPage, wl[i].code]));
  });
  it('ラベルは契約の enum で、名称の行数と整合する（complete ⇔ 全行が当該 row 内）', () => {
    for (const u of gt.units) {
      expect(['complete_on_current_logical_row', 'incomplete_continues_below', 'unclear']).toContain(u.visualLabel);
      expect(u.visualNameLines.length).toBeGreaterThan(0);
      expect(u.visualLabel === 'complete_on_current_logical_row').toBe(u.visualNameLines.length <= u.linesWithinAnchorRow);
    }
  });
  it('層・baseline の名称・guard の出力を含まない。人間レビューは pending', () => {
    const raw = JSON.stringify(gt.units);
    expect(raw).not.toMatch(/stratum|baselineName|selectedAs|guard-fires|known-failure/);
    for (const u of gt.units) expect(Object.keys(u).sort()).toEqual(['canonicalUrl', 'codeVisual', 'linesWithinAnchorRow', 'physicalPage', 'reviewNote', 'unitId', 'visualLabel', 'visualNameLines']);
    expect(gt.humanReview.status).toBe('pending');
  });
});
