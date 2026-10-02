/**
 * PageTemplateObservation Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。既知の対象をrawTextからlocateするのはtestのみ（resolver本体は文字を使わない）。
 * templateは分類ではなく観測であり、「どの行がheading/detailか」は固定しない。観測された文脈の差が説明可能であることだけを確認する。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { resolveLogicalRows, type LogicalRowResult } from './budget-request-logical-row';
import { observePageTemplate, type PageRowObservation, type PageTemplateResult } from './budget-request-page-template';
import { extractPageTokens } from './budget-request-pdf-page';
import { assessRecordAnchors, type RecordAnchorResult } from './budget-request-record-anchor';
import { resolveRegionRelations, type RegionRelationResult } from './budget-request-region-relation';
import { detectSemanticRecords, type SemanticRecordResult } from './budget-request-semantic-record';
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
  anchor: RecordAnchorResult;
  tpl: PageTemplateResult;
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
  const sem = detectSemanticRecords(e.tokens, geometry, logical, spatial, rel);
  const anchor = assessRecordAnchors(e.page, geometry.parameters.rowClustering.referenceFontSize, sem);
  const before = JSON.stringify([e.tokens, geometry, logical, spatial, rel, sem, anchor]);
  const tpl = observePageTemplate(e.tokens, e.page, geometry, logical, spatial, sem, anchor);
  const loaded = { tokens: e.tokens, page: e.page, geometry, logical, spatial, rel, sem, anchor, tpl, before };
  cache.set(id, loaded);
  return loaded;
}
const rowOfCode = (l: Loaded, code: string): PageRowObservation | undefined => {
  const c = l.sem.semanticRecordCandidates.find(x => x.observations.code.rawTexts[0] === code);
  return c ? l.tpl.rowObservations.find(r => r.semanticCandidateIndexes.includes(c.candidateIndex)) : undefined;
};

describe.skipIf(!available)('PageTemplateObservation Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（上流非破壊・provenance・classification非依存・rawText非依存・決定性）`, async () => {
      const l = await load(sample.id);
      const t = l.tpl;
      // 上流（RecordAnchorResultを含む）は非破壊
      expect(JSON.stringify([l.tokens, l.geometry, l.logical, l.spatial, l.rel, l.sem, l.anchor])).toBe(l.before);
      // 行observationはLogicalRowCandidateへ戻れ、semantic candidateだけでなくanchorにならなかった行も観測する
      expect(t.rowObservations.length).toBeGreaterThan(l.sem.semanticRecordCandidates.length);
      for (const r of t.rowObservations) {
        expect(l.logical.logicalRowCandidates[r.logicalRowIndex].physicalRowIndexes).toEqual(r.physicalRowIndexes);
        expect(r.normalized.xMin).toBeCloseTo(r.bbox.xMin / l.page.width, 2);
        expect(r.layoutFeatures.startX.normalized).toBeCloseTo(r.layoutFeatures.startX.value / l.page.width, 2);
      }
      expect(t.rowFamilies.flatMap(f => f.memberRowIndexes).sort((a, b) => a - b)).toEqual(t.rowObservations.map(r => r.rowIndex));
      expect(t.indentationClusters.flatMap(c => c.memberRowIndexes).sort((a, b) => a - b)).toEqual(t.rowObservations.map(r => r.rowIndex));
      expect(t.sequenceObservations).toHaveLength(t.rowObservations.length);
      for (const h of t.hierarchyRelationCandidates) expect(h.sourceRowIndex).toBeLessThan(h.targetRowIndex);
      expect(t.diagnostics.sensitivity.map(s => s.scale)).toEqual([0.8, 1.25]);
      // semantic typeを付けない
      expect(JSON.stringify([t.rowObservations, t.indentationClusters, t.rowFamilies, t.boundaryCandidates, t.hierarchyRelationCandidates])).not.toMatch(/heading|section|"detail|remark|request_summary|breakdown/);
      // RecordAnchorのclassification / stabilityをtemplateのfeatureに使わない: 反転させても結果は同一
      const flipped = JSON.parse(JSON.stringify(l.anchor)) as RecordAnchorResult;
      for (const a of flipped.anchorAssessments) {
        a.classification = a.classification === 'heading_candidate' ? 'detail_candidate' : 'heading_candidate';
        a.stability = { stable: !a.stability.stable, reasons: ['flipped'] };
      }
      expect(JSON.stringify(observePageTemplate(l.tokens, l.page, l.geometry, l.logical, l.spatial, l.sem, flipped))).toBe(JSON.stringify(t));
      // SourceToken.rawTextをmask（罫線・空白の文字クラスは維持）してもtemplateは同一（既存のSemanticRecordResultは固定）
      const masked = l.tokens.map(x => (x.rawText.trim() === '' || /^[─-╿\s]+$/.test(x.rawText) ? x : { ...x, rawText: 'x' }));
      expect(JSON.stringify(observePageTemplate(masked, l.page, l.geometry, l.logical, l.spatial, l.sem, l.anchor))).toBe(JSON.stringify(t));
      // 決定的
      expect(JSON.stringify(observePageTemplate(l.tokens, l.page, l.geometry, l.logical, l.spatial, l.sem, l.anchor))).toBe(JSON.stringify(t));
    }, 60_000);
  }

  it('METI p9: 27 と 01-95 のpage contextが異なり、金額列patternの反復と反復row familyを観測し、001系のcontextも記録される', async () => {
    const l = await load('meti-ippan-p9');
    const top = rowOfCode(l, '27')!;
    const detail = rowOfCode(l, '01-95')!;
    expect(top.context.rowsBeforeWithAmountPattern).toBe(0);
    expect(top.context.precedingRowHasAmountPattern).not.toBe(true);
    expect(detail.context.precedingRowHasAmountPattern).toBe(true);
    expect(top.signature.amountColumnPatternIndex).toBeNull();
    expect(detail.signature.amountColumnPatternIndex).not.toBeNull();
    expect(l.tpl.amountColumnPatterns.some(p => p.supportCount >= 10)).toBe(true);
    expect(l.tpl.rowFamilies.some(f => f.supportCount >= 10 && !f.isolated)).toBe(true);
    const ambiguousRows = l.anchor.anchorAssessments.filter(a => a.classification === 'ambiguous').map(a => l.tpl.rowObservations.find(r => r.semanticCandidateIndexes.includes(a.semanticCandidateIndex))!);
    expect(ambiguousRows.length).toBeGreaterThan(0);
    for (const r of ambiguousRows) expect(r.context.boundaryBefore.length + r.context.boundaryAfter.length).toBeGreaterThan(0); // 001系などのcontext（境界）を記録
  }, 60_000);

  it('MHLW p1268: 1260 と 020 のcontextが異なり、020は分類せずsequence/hierarchy evidenceを残す。右側の表が階層候補を作らない', async () => {
    const l = await load('mhlw-ippan-p1268');
    const h = rowOfCode(l, '1260')!;
    const d = rowOfCode(l, '020')!;
    expect(h.context.rowsBefore).toBe(0);
    expect(d.context.rowsBefore).toBeGreaterThan(0);
    expect(l.tpl.sequenceObservations[d.rowIndex]).toBeDefined();
    expect(l.tpl.sequenceObservations[d.rowIndex].previousFamilyIndex).not.toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/heading|detail_candidate/);
    // 右側の表の行（開始xがページ幅の40%以上）は、左側の行を source とする階層候補の target にならない（indentの跳びは列の違い）
    const right = (r: PageRowObservation) => r.layoutFeatures.startX.normalized >= 0.4;
    const falseHierarchy = l.tpl.hierarchyRelationCandidates.filter(x => !right(l.tpl.rowObservations[x.sourceRowIndex]) && right(l.tpl.rowObservations[x.targetRowIndex]));
    expect(falseHierarchy).toEqual([]);
    expect(l.tpl.diagnostics.indentJumpsNotTreatedAsHierarchy).toBeGreaterThan(10);
  }, 60_000);

  it('MHLW p1555: 010 のpage contextを記録。下部 01-95 の安全性は維持。010 は既知のページ見出しcontrolと構造が異なる', async () => {
    const l = await load('mhlw-ippan-p1555');
    const ten = rowOfCode(l, '010')!;
    const lower = rowOfCode(l, '01-95')!;
    expect(ten.context.rowsBefore).toBeGreaterThan(0);
    expect(ten.context.precedingRowHasAmountPattern).toBe(true);
    expect(ten.context.boundaryBefore).toContain('amount_pattern_disappears');
    // 下部01-95: 上部の大構造との関連（階層候補）を作らない。sourceはどれもより浅い位置の行
    const upperBig = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    const toLower = l.tpl.hierarchyRelationCandidates.filter(x => x.targetRowIndex === lower.rowIndex);
    for (const x of toLower) {
      const src = l.tpl.rowObservations[x.sourceRowIndex];
      expect(src.layoutFeatures.startX.value).toBeLessThan(lower.layoutFeatures.startX.value);
      expect(src.layoutFeatures.regionIndexes).not.toContain(upperBig.regionIndex);
    }
    // 既知のページ見出しcontrol（上端の行）とは文脈が異なる: 直前に金額列patternを持つ行があるか
    const controls = [await load('meti-ippan-p9'), await load('mhlw-ippan-p1268'), await load('mext-detail-p876')];
    const controlRows = [rowOfCode(controls[0], '27')!, rowOfCode(controls[1], '1260')!, rowOfCode(controls[2], '884')!];
    for (const c of controlRows) {
      expect(c.context.rowsBeforeWithAmountPattern).toBe(0);
      expect(c.context.precedingRowHasAmountPattern).not.toBe(true);
    }
  }, 120_000);

  it('MEXT p876: 884 と detail-like の文脈が異なり、stable relation=0でもtemplateを生成する。右側の構造を意味分類しない', async () => {
    const l = await load('mext-detail-p876');
    expect(l.rel.diagnostics.counts.stableRelations).toBe(0);
    const head = rowOfCode(l, '884')!;
    const detailLike = l.sem.semanticRecordCandidates.filter(c => c.observations.code.rawTexts[0].startsWith('95016-'));
    expect(detailLike.length).toBeGreaterThan(0);
    expect(head.context.rowsBeforeWithAmountPattern).toBe(0);
    for (const c of detailLike) {
      const r = l.tpl.rowObservations.find(x => x.semanticCandidateIndexes.includes(c.candidateIndex))!;
      expect(r.context.rowsBeforeWithAmountPattern).toBeGreaterThan(0);
      expect(r.signature.indentationClusterIndex).not.toBe(head.signature.indentationClusterIndex);
    }
    expect(l.tpl.rowObservations.some(r => r.layoutFeatures.regionIndexes.length >= 2)).toBe(true); // 左右のregionにまたがる行の観測
    expect(JSON.stringify(l.tpl)).not.toContain('"remark"');
  }, 60_000);
});
