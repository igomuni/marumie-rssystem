/**
 * SpatialRegion Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。semantic correctness（regionが何であるか）は固定せず、
 * 構造的不変条件と安全条件（誤mergeしない・collapseしない）だけを確認する。
 * Golden Sampleの座標・文字内容はdetectorの入力に使わない（対象を見つける評価のためにだけ使う）。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { resolveLogicalRows, type LogicalRowResult } from './budget-request-logical-row';
import { extractPageTokens } from './budget-request-pdf-page';
import { detectSpatialRegions, type SpatialRegionResult } from './budget-request-spatial-region';
import { buildTableGeometry, type TableGeometryResult } from './budget-request-table-geometry';
import type { PageMeta, SourceToken } from './budget-request-source-token';

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const { resolved } = resolveGoldenSamples(JSON.parse(fs.readFileSync(goldenSamplePath(2024), 'utf8')) as GoldenSampleFile, targets);
const available = resolved.length > 0 && resolved.every(r => fs.existsSync(r.target.localPath));

interface Loaded {
  tokens: SourceToken[];
  page: PageMeta;
  geometry: TableGeometryResult;
  logical: LogicalRowResult;
  spatial: SpatialRegionResult;
  before: string;
}
const cache = new Map<string, Loaded>();
async function load(id: string): Promise<Loaded> {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = resolved.find(x => x.sample.id === id)!;
  const e = await extractPageTokens(r.target.localPath, r.sample.pdfPage);
  const geometry = buildTableGeometry(e.tokens, e.page);
  const logical = resolveLogicalRows(e.tokens, e.page, geometry);
  const before = JSON.stringify([e.tokens, geometry, logical]);
  const spatial = detectSpatialRegions(e.tokens, geometry, logical);
  const loaded = { tokens: e.tokens, page: e.page, geometry, logical, spatial, before };
  cache.set(id, loaded);
  return loaded;
}
const regionOfRow = (l: Loaded, row: number) => l.spatial.regions.find(r => r.physicalRowIndexes.includes(row));
const rowOfText = (l: Loaded, text: string) => l.geometry.physicalRows.find(r => r.rawTokenIndexes.some(i => l.tokens[i].rawText === text))!;

describe.skipIf(!available)('SpatialRegion Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（非破壊・参照・bbox・disjoint・意味ラベルなし・文字内容に非依存）`, async () => {
      const l = await load(sample.id);
      const s = l.spatial;
      // 非破壊
      expect(JSON.stringify([l.tokens, l.geometry, l.logical])).toBe(l.before);
      // 完全性・disjoint: tokenはregion / unassigned / nonRow のどれか1つにだけ属する
      const all = [...s.regions.flatMap(r => r.tokenIndexes), ...s.unassignedTokenIndexes, ...s.nonRowTokenIndexes].sort((a, b) => a - b);
      expect(all).toEqual(l.tokens.map(t => t.index));
      for (const r of s.regions) {
        // token / physical row / logical row へ戻れる
        for (const i of r.tokenIndexes) expect(l.tokens[i].index).toBe(i);
        for (const p of r.physicalRowIndexes) expect(l.geometry.physicalRows[p]).toBeDefined();
        for (const li of r.logicalRowIndexes) expect(l.logical.logicalRowCandidates[li]).toBeDefined();
        // bboxは構成tokenのbboxのunion
        const boxes = r.tokenIndexes.map(i => l.tokens[i].bbox);
        expect(r.bbox.xMin).toBeCloseTo(Math.min(...boxes.map(b => b.xMin)), 3);
        expect(r.bbox.yMin).toBeCloseTo(Math.min(...boxes.map(b => b.yMin)), 3);
        expect(r.bbox.xMax).toBeCloseTo(Math.max(...boxes.map(b => b.xMax)), 3);
        expect(r.bbox.yMax).toBeCloseTo(Math.max(...boxes.map(b => b.yMax)), 3);
        expect(r.geometry.physicalRowCount).toBeGreaterThanOrEqual(s.parameters.minRows);
      }
      // 意味ラベルを持たない
      const json = JSON.stringify(s.regions);
      for (const k of ['regionType', 'remark', 'matter', 'request_summary', 'breakdown_table', 'staffing_table', 'columnName', 'text']) expect(json).not.toContain(`"${k}"`);
      // 文字内容に依存しない: 空白・罫線以外のtokenの文字列をすべて同じ文字に置換しても、region構造は同一
      const masked = l.tokens.map(t => (t.rawText.trim() === '' || /^[─-╿\s]+$/.test(t.rawText) ? t : { ...t, rawText: 'x' }));
      const g2 = buildTableGeometry(masked, l.page);
      const s2 = detectSpatialRegions(masked, g2, resolveLogicalRows(masked, l.page, g2));
      expect(JSON.stringify(s2.regions)).toBe(JSON.stringify(s.regions));
      expect(JSON.stringify(s2.unassignedTokenIndexes)).toBe(JSON.stringify(s.unassignedTokenIndexes));
    }, 60_000);
  }

  it('METI p9: 01-95 を含む構造を観測でき、左側構造と要求要旨側を無条件に巨大regionへcollapseしない', async () => {
    const l = await load('meti-ippan-p9');
    const left = regionOfRow(l, rowOfText(l, '01-95').rowIndex);
    expect(left).toBeDefined();
    const summaryIdx = l.tokens.find(t => t.rawText === '（要求要旨）')!.index;
    const holder = l.spatial.regions.find(r => r.tokenIndexes.includes(summaryIdx));
    // 要求要旨tokenはregionまたはunassignedに属し、01-95を含むregionと同一の巨大regionにはなっていない
    expect(holder === undefined || holder.regionIndex !== left!.regionIndex).toBe(true);
    // 金額tokenのraw/visual orderはSourceToken層のまま（regionはindexの集合でorderを変更しない）
    for (const r of l.spatial.regions) expect(r.tokenIndexes).toEqual([...r.tokenIndexes].sort((a, b) => a - b));
    expect(l.spatial.diagnostics.largestRegion!.tokenCount).toBeLessThan(l.spatial.diagnostics.counts.assignedTokenCount);
  }, 60_000);

  it('MHLW p1268: 020 周辺の左側構造と右側の大表がページ全体で1regionへcollapseしない', async () => {
    const l = await load('mhlw-ippan-p1268');
    const left = regionOfRow(l, rowOfText(l, '020').rowIndex);
    const big = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    expect(l.spatial.regions.length).toBeGreaterThanOrEqual(3);
    expect(big.geometry.tokenCount).toBeLessThan(0.9 * l.spatial.diagnostics.counts.assignedTokenCount);
    if (left) expect(left.regionIndex).not.toBe(big.regionIndex);
    // 右側の大表は複数physical rowにまたがる2D region候補として観測できる
    expect(big.geometry.physicalRowCount).toBeGreaterThan(10);
    // LogicalRowCandidateがambiguousだらけでもregion観測が成立している
    expect(l.logical.logicalRowCandidates.filter(c => c.resolution.kind === 'ambiguous').length).toBeGreaterThan(10);
  }, 60_000);

  it('MHLW p1555: 上部の大構造と下部 01-95 周辺が同一regionへ誤mergeされない（false positive merge: なし）', async () => {
    const l = await load('mhlw-ippan-p1555');
    const lowerRow = rowOfText(l, '01-95');
    const upperRows = l.geometry.physicalRows.filter(r => r.bbox.yMax < lowerRow.bbox.yMin - 20).map(r => r.rowIndex);
    expect(upperRows.length).toBeGreaterThan(20);
    for (const r of l.spatial.regions) {
      const hasLower = r.physicalRowIndexes.includes(lowerRow.rowIndex);
      const hasUpper = r.physicalRowIndexes.some(p => upperRows.includes(p));
      expect(hasLower && hasUpper).toBe(false);
    }
    // 大きな上部構造のregionは下部（01-95の行より下）へ伸びていない
    const upperRegion = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    expect(upperRegion.bbox.yMax).toBeLessThan(lowerRow.bbox.yMin);
  }, 60_000);

  it('MEXT p876: continuationが0件でも、右側の積算構造が複数rowにまたがる2D region候補として観測できる', async () => {
    const l = await load('mext-detail-p876');
    expect(l.logical.logicalRowCandidates.filter(c => c.resolution.kind === 'continuation_by_geometry')).toHaveLength(0); // 前段の観測（negative finding）
    const right = l.spatial.regions.filter(r => r.bbox.xMin > l.page.width / 2 - 100 && r.geometry.physicalRowCount >= 10);
    expect(right.length).toBeGreaterThan(0);
    for (const r of right) expect(r.geometry.logicalRowCount).toBeGreaterThanOrEqual(10); // 複数のlogical rowにまたがる（logical rowの境界=regionの境界ではない）
    // 備考という理由でのregion化はしていない: 意味ラベルのキーは出力に存在しない
    expect(JSON.stringify(l.spatial)).not.toContain('"remark"');
  }, 60_000);
});
