/**
 * SemanticRecordCandidate Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。正解の最終文字列（事項名・金額）はhard-codeせず、token参照・位置・観測結果の
 * 構造的不変条件と安全条件だけを確認する。人間確認値・Golden Sampleの座標はdetectorの入力に使わない。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { resolveLogicalRows, type LogicalRowResult } from './budget-request-logical-row';
import { extractPageTokens } from './budget-request-pdf-page';
import { resolveRegionRelations, type RegionRelationResult } from './budget-request-region-relation';
import { detectSemanticRecords, SIGN_TOKENS, type SemanticRecordCandidate, type SemanticRecordResult } from './budget-request-semantic-record';
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
  sem: SemanticRecordResult;
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
  const rel = resolveRegionRelations(e.page, logical, spatial);
  const before = JSON.stringify([e.tokens, geometry, logical, spatial, rel]);
  const sem = detectSemanticRecords(e.tokens, geometry, logical, spatial, rel);
  const loaded = { tokens: e.tokens, page: e.page, geometry, logical, spatial, rel, sem, before };
  cache.set(id, loaded);
  return loaded;
}
const byCode = (l: Loaded, code: string): SemanticRecordCandidate | undefined => l.sem.semanticRecordCandidates.find(c => c.observations.code.rawTexts[0] === code);

describe.skipIf(!available)('SemanticRecordCandidate Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（前段非破壊・provenance・値を作らない・符号推測なし・決定性）`, async () => {
      const l = await load(sample.id);
      // 前段（geometry / observation層）は非破壊
      expect(JSON.stringify([l.tokens, l.geometry, l.logical, l.spatial, l.rel])).toBe(l.before);
      expect(l.sem.semanticRecordCandidates.length).toBeGreaterThan(0);
      for (const c of l.sem.semanticRecordCandidates) {
        // provenance: candidate → observation → tokenIndexes → SourceToken.rawText / bbox
        const obs = [c.observations.code, c.observations.matter, ...c.amountGroups];
        for (const o of obs) {
          expect(o.rawTexts).toEqual(o.tokenIndexes.map(i => l.tokens[i].rawText));
          expect(o.bbox.xMin).toBeCloseTo(Math.min(...o.tokenIndexes.map(i => l.tokens[i].bbox.xMin)), 3);
          expect(o.bbox.xMax).toBeCloseTo(Math.max(...o.tokenIndexes.map(i => l.tokens[i].bbox.xMax)), 3);
          expect([...o.visualTokenIndexes].sort((a, b) => a - b)).toEqual(o.tokenIndexes);
        }
        // 符号は実在するsign tokenだけ。推測した符号・数値・差額を持たない
        for (const g of c.amountGroups) {
          if (g.signObservation) {
            expect(SIGN_TOKENS).toContain(g.signObservation.rawText);
            expect(l.tokens[g.signObservation.tokenIndex].rawText).toBe(g.signObservation.rawText);
          }
          expect(Object.keys(g)).not.toContain('value');
        }
        // 金額groupが3つでないとき、列順の候補（previous/request/difference）を作らない（空欄を0にしない）
        if (c.amountGroups.length !== 3) {
          expect(c.observations.previousBudget ?? c.observations.requestBudget ?? c.observations.difference).toBeUndefined();
          expect(c.status).toBe('ambiguous');
        }
        // 関連構造からregion / relationへ戻れる。stable/unstableを別に保持。semantic typeなし
        for (const r of c.relatedStructures) {
          expect(l.spatial.regions[r.regionIndex]).toBeDefined();
          for (const i of r.relationIndexes) expect(l.rel.relations[i]).toBeDefined();
          expect([...r.stableRelationIndexes, ...r.unstableRelationIndexes].sort((a, b) => a - b)).toEqual([...r.relationIndexes].sort((a, b) => a - b));
        }
        for (const k of ['request_summary', 'historical_table', 'breakdown_table', 'staffing_table', 'regionType']) expect(JSON.stringify(c)).not.toContain(k);
      }
      // 決定的
      expect(JSON.stringify(detectSemanticRecords(l.tokens, l.geometry, l.logical, l.spatial, l.rel))).toBe(JSON.stringify(l.sem));
      // 文字列を変えてもgeometry層の結果は変わらない（semantic層だけが変わり得る）
      const masked = l.tokens.map(t => (t.rawText.trim() === '' || /^[─-╿\s]+$/.test(t.rawText) ? t : { ...t, rawText: 'x' }));
      const g2 = buildTableGeometry(masked, l.page);
      const l2 = resolveLogicalRows(masked, l.page, g2);
      const s2 = detectSpatialRegions(masked, g2, l2);
      expect(JSON.stringify([g2, l2, s2, resolveRegionRelations(l.page, l2, s2)])).toBe(JSON.stringify([l.geometry, l.logical, l.spatial, l.rel]));
    }, 60_000);
  }

  it('METI p9: 01-95 を含む主要明細行候補と3つの金額groupを観測でき、raw/visual orderを保持し、semantic typeを付けない', async () => {
    const l = await load('meti-ippan-p9');
    const c = byCode(l, '01-95')!;
    expect(c).toBeDefined();
    expect(c.evidence.some(e => e.kind === 'row_position' && e.value === 'first_token_of_second_segment_after_single_numeric_leading_token')).toBe(true);
    expect(c.amountGroups).toHaveLength(3);
    expect(c.amountGroups[0].bbox.xMax).toBeLessThan(c.amountGroups[1].bbox.xMin);
    for (const g of c.amountGroups) expect(g.visualTokenIndexes).not.toEqual(g.tokenIndexes); // 金額chunkの逆順がtoken refsとして保持される
    expect(c.observations.matter.tokenIndexes.length).toBeGreaterThan(0);
    expect(c.relatedStructures.length).toBeGreaterThan(0);
    expect(l.sem.diagnostics.counts.signObservations).toBeGreaterThan(0); // 実在する△ tokenだけがsign observationになる
    expect(JSON.stringify(c)).not.toContain('request_summary');
  }, 60_000);

  it('MHLW p1268: 020 は METI型（金額groupが3つ）とは異なり、金額の3列が観測されない行頭コード+matter（MHLW型）。空欄を0にしない', async () => {
    const l = await load('mhlw-ippan-p1268');
    const c = byCode(l, '020')!;
    expect(c).toBeDefined();
    // 金額groupは3つにならない。観測された金額らしいtoken（右側の大表の見出しの数字など。文字列だけでは区別できない誤検出）は
    // 3列の候補に割り当てず、ambiguityとして残る
    expect(c.amountGroups.length).not.toBe(3);
    expect(c.ambiguities.some(a => a.kind === 'amount_group_count_not_3')).toBe(true);
    expect(c.observations.previousBudget).toBeUndefined();
    expect(c.observations.difference).toBeUndefined();
    expect(c.status).toBe('ambiguous');
    expect(c.relatedStructures.length).toBeGreaterThan(0); // 右側の大表regionなどへの関連候補（unstableでも捨てない）
    expect(c.relatedStructures.some(r => r.unstableRelationIndexes.length > 0)).toBe(true);
    expect(c.ambiguities.some(a => a.kind === 'matter_boundary_possible_continuation' || a.kind === 'related_structure_relation_unstable')).toBe(true);
    expect(l.sem.diagnostics.ambiguousLogicalRowsAffectingCandidates).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('MHLW p1555: 下部 01-95 の候補へ、上部の大構造を関連構造として誤関連付けしない。1ページに複数のcandidate', async () => {
    const l = await load('mhlw-ippan-p1555');
    expect(l.sem.semanticRecordCandidates.length).toBeGreaterThanOrEqual(2);
    const lower = byCode(l, '01-95')!;
    expect(lower).toBeDefined();
    const upperBig = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    expect(upperBig.bbox.yMax).toBeLessThan(lower.observations.code.bbox.yMin);
    expect(lower.relatedStructures.map(r => r.regionIndex)).not.toContain(upperBig.regionIndex);
    for (const r of lower.relatedStructures) expect(l.spatial.regions[r.regionIndex].bbox.yMax).toBeGreaterThan(upperBig.bbox.yMax);
  }, 60_000);

  it('MEXT p876: 前段のstable relationが0でも、semantic observationと関連構造の参照を全消失させない', async () => {
    const l = await load('mext-detail-p876');
    expect(l.rel.diagnostics.counts.stableRelations).toBe(0);
    expect(l.sem.semanticRecordCandidates.length).toBeGreaterThanOrEqual(4);
    const withRelated = l.sem.semanticRecordCandidates.filter(c => c.relatedStructures.length > 0);
    expect(withRelated.length).toBe(l.sem.semanticRecordCandidates.length);
    expect(l.sem.diagnostics.counts.stableRelationRefs).toBe(0);
    expect(l.sem.diagnostics.counts.unstableRelationRefs).toBeGreaterThan(0);
    expect(l.sem.semanticRecordCandidates.every(c => c.status === 'ambiguous')).toBe(true);
    // 右側の積算構造（anchorを持たない行）の金額らしいtoken群は捨てずに保持される。「備考」による救済はしない
    expect(l.sem.unassignedSemanticObservations.filter(u => u.kind === 'amount_group_candidate').length).toBeGreaterThan(10);
    expect(JSON.stringify(l.sem)).not.toContain('"remark"');
  }, 60_000);
});
