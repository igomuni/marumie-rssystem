/**
 * LogicalRowResolver Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。正解文字列の全文一致ではなく、構造的不変条件を確認する。
 * 人間確認値・Golden Sampleの座標はアルゴリズムの入力に使わない。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { resolveLogicalRows, type LogicalRowResult } from './budget-request-logical-row';
import { extractPageTokens } from './budget-request-pdf-page';
import { buildTableGeometry, type TableGeometryResult } from './budget-request-table-geometry';
import type { SourceToken } from './budget-request-source-token';

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const { resolved } = resolveGoldenSamples(JSON.parse(fs.readFileSync(goldenSamplePath(2024), 'utf8')) as GoldenSampleFile, targets);
const available = resolved.length > 0 && resolved.every(r => fs.existsSync(r.target.localPath));

interface Loaded {
  tokens: SourceToken[];
  geometry: TableGeometryResult;
  logical: LogicalRowResult;
  before: string;
}
const cache = new Map<string, Loaded>();
async function load(id: string): Promise<Loaded> {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = resolved.find(x => x.sample.id === id)!;
  const e = await extractPageTokens(r.target.localPath, r.sample.pdfPage);
  const geometry = buildTableGeometry(e.tokens, e.page);
  const before = JSON.stringify([e.tokens, geometry]);
  const logical = resolveLogicalRows(e.tokens, e.page, geometry);
  const loaded = { tokens: e.tokens, geometry, logical, before };
  cache.set(id, loaded);
  return loaded;
}
const textsOf = (l: Loaded, idx: number[]) => idx.map(i => l.tokens[i].rawText);
const candidatesWith = (l: Loaded, text: string) =>
  l.logical.logicalRowCandidates.filter(c => c.rawTokenIndexes.some(i => l.tokens[i].rawText === text));

describe.skipIf(!available)('LogicalRowResolver Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（可逆・参照・非破壊・意味フィールドなし）`, async () => {
      const l = await load(sample.id);
      const cands = l.logical.logicalRowCandidates;
      expect(cands.length).toBeGreaterThan(0);
      // SourceToken / TableGeometry は非破壊
      expect(JSON.stringify([l.tokens, l.geometry])).toBe(l.before);
      // physical rowはちょうど1つのcandidateに属し、元のphysical rowへ辿れる（可逆）
      const seen = cands.flatMap(c => c.physicalRowIndexes).sort((a, b) => a - b);
      expect(seen).toEqual(l.geometry.physicalRows.map(r => r.rowIndex));
      for (const c of cands) {
        const expectedRaw = c.physicalRowIndexes.flatMap(pi => l.geometry.physicalRows[pi].rawTokenIndexes).sort((a, b) => a - b);
        expect(c.rawTokenIndexes).toEqual(expectedRaw);
        expect(c.visualTokenIndexes).toEqual(c.physicalRowIndexes.flatMap(pi => l.geometry.physicalRows[pi].visualTokenIndexes));
        for (const i of c.rawTokenIndexes) expect(l.tokens[i].index).toBe(i);
        expect(['same_physical_row', 'continuation_by_geometry', 'ambiguous']).toContain(c.resolution.kind);
        // 各segmentはphysical row内のtokenの参照で、そのrowのtokenを過不足なく分割している
        for (const pi of c.physicalRowIndexes) {
          const segs = c.segments.filter(s => s.physicalRowIndex === pi);
          expect(segs.flatMap(s => s.rawTokenIndexes).sort((a, b) => a - b)).toEqual(l.geometry.physicalRows[pi].rawTokenIndexes);
        }
        // 意味ラベルを持たない
        for (const k of ['text', 'matter', 'requestNumber', 'requestAmount', 'previousBudget', 'difference', 'regionType', 'columnName', 'relation']) {
          expect(JSON.stringify(c)).not.toContain(`"${k}"`);
        }
      }
      // chaining診断が出力される（実害の有無は報告用。ここでは値を縛らない）
      expect(l.logical.diagnostics.tableGeometryChaining.rowsExceedingTolerance).toBeInstanceOf(Array);
    }, 60_000);
  }

  it('METI p9: 01-95 を含むcandidateが存在し、raw != visual が保持され、左右を1つの文字列へ結合していない', async () => {
    const l = await load('meti-ippan-p9');
    const c = candidatesWith(l, '01-95')[0];
    expect(c).toBeDefined();
    // 金額chunk（42, / 331, / 005 が右から左のitemで並ぶ）のraw orderとvisual-x orderの違いがsegment内に残る
    const seg = c.segments.find(s => textsOf(l, s.rawTokenIndexes).includes('005'))!;
    expect(seg).toBeDefined();
    expect(seg.rawTokenIndexes).not.toEqual(seg.visualTokenIndexes);
    // 事項名側と金額側は別segment（同じbaselineでもcollapseしない）
    const matterSeg = c.segments.find(s => textsOf(l, s.rawTokenIndexes).includes('01-95'))!;
    expect(matterSeg).not.toBe(seg);
    expect(JSON.stringify(c)).not.toContain('234,599,916');
    // （要求要旨）tokenもcandidateから参照できる
    expect(textsOf(l, c.rawTokenIndexes)).toContain('（要求要旨）');
  }, 60_000);

  it('MHLW p1268: 020 を観測でき、右側の大表があっても全ページを1 logical rowへcollapseしない', async () => {
    const l = await load('mhlw-ippan-p1268');
    expect(candidatesWith(l, '020').length).toBeGreaterThan(0);
    const cands = l.logical.logicalRowCandidates;
    expect(cands.length).toBeGreaterThan(30);
    expect(Math.max(...cands.map(c => c.physicalRowIndexes.length))).toBeLessThan(5);
  }, 60_000);

  it('MHLW p1555: 上部構造と下部01-95が別candidate群として残る', async () => {
    const l = await load('mhlw-ippan-p1555');
    const lower = candidatesWith(l, '01-95');
    expect(lower.length).toBeGreaterThan(0);
    const lowerTop = Math.min(...lower.map(c => c.bbox.yMin));
    const upper = l.logical.logicalRowCandidates.filter(c => c.bbox.yMax < lowerTop - 20);
    expect(upper.length).toBeGreaterThan(10);
    for (const u of upper) for (const lc of lower) expect(u.physicalRowIndexes.some(p => lc.physicalRowIndexes.includes(p))).toBe(false);
    // 上部の行と下部の行は同じcandidateに入っていない（continuationのevidenceでも上下をまたがない）
    for (const lc of lower) expect(Math.max(...lc.physicalRowIndexes.map(p => l.geometry.physicalRows[p].bbox.yMax)) - lc.bbox.yMin).toBeLessThan(40);
  }, 60_000);

  it('MEXT p876: @ 等を含む右側の積算構造が複数segment/candidateとして残り、1つの巨大文字列へcollapseしない', async () => {
    const l = await load('mext-detail-p876');
    const calc = candidatesWith(l, '@');
    expect(calc.length).toBeGreaterThanOrEqual(5);
    for (const c of calc) {
      const segsWithAt = c.segments.filter(s => textsOf(l, s.rawTokenIndexes).includes('@'));
      expect(segsWithAt.length).toBe(1);
      expect(c.segments.length).toBeGreaterThanOrEqual(2); // 事項側 / 積算側 / 金額側が別segment
      expect(segsWithAt[0].rawTokenIndexes.length).toBeLessThan(c.rawTokenIndexes.length);
    }
    // 備考だからといって意味分類しない・ambiguousも含めて参照だけが残る
    expect(JSON.stringify(l.logical.logicalRowCandidates)).not.toContain('"remark"');
  }, 60_000);
});
