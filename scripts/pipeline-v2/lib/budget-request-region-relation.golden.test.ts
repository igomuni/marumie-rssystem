/**
 * RegionRelation Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。relationが何を意味するかは固定せず、構造的不変条件と安全条件
 * （誤関連付けしない・意味ラベルを持たない・rawTextに依存しない）だけを確認する。
 * Golden Sampleの座標・文字内容はresolverの入力に使わない（対象を見つける評価のためにだけ使う）。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { resolveLogicalRows, type LogicalRowResult } from './budget-request-logical-row';
import { extractPageTokens } from './budget-request-pdf-page';
import { resolveRegionRelations, type RegionRelationResult } from './budget-request-region-relation';
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
  rel: RegionRelationResult;
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
  const spatial = detectSpatialRegions(e.tokens, geometry, logical);
  const before = JSON.stringify([e.tokens, geometry, logical, spatial]);
  const rel = resolveRegionRelations(e.page, logical, spatial);
  const loaded = { tokens: e.tokens, page: e.page, geometry, logical, spatial, rel, before };
  cache.set(id, loaded);
  return loaded;
}
const rowOf = (l: Loaded, text: string) => l.logical.logicalRowCandidates.find(c => c.rawTokenIndexes.some(i => l.tokens[i].rawText === text))!;
const regionOfToken = (l: Loaded, idx: number) => l.spatial.regions.find(r => r.tokenIndexes.includes(idx));

describe.skipIf(!available)('RegionRelation Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（非破壊・参照・semantic labelなし・rawTextに非依存・決定性）`, async () => {
      const l = await load(sample.id);
      // 前段の結果は非破壊（resolverは参照するだけ）
      expect(JSON.stringify([l.tokens, l.geometry, l.logical, l.spatial])).toBe(l.before);
      expect(l.rel.relations.length).toBeGreaterThan(0);
      // 既存indexへ戻れる
      for (const r of l.rel.relations) {
        for (const n of [r.source, r.target]) {
          if (n.kind === 'spatial_region') expect(l.spatial.regions[n.regionIndex]).toBeDefined();
          else expect(l.logical.logicalRowCandidates[n.logicalRowIndex]).toBeDefined();
        }
        expect(r.evidence.length).toBeGreaterThan(0);
        expect(r.stability.stable).toBe(r.stability.reasons.length === 0);
      }
      // relationIndexは連番、competingは実在するrelationを指し、自分自身を含まない
      l.rel.relations.forEach((r, i) => {
        expect(r.relationIndex).toBe(i);
        for (const c of r.ambiguity?.competingRelationIndexes ?? []) {
          expect(l.rel.relations[c]).toBeDefined();
          expect(c).not.toBe(i);
        }
      });
      // 意味ラベルを持たない
      const json = JSON.stringify(l.rel.relations);
      for (const k of ['regionType', 'core', 'auxiliary', 'remark', 'request_summary', 'breakdown_table', 'staffing_table', 'matter', 'amount', 'rawText']) expect(json).not.toContain(`"${k}"`);
      // 診断の整合
      const d = l.rel.diagnostics;
      expect(d.counts.candidateRelations).toBe(l.rel.relations.length);
      expect(d.counts.stableRelations + d.counts.unstableRelations).toBe(l.rel.relations.length);
      // 決定的
      expect(JSON.stringify(resolveRegionRelations(l.page, l.logical, l.spatial))).toBe(JSON.stringify(l.rel));
      // rawText mask: 非空白・非罫線tokenの文字列を同一文字に置換してもrelation構造は同一
      const masked = l.tokens.map(t => (t.rawText.trim() === '' || /^[─-╿\s]+$/.test(t.rawText) ? t : { ...t, rawText: 'x' }));
      const g2 = buildTableGeometry(masked, l.page);
      const l2 = resolveLogicalRows(masked, l.page, g2);
      const r2 = resolveRegionRelations(l.page, l2, detectSpatialRegions(masked, g2, l2));
      expect(JSON.stringify(r2)).toBe(JSON.stringify(l.rel));
    }, 60_000);
  }

  it('METI p9: 01-95 を含む行から複数regionへのrelationを観測できるが、semantic interpretationしない', async () => {
    const l = await load('meti-ippan-p9');
    const row = rowOf(l, '01-95');
    const mine = l.rel.relations.filter(r => r.source.kind === 'logical_row' && r.source.logicalRowIndex === row.logicalRowIndex);
    expect(mine.length).toBeGreaterThanOrEqual(2); // 1つのlogical rowが複数regionにtokenを持つ（無理に1つへ決めない）
    expect(new Set(mine.map(r => (r.target as { regionIndex: number }).regionIndex)).size).toBe(mine.length);
    expect(l.rel.diagnostics.logicalRowsSpanningMultipleRegions).toBeGreaterThan(0);
    expect(JSON.stringify(l.rel)).not.toContain('request_summary');
  }, 60_000);

  it('MHLW p1268: 020 周辺の左側構造と右側の大表のrelation候補を観測でき、ambiguousなLogicalRowが多くても破綻しない', async () => {
    const l = await load('mhlw-ippan-p1268');
    expect(l.logical.logicalRowCandidates.filter(c => c.resolution.kind === 'ambiguous').length).toBeGreaterThan(10);
    const row = rowOf(l, '020');
    const big = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    // 右側の大表regionは複数のlogical rowにまたがり、020の行から（所属または近接として）観測できる位置関係にある
    expect(big.geometry.logicalRowCount).toBeGreaterThan(10);
    const toBig = l.rel.relations.filter(r => r.source.kind === 'logical_row' && r.target.kind === 'spatial_region' && r.target.regionIndex === big.regionIndex);
    expect(toBig.length).toBeGreaterThan(10); // 右側の大表は複数のlogical rowからの関係として保持される（auxiliaryと決めつけない）
    expect(l.rel.relations.some(r => r.source.kind === 'logical_row' && r.source.logicalRowIndex === row.logicalRowIndex)).toBe(true);
  }, 60_000);

  it('MHLW p1555: 上部の大構造と下部 01-95 の直接relation候補は生成されない（誤関連付けなし）', async () => {
    const l = await load('mhlw-ippan-p1555');
    const lowerRow = rowOf(l, '01-95');
    const upperBig = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    expect(upperBig.bbox.yMax).toBeLessThan(lowerRow.bbox.yMin); // 上部の大構造は下部01-95の行より上
    // 下部01-95の行 ↔ 上部の大構造region の relation は無い
    expect(l.rel.relations.some(r => r.source.kind === 'logical_row' && r.source.logicalRowIndex === lowerRow.logicalRowIndex && r.target.kind === 'spatial_region' && r.target.regionIndex === upperBig.regionIndex)).toBe(false);
    // 下部01-95のtokenを含むregionと上部の大構造regionの region↔region relation も無い
    const lowerRegion = regionOfToken(l, l.tokens.find(t => t.rawText === '01-95')!.index);
    if (lowerRegion) {
      const [a, b] = [lowerRegion.regionIndex, upperBig.regionIndex].sort((x, y) => x - y);
      expect(l.rel.relations.some(r => r.source.kind === 'spatial_region' && r.source.regionIndex === a && r.target.kind === 'spatial_region' && r.target.regionIndex === b)).toBe(false);
    }
    // 下部01-95の行のrelationはどれも、そのrowのtoken所属または近接（cutoff内）でありdistanceのevidenceを持つ
    for (const r of l.rel.relations.filter(x => x.source.kind === 'logical_row' && x.source.logicalRowIndex === lowerRow.logicalRowIndex)) {
      expect(r.evidence.some(e => e.kind === 'within_vertical_cutoff')).toBe(true);
    }
  }, 60_000);

  it('MEXT p876: continuationが0件でも、右側の積算構造のregionへのrelation候補を観測できる（rawText非依存）', async () => {
    const l = await load('mext-detail-p876');
    expect(l.logical.logicalRowCandidates.filter(c => c.resolution.kind === 'continuation_by_geometry')).toHaveLength(0);
    const right = l.spatial.regions.filter(r => r.bbox.xMin > l.page.width / 2 - 100 && r.geometry.physicalRowCount >= 10);
    expect(right.length).toBeGreaterThan(0);
    for (const reg of right) {
      const rows = new Set(l.rel.relations.filter(r => r.source.kind === 'logical_row' && r.target.kind === 'spatial_region' && r.target.regionIndex === reg.regionIndex).map(r => (r.source as { logicalRowIndex: number }).logicalRowIndex));
      expect(rows.size).toBeGreaterThanOrEqual(10); // 右側region内部が複数に分かれていても、複数のlogical rowからの候補として保持される
    }
    expect(l.rel.diagnostics.logicalRowsSpanningMultipleRegions).toBeGreaterThan(0);
  }, 60_000);
});
