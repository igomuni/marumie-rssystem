import * as fs from 'fs';
import { describe, expect, it } from 'vitest';

const D = 'tests/fixtures/budget-request-p1-outlier/2024';
const read = (f: string) => JSON.parse(fs.readFileSync(`${D}/${f}`, 'utf8'));

describe('P1 outlier artifacts の integrity（frozen）', () => {
  const freeze = read('population-freeze.json');
  it('population は P1 の最頻 topBin 外のちょうど 2 row（dominant 2,530）。candidate id は一意で provenance の欠落なし', () => {
    expect(freeze.selection).toMatchObject({ p1Rows: 2532, dominantRows: 2530, outlierRows: 2 });
    const ids = freeze.outliers.map((o: { id: string }) => o.id);
    expect(new Set(ids).size).toBe(2);
    for (const o of freeze.outliers) { expect(o.localPath).toBeTruthy(); expect(o.page).toBeGreaterThan(0); expect(o.tokenIndexes.length).toBeGreaterThan(0); }
    expect(freeze.controls).toHaveLength(2);
  });
  it('packet の candidate id に重複がなく、decision は事前登録の規則どおり', () => {
    const packet = read('source-evidence-packet.json');
    const ids = packet.packets.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dec = read('final-decision.json');
    expect(dec.population).toMatchObject({ outlierRows: 2 });
    expect(dec.outcomes.every((o: { final: string }) => o.final === 'body')).toBe(true);
    expect(dec.decision).toBe('P1_OUTLIERS_BODY_TABLE_SUPPORTED');
  });
});
