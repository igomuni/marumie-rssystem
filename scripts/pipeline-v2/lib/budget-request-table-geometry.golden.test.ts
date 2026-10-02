/**
 * TableGeometry Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。人間確認値・Golden Sampleの座標はアルゴリズムの入力に使わない
 * （一般ルールの妥当性確認にのみ使う）。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { extractPageTokens } from './budget-request-pdf-page';
import { buildTableGeometry, type TableGeometryResult } from './budget-request-table-geometry';
import type { PageMeta, SourceToken } from './budget-request-source-token';

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const { resolved } = resolveGoldenSamples(JSON.parse(fs.readFileSync(goldenSamplePath(2024), 'utf8')) as GoldenSampleFile, targets);
const available = resolved.length > 0 && resolved.every(r => fs.existsSync(r.target.localPath));

interface Loaded {
  tokens: SourceToken[];
  page: PageMeta;
  geometry: TableGeometryResult;
}
const cache = new Map<string, Loaded>();
async function load(id: string): Promise<Loaded> {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = resolved.find(x => x.sample.id === id)!;
  const e = await extractPageTokens(r.target.localPath, r.sample.pdfPage);
  const loaded = { tokens: e.tokens, page: e.page, geometry: buildTableGeometry(e.tokens, e.page) };
  cache.set(id, loaded);
  return loaded;
}
const rowsWithText = (l: Loaded, text: string) => l.geometry.physicalRows.filter(r => r.rawTokenIndexes.some(i => l.tokens[i].rawText === text));

describe.skipIf(!available)('TableGeometry Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（参照・bbox範囲・visual順・raw順・SourceToken非破壊）`, async () => {
      const l = await load(sample.id);
      const { physicalRows } = l.geometry;
      expect(physicalRows.length).toBeGreaterThan(0);
      const seen = new Set<number>();
      for (const r of physicalRows) {
        // SourceToken参照が壊れていない
        for (const i of [...r.rawTokenIndexes, ...r.whitespaceTokenIndexes]) {
          expect(l.tokens[i]).toBeDefined();
          expect(l.tokens[i].index).toBe(i);
        }
        for (const i of r.rawTokenIndexes) {
          expect(seen.has(i)).toBe(false); // 1 tokenは1 rowだけ
          seen.add(i);
        }
        // raw orderはindex昇順で保存され、visual順は同じ集合のx方向に単調な並び
        expect(r.rawTokenIndexes).toEqual([...r.rawTokenIndexes].sort((a, b) => a - b));
        expect([...r.visualTokenIndexes].sort((a, b) => a - b)).toEqual(r.rawTokenIndexes);
        const xs = r.visualTokenIndexes.map(i => l.tokens[i].bbox.xMin);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        // row bboxはページ範囲内（フォントmetrics由来の近似なので縦は1pt程度の余裕）
        expect(r.bbox.xMin).toBeGreaterThanOrEqual(0);
        expect(r.bbox.xMax).toBeLessThanOrEqual(l.page.width + 1);
        expect(r.bbox.yMin).toBeGreaterThanOrEqual(-1);
        expect(r.bbox.yMax).toBeLessThanOrEqual(l.page.height + 1);
        // 意味ラベル・関連付けのフィールドを持たない
        for (const k of ['text', 'parent', 'recordId', 'regionType', 'columnName', 'relation']) expect(Object.keys(r)).not.toContain(k);
      }
      // クラスタリング対象はすべて非空白token（空白tokenはSourceTokenに残る）
      expect(seen.size + l.geometry.excludedTokenIndexes.length).toBe(l.tokens.length);
      for (const b of l.geometry.columnBands) expect(Object.keys(b)).not.toContain('columnName');
    }, 60_000);
  }

  it('METI p9: 01-95 を含むphysical row候補が取得できる', async () => {
    const l = await load('meti-ippan-p9');
    const rows = rowsWithText(l, '01-95');
    expect(rows.length).toBeGreaterThan(0);
    // 同じphysical rowに事項名側と右側（要求要旨）のtokenが物理的にあるだけで、意味分割も結合もしない
    expect(rows[0].rawTokenIndexes.map(i => l.tokens[i].rawText)).toContain('（要求要旨）');
  }, 60_000);

  it('MHLW p1268: 020 を含むphysical row候補が取得できる（右側の大表を関連付けない）', async () => {
    const l = await load('mhlw-ippan-p1268');
    expect(rowsWithText(l, '020').length).toBeGreaterThan(0);
    expect(l.geometry.physicalRows.length).toBeGreaterThan(40);
  }, 60_000);

  it('MHLW p1555: 上部と下部に十分離れたphysical row群があり、logical associationを持たない', async () => {
    const l = await load('mhlw-ippan-p1555');
    const rows = l.geometry.physicalRows;
    const lower = rowsWithText(l, '01-95');
    expect(lower.length).toBeGreaterThan(0);
    const lowerTop = Math.min(...lower.map(r => r.bbox.yMin));
    const upper = rows.filter(r => r.bbox.yMax < lowerTop - 20);
    expect(upper.length).toBeGreaterThan(20);
    expect(Math.max(...upper.map(r => r.bbox.yMax))).toBeLessThan(lowerTop - 20);
    // 上部の行と下部01-95の行を結合・関連付けしていない
    expect(upper.every(r => !r.rawTokenIndexes.some(i => l.tokens[i].rawText === '01-95'))).toBe(true);
    expect(Object.keys(l.geometry)).not.toContain('logicalRecords');
  }, 60_000);

  it('MEXT p876: 積算内訳のtoken群が複数physical rowとして観測できる（備考列を意味分類しない）', async () => {
    const l = await load('mext-detail-p876');
    const calcRows = l.geometry.physicalRows.filter(r => r.rawTokenIndexes.some(i => l.tokens[i].rawText === '@'));
    expect(calcRows.length).toBeGreaterThanOrEqual(5);
    for (const r of calcRows) expect(r.rawTokenIndexes.length).toBeGreaterThan(3); // 1 tokenに潰れていない
    expect(l.geometry.columnBands.some(b => b.xMin >= 460)).toBe(true); // 右側領域が物理的な帯として観測できる（意味は付けない）
  }, 60_000);

  it('金額chunk: rawTokenIndexes != visualTokenIndexes のphysical rowを実PDFで確認できる（METI p9）', async () => {
    const l = await load('meti-ippan-p9');
    const row = l.geometry.physicalRows.find(r => {
      const texts = r.rawTokenIndexes.map(i => l.tokens[i].rawText);
      return texts.includes('916') && texts.includes('599,') && texts.includes('234,');
    })!;
    expect(row).toBeDefined();
    expect(row.rawTokenIndexes).not.toEqual(row.visualTokenIndexes);
    expect(row.rawOrderMatchesVisualOrder).toBe(false);
    const raw = (t: string) => row.rawTokenIndexes.find(i => l.tokens[i].rawText === t)!;
    expect(raw('916')).toBeLessThan(raw('599,')); // raw order: 916 → 599, → 234,
    expect(raw('599,')).toBeLessThan(raw('234,'));
    expect(row.visualTokenIndexes.indexOf(raw('234,'))).toBeLessThan(row.visualTokenIndexes.indexOf(raw('599,'))); // visual-x: 234, → 599, → 916
    expect(row.visualTokenIndexes.indexOf(raw('599,'))).toBeLessThan(row.visualTokenIndexes.indexOf(raw('916')));
  }, 60_000);
});
