/**
 * RecordAnchor Golden Sample 4系統の実PDF検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。既知の対象をrawTextからlocateするのはtestのみで、resolver本体は文字を読まない。
 * 正解率に合わせたthreshold調整はしない（観測した分類の構造的不変条件と安全条件だけを確認する）。
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { goldenSamplePath, listExtractionTargets, resolveGoldenSamples, type GoldenSampleFile } from './budget-request-extraction';
import { resolveLogicalRows, type LogicalRowResult } from './budget-request-logical-row';
import { extractPageTokens } from './budget-request-pdf-page';
import { assessRecordAnchors, classifyFromEvidence, type RecordAnchorAssessment, type RecordAnchorResult } from './budget-request-record-anchor';
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
  const before = JSON.stringify([e.tokens, geometry, logical, spatial, rel, sem]);
  const anchor = assessRecordAnchors(e.page, geometry.parameters.rowClustering.referenceFontSize, sem);
  const loaded = { tokens: e.tokens, page: e.page, geometry, logical, spatial, rel, sem, anchor, before };
  cache.set(id, loaded);
  return loaded;
}
const assessmentOf = (l: Loaded, code: string): RecordAnchorAssessment | undefined => {
  const c = l.sem.semanticRecordCandidates.find(x => x.observations.code.rawTexts[0] === code);
  return c ? l.anchor.anchorAssessments.find(a => a.semanticCandidateIndex === c.candidateIndex) : undefined;
};
const kinds = (a: RecordAnchorAssessment, side: 'detailEvidence' | 'headingEvidence') => a[side].map(e => e.kind);

describe.skipIf(!available)('RecordAnchor Golden Sample（実PDF・ローカルdata/download依存）', () => {
  for (const { sample } of resolved) {
    it(`${sample.id} (${sample.tier}): 共通の不変条件（上流非破壊・provenance・evidenceから再計算・heading候補も残る）`, async () => {
      const l = await load(sample.id);
      const a = l.anchor;
      // 上流（SemanticRecordResultを含む）は非破壊
      expect(JSON.stringify([l.tokens, l.geometry, l.logical, l.spatial, l.rel, l.sem])).toBe(l.before);
      // 全SemanticRecordCandidateにassessmentがあり、heading_candidateでも候補は除外されない
      expect(a.anchorAssessments).toHaveLength(l.sem.semanticRecordCandidates.length);
      expect(a.diagnostics.assessmentCount).toBe(l.sem.semanticRecordCandidates.length);
      a.anchorAssessments.forEach((x, i) => {
        expect(x.semanticCandidateIndex).toBe(l.sem.semanticRecordCandidates[i].candidateIndex); // provenance: assessment → SemanticRecordCandidate → SourceToken
        // classificationはevidenceの種類から再計算できる
        expect(classifyFromEvidence(kinds(x, 'detailEvidence'), kinds(x, 'headingEvidence')).classification).toBe(x.classification);
        // evidenceは計測値を持ち、scoreを持たない
        for (const e of [...x.detailEvidence, ...x.headingEvidence]) expect(Object.keys(e.measurement).length).toBeGreaterThan(0);
        expect(JSON.stringify(x)).not.toMatch(/"score"|"confidence"/);
        // 安定でないassessmentは理由を持つ
        expect(x.stability.stable).toBe(x.stability.reasons.length === 0);
      });
      // layout familyは全候補をちょうど1回ずつ含む
      expect(a.layoutFamilies.flatMap(f => f.semanticCandidateIndexes).sort((p, q) => p - q)).toEqual(l.sem.semanticRecordCandidates.map(c => c.candidateIndex));
      // 決定的
      expect(JSON.stringify(assessRecordAnchors(l.page, l.geometry.parameters.rowClustering.referenceFontSize, l.sem))).toBe(JSON.stringify(a));
      // このresolverは文字内容を読まない: SemanticRecordCandidateのrawTextsをすべて同じ文字に置換しても、assessmentは同一
      const masked = JSON.parse(JSON.stringify(l.sem)) as SemanticRecordResult;
      for (const c of masked.semanticRecordCandidates) for (const o of [c.observations.code, c.observations.matter, ...c.amountGroups]) o.rawTexts = o.rawTexts.map(() => 'x');
      expect(JSON.stringify(assessRecordAnchors(l.page, l.geometry.parameters.rowClustering.referenceFontSize, masked))).toBe(JSON.stringify(a));
    }, 60_000);
  }

  it('METI p9: 27 には heading を支持するevidenceがあり、01-95 など3つの金額groupを持つ候補群とlayout evidenceが異なる', async () => {
    const l = await load('meti-ippan-p9');
    const head = assessmentOf(l, '27')!;
    const detail = assessmentOf(l, '01-95')!;
    expect(head.classification).toBe('heading_candidate');
    expect(kinds(head, 'headingEvidence')).toEqual(['page_relative_top', 'isolated_layout', 'lacks_field_structure']);
    expect(head.detailEvidence).toHaveLength(0);
    expect(detail.classification).toBe('detail_candidate');
    expect(kinds(detail, 'detailEvidence')).toEqual(expect.arrayContaining(['three_amount_groups', 'repeated_amount_columns']));
    expect(head.layoutFamilyIndex).not.toBe(detail.layoutFamilyIndex);
    // 3つの金額groupを持つ候補群で金額列の繰り返しが観測される
    const withRepeated = l.anchor.anchorAssessments.filter(a => kinds(a, 'detailEvidence').includes('repeated_amount_columns'));
    expect(withRepeated.length).toBeGreaterThan(10);
  }, 60_000);

  it('MHLW p1268: 1260 と 020 のevidenceが異なり、020 は金額groupが無い（3つでない）だけでは heading に確定しない', async () => {
    const l = await load('mhlw-ippan-p1268');
    const h = assessmentOf(l, '1260')!;
    const d = assessmentOf(l, '020')!;
    expect(h.classification).toBe('heading_candidate');
    expect(d.classification).not.toBe('heading_candidate');
    expect(kinds(d, 'headingEvidence')).toContain('lacks_field_structure'); // 金額structureが無いというevidenceは観測される
    expect(kinds(d, 'headingEvidence')).not.toContain('page_relative_top'); // が、それだけではheadingの条件を満たさない
    expect(h.headingEvidence.length).toBeGreaterThan(d.headingEvidence.length);
    // right-side tableの数字（金額らしいtoken）をanchor evidenceと混同しない: 020は金額3列のevidenceを持たない
    expect(kinds(d, 'detailEvidence')).not.toContain('three_amount_groups');
  }, 60_000);

  it('MHLW p1555: 下部 01-95 は detail candidate のままで、上部の大構造がassessmentのevidenceへ混入しない。1ページに複数のcandidate', async () => {
    const l = await load('mhlw-ippan-p1555');
    expect(l.anchor.anchorAssessments.length).toBeGreaterThanOrEqual(2);
    const lower = assessmentOf(l, '01-95')!;
    expect(lower.classification).toBe('detail_candidate');
    const cand = l.sem.semanticRecordCandidates[lower.semanticCandidateIndex];
    const upperBig = l.spatial.regions.reduce((a, b) => (b.geometry.tokenCount > a.geometry.tokenCount ? b : a));
    expect(cand.relatedStructures.map(r => r.regionIndex)).not.toContain(upperBig.regionIndex); // 既存のfalse-association safety
    // relation/region由来のevidenceは中立（観測のみ）で、detail/headingの根拠にしていない
    expect(lower.neutralEvidence.map(e => e.kind)).toEqual(['relation_context']);
    expect([...kinds(lower, 'detailEvidence'), ...kinds(lower, 'headingEvidence')]).not.toContain('relation_context');
  }, 60_000);

  it('MEXT p876: 884 に heading を支持するevidenceがあり、detail-likeなコードとlayout evidenceが異なる。stable relation=0でもassessmentが全て生成される', async () => {
    const l = await load('mext-detail-p876');
    expect(l.rel.diagnostics.counts.stableRelations).toBe(0);
    expect(l.anchor.anchorAssessments).toHaveLength(l.sem.semanticRecordCandidates.length);
    const head = assessmentOf(l, '884')!;
    expect(head.classification).toBe('heading_candidate');
    expect(kinds(head, 'headingEvidence')).toEqual(['page_relative_top', 'isolated_layout', 'lacks_field_structure']);
    const details = l.anchor.anchorAssessments.filter(a => a.classification === 'detail_candidate');
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) {
      expect(kinds(d, 'detailEvidence')).toEqual(expect.arrayContaining(['three_amount_groups']));
      expect(d.layoutFamilyIndex).not.toBe(head.layoutFamilyIndex);
    }
  }, 60_000);
});
