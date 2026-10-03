import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as T;
const wl = read<{ units: { unitId: string }[] }>('h1-scope-completion-worklist.json');
const gt = read<{ units: { unitId: string; label: string }[] }>('h1-scope-completion-visual-gt.json');
const LABELS = ['complete_on_current_logical_row', 'incomplete_continues_below', 'unclear'];

// artifact integrity のみ。ラベル件数による H1 判定は P4 で行う（ここでは集計しない）
describe('H1 Visual GT artifact integrity', () => {
  it('worklist の 38 unit と unitId 集合が一致（重複・欠落・余剰なし）', () => {
    const ids = gt.units.map(u => u.unitId);
    expect(ids).toHaveLength(38);
    expect(new Set(ids).size).toBe(38);
    expect([...ids].sort()).toEqual(wl.units.map(u => u.unitId).sort());
  });
  it('各 unit が 3 ラベルのうち 1 つだけを持つ', () => {
    for (const u of gt.units) {
      expect(Object.keys(u).sort()).toEqual(['label', 'unitId']);
      expect(LABELS).toContain(u.label);
    }
  });
});
