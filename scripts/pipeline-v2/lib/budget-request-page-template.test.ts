import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveLogicalRows } from './budget-request-logical-row';
import { DEFAULT_PAGE_TEMPLATE_OPTIONS, observePageTemplate, type PageTemplateResult } from './budget-request-page-template';
import { assessRecordAnchors } from './budget-request-record-anchor';
import { resolveRegionRelations } from './budget-request-region-relation';
import { detectSemanticRecords } from './budget-request-semantic-record';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { detectSpatialRegions } from './budget-request-spatial-region';
import { buildTableGeometry } from './budget-request-table-geometry';

const meta = pageMetaFrom(1, 1, [0, 0, 842, 595], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const PITCH = 14;

function tok(text: string, x: number, baselineTop: number, width = 10): SourceToken {
  const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 595 - baselineTop], width, height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
}
const index = (ts: SourceToken[]): SourceToken[] => ts.map((t, i) => ({ ...t, index: i }));
const chunks = (y: number, colX: number, c: string[]): SourceToken[] => [...c].reverse().map((t, k) => tok(t, colX + (c.length - 1 - k) * 12, y, 12));
/** code・matter・金額3列を持つ明細風の行 */
const detailRow = (y: number, codeX: number, code = '01-95', matter = '経費項目'): SourceToken[] => [
  tok(code, codeX, y, 24),
  tok(matter, codeX + 38, y, 50),
  ...chunks(y, 250, ['1,', '234']),
  ...chunks(y, 330, ['2,', '345']),
  ...chunks(y, 450, ['3,', '456']),
];
const labelRow = (y: number, x: number, code = '010', matter = '見出し風'): SourceToken[] => [tok(code, x, y, 24), tok(matter, x + 38, y, 50)];

function run(tokensIn: SourceToken[]) {
  const tokens = index(tokensIn);
  const geometry = buildTableGeometry(tokens, meta);
  const logical = resolveLogicalRows(tokens, meta, geometry);
  const spatial = detectSpatialRegions(tokens, geometry, logical);
  const rel = resolveRegionRelations(meta, logical, spatial);
  const sem = detectSemanticRecords(tokens, geometry, logical, spatial, rel);
  const anchor = assessRecordAnchors(meta, geometry.parameters.rowClustering.referenceFontSize, sem);
  const tpl = observePageTemplate(tokens, meta, geometry, logical, spatial, sem, anchor);
  return { tokens, geometry, logical, spatial, rel, sem, anchor, tpl };
}

describe('正規化geometry（raw + normalized の両方を保持）', () => {
  it('bbox・開始xの絶対値とページ相対値を持つ', () => {
    const { tpl } = run(detailRow(100, 60));
    const r = tpl.rowObservations[0];
    expect(r.layoutFeatures.startX.value).toBe(60);
    expect(r.layoutFeatures.startX.normalized).toBeCloseTo(60 / 842, 3);
    expect(r.normalized.xMin).toBeCloseTo(r.bbox.xMin / 842, 3);
    expect(r.normalized.yMax).toBeCloseTo(r.bbox.yMax / 595, 3);
    expect(r.normalized.width).toBeCloseTo((r.bbox.xMax - r.bbox.xMin) / 842, 3);
  });
});

describe('indentation clustering', () => {
  it('位置の揃う行は同じcluster、離れた行は別cluster（複数cluster）。階層名は付けない', () => {
    const { tpl } = run([...detailRow(100, 60), ...detailRow(114, 60), ...detailRow(128, 130), ...detailRow(142, 130)]);
    expect(tpl.indentationClusters).toHaveLength(2);
    expect(tpl.indentationClusters.map(c => c.memberRowIndexes)).toEqual([[0, 1], [2, 3]]);
    expect(JSON.stringify(tpl.indentationClusters)).not.toMatch(/heading|section|detail|level/);
  });

  it('連鎖しない: 隣同士がtolerance以内でも、最小値を起点とする幅を超えれば別cluster', () => {
    const tol = 0.25 * FS;
    const { tpl } = run([100, 100 + tol * 0.9, 100 + tol * 1.8].flatMap((x, k) => detailRow(100 + k * PITCH, x)));
    expect(tpl.indentationClusters.map(c => c.memberRowIndexes.length)).toEqual([2, 1]);
  });

  it('先頭の単独の短いtokenのsegmentは開始xの判定で飛ばす（geometryのみ）', () => {
    const { tpl } = run([tok('9', 20, 100, 8), ...detailRow(100, 60)]);
    expect(tpl.rowObservations[0].layoutFeatures.startX.value).toBe(60);
    expect(tpl.rowObservations[0].layoutFeatures.leftEdgeX.value).toBe(20);
  });
});

describe('amount-column pattern', () => {
  it('同じ金額列の並びが反復するとpatternになり、support・spread・正規化位置を持つ。3列=detailとは解釈しない', () => {
    const { tpl } = run([...detailRow(100, 60), ...detailRow(114, 60), ...detailRow(128, 60)]);
    expect(tpl.amountColumnPatterns).toHaveLength(1);
    const p = tpl.amountColumnPatterns[0];
    expect(p).toMatchObject({ groupCount: 3, supportCount: 3, spread: [0, 0, 0] });
    expect(p.columnRightEdges[0].normalized).toBeCloseTo(p.columnRightEdges[0].value / 842, 3);
    expect(JSON.stringify(p)).not.toMatch(/detail|heading/);
  });

  it('金額が無い行ではpatternが無い（absent）', () => {
    const { tpl } = run([...labelRow(100, 60), ...labelRow(114, 60)]);
    expect(tpl.amountColumnPatterns).toHaveLength(0);
    expect(tpl.rowObservations.every(r => r.signature.amountColumnPatternIndex === null)).toBe(true);
  });

  it('列位置が違う金額のgroupは別pattern', () => {
    const shifted = [tok('01-95', 60, 114, 24), tok('経費項目', 98, 114, 50), ...chunks(114, 270, ['1,', '234']), ...chunks(114, 350, ['2,', '345']), ...chunks(114, 470, ['3,', '456'])];
    const { tpl } = run([...detailRow(100, 60), ...shifted]);
    expect(tpl.amountColumnPatterns).toHaveLength(2);
  });
});

describe('row layout signature / row family', () => {
  it('signatureは数値・真偽のみ（文字列・hashを含まない）で、同じ行型は同じsignature', () => {
    const { tpl } = run([...detailRow(100, 60), ...detailRow(114, 60)]);
    const [a, b] = tpl.rowObservations.map(r => r.signature);
    expect(a).toEqual(b);
    for (const v of Object.values(a)) expect(['number', 'boolean']).toContain(v === null ? 'number' : typeof v);
    expect(a.hasThreeAmountGroups).toBe(true);
  });

  it('反復するrow familyと、単発のfamily（isolated）を区別して観測する', () => {
    const { tpl } = run([...labelRow(100, 40), ...detailRow(130, 70), ...detailRow(144, 70), ...detailRow(158, 70)]);
    const sizes = tpl.rowFamilies.map(f => f.supportCount);
    expect(sizes).toEqual(expect.arrayContaining([1, 3]));
    expect(tpl.rowFamilies.find(f => f.supportCount === 1)?.isolated).toBe(true);
    expect(tpl.rowFamilies.find(f => f.supportCount === 3)?.isolated).toBe(false);
  });
});

describe('vertical sequence / boundary candidates', () => {
  it('前後のfamily・縦の間隔・行間比を再計算できる形で持つ', () => {
    const { tpl } = run([...detailRow(100, 60), ...detailRow(114, 60), ...labelRow(128, 100)]);
    const s = tpl.sequenceObservations;
    expect(s[0]).toMatchObject({ previousFamilyIndex: null, verticalGap: null, rowPitchRatio: null });
    expect(s[1].previousFamilyIndex).toBe(s[0].currentFamilyIndex);
    expect(s[1].rowPitchRatio).toBe(1);
    expect(s[1].nextFamilyIndex).toBe(s[2].currentFamilyIndex);
    expect(s[2].baselineDistance).toBe(14);
  });

  it('縦の間隔が大きく増える箇所は vertical_gap_increase（単独では境界を確定しない）', () => {
    const { tpl } = run([...detailRow(100, 60), ...detailRow(114, 60), ...detailRow(128, 60), ...detailRow(200, 60)]);
    const b = tpl.boundaryCandidates.find(x => x.afterRowIndex === 3)!;
    expect(b.evidenceKinds).toContain('vertical_gap_increase');
    expect(b.evidenceKinds).not.toContain('indentation_cluster_change');
    expect(b.evidenceKinds).not.toContain('row_family_change'); // 同じ行型。他のevidenceは複数のevidenceの組み合わせとして記録される
    expect(b.measurements.rowPitchRatio).toBeGreaterThanOrEqual(1.5);
  });

  it('indentationが変わる箇所と、金額patternの出現・消失が boundary evidence になる', () => {
    const { tpl } = run([...labelRow(100, 40), ...detailRow(114, 70), ...labelRow(128, 40)]);
    const kinds = tpl.boundaryCandidates.map(b => b.evidenceKinds);
    expect(kinds[0]).toEqual(expect.arrayContaining(['indentation_cluster_change', 'amount_pattern_appears']));
    expect(kinds[1]).toEqual(expect.arrayContaining(['amount_pattern_disappears']));
    expect(tpl.diagnostics.boundaryEvidenceDistribution).toMatchObject({ amount_pattern_appears: 1, amount_pattern_disappears: 1 });
  });
});

describe('hierarchy relation candidates（親/子の名前を付けず、winnerを作らない）', () => {
  it('より深いindentの行が続くとき、開いている全ての行を候補として保持し、競合として記録する', () => {
    // x=40 → x=60 → x=80 の順に深くなる3行
    const { tpl } = run([...labelRow(100, 40), ...labelRow(114, 60), ...labelRow(128, 80)]);
    const toRow2 = tpl.hierarchyRelationCandidates.filter(r => r.targetRowIndex === 2);
    expect(toRow2.map(r => r.sourceRowIndex).sort()).toEqual([0, 1]); // 直近の行だけでなく、開いている全てが候補
    for (const r of toRow2) {
      expect(r.competingRelationIndexes).toHaveLength(1);
      expect(r.stability.reasons).toContain('multiple_plausible_parents');
      expect(r.evidence.map(e => e.kind)).toEqual(['source_precedes_target', 'target_more_indented', 'target_family_repeats_after_source', 'amount_pattern_in_source_descendants']);
    }
    expect(tpl.diagnostics.hierarchyRowsWithMultiplePlausibleParents).toBe(1);
    expect(JSON.stringify(tpl.hierarchyRelationCandidates)).not.toMatch(/parent_|"child|heading|detail/);
  });

  it('indentの跳びがmaxIndentStepを超える行（別の列）は階層候補にしない', () => {
    const { tpl } = run([...labelRow(100, 40), ...labelRow(114, 560)]);
    expect(tpl.hierarchyRelationCandidates).toHaveLength(0);
    expect(tpl.diagnostics.indentJumpsNotTreatedAsHierarchy).toBe(1);
  });

  it('子孫に金額patternがある行は descendantRowsWithAmountPattern に数えられる（文脈の観測）', () => {
    const { tpl } = run([...labelRow(100, 40), ...detailRow(114, 70), ...detailRow(128, 70)]);
    expect(tpl.rowObservations[0].context).toMatchObject({ descendantRowCount: 2, descendantRowsWithAmountPattern: 2, rowsBefore: 0, precedingRowHasAmountPattern: null });
    expect(tpl.rowObservations[1].context).toMatchObject({ rowsBeforeWithAmountPattern: 0, precedingRowHasAmountPattern: false });
    expect(tpl.rowObservations[2].context.precedingRowHasAmountPattern).toBe(true);
  });
});

describe('sensitivity・provenance・非破壊・text独立・決定性', () => {
  const sample = () => run([...labelRow(100, 40), ...detailRow(114, 70), ...detailRow(128, 70), ...detailRow(142, 70.3)]);

  it('0.8×/1.25×の変化を記録する', () => {
    const { tpl } = run([...detailRow(100, 60), ...detailRow(114, 61.8)]); // 差 1.8pt: 1.736では別cluster、1.25×(2.17)では同一
    const s = tpl.diagnostics.sensitivity;
    expect(s.map(x => x.scale)).toEqual([0.8, 1.25]);
    expect(tpl.indentationClusters).toHaveLength(2);
    expect(s[1].indentationClusterCount).toBe(1);
    expect(s[1].changed.indentationClusters).toBe(2);
    expect(tpl.rowObservations.every(r => !r.context.indentStableUnderSensitivity)).toBe(true);
    expect(tpl.indentationClusters.every(c => !c.stability.stable)).toBe(true);
  });

  it('provenance: 観測から logical/physical row・SemanticRecordCandidate・SourceTokenへ戻れる', () => {
    const { tpl, logical, geometry, sem, tokens } = sample();
    for (const r of tpl.rowObservations) {
      const l = logical.logicalRowCandidates[r.logicalRowIndex];
      expect(l.physicalRowIndexes).toEqual(r.physicalRowIndexes);
      for (const p of r.physicalRowIndexes) for (const i of geometry.physicalRows[p].rawTokenIndexes) expect(tokens[i]).toBeDefined();
      for (const c of r.semanticCandidateIndexes) expect(sem.semanticRecordCandidates[c]).toBeDefined();
    }
    for (const f of tpl.rowFamilies) for (const m of f.memberRowIndexes) expect(tpl.rowObservations[m]).toBeDefined();
    for (const b of tpl.boundaryCandidates) expect(b.afterRowIndex).toBe(b.beforeRowIndex + 1);
    for (const h of tpl.hierarchyRelationCandidates) expect(h.sourceRowIndex).toBeLessThan(h.targetRowIndex);
  });

  it('上流（SourceToken〜RecordAnchor）を変更しない', () => {
    const r = run([...labelRow(100, 40), ...detailRow(114, 70), ...detailRow(128, 70)]);
    const before = JSON.stringify([r.tokens, r.geometry, r.logical, r.spatial, r.rel, r.sem, r.anchor]);
    observePageTemplate(r.tokens, meta, r.geometry, r.logical, r.spatial, r.sem, r.anchor);
    expect(JSON.stringify([r.tokens, r.geometry, r.logical, r.spatial, r.rel, r.sem, r.anchor])).toBe(before);
  });

  it('RecordAnchorのclassification / stabilityをtemplateのfeatureに使わない（書き換えても結果は同一）', () => {
    const r = run([...labelRow(100, 40), ...detailRow(114, 70), ...detailRow(128, 70), ...detailRow(142, 70)]);
    const flipped = JSON.parse(JSON.stringify(r.anchor)) as typeof r.anchor;
    for (const a of flipped.anchorAssessments) {
      a.classification = a.classification === 'heading_candidate' ? 'detail_candidate' : 'heading_candidate';
      a.stability = { stable: !a.stability.stable, reasons: ['x'] };
    }
    const alt = observePageTemplate(r.tokens, meta, r.geometry, r.logical, r.spatial, r.sem, flipped);
    expect(JSON.stringify(alt)).toBe(JSON.stringify(r.tpl));
    expect(r.tpl.parameters.recordAnchorClassificationUsedAsFeature).toBe(false);
  });

  it('rawText independence: SourceToken.rawTextをmaskしてもtemplateは同一（罫線文字クラスを除く）', () => {
    const r = run([...labelRow(100, 40), ...detailRow(114, 70), ...detailRow(128, 70)]);
    const masked = r.tokens.map(t => ({ ...t, rawText: 'x' }));
    expect(JSON.stringify(observePageTemplate(masked, meta, r.geometry, r.logical, r.spatial, r.sem, r.anchor))).toBe(JSON.stringify(r.tpl));
  });

  it('決定的', () => {
    expect(JSON.stringify(sample().tpl)).toBe(JSON.stringify(sample().tpl));
  });

  it('resolver本体は特定のコード値・見出し語のliteralを使わない', () => {
    const src = fs.readFileSync(path.join(__dirname, 'budget-request-page-template.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    for (const literal of ['01-95', '"010"', "'010'", '"020"', "'020'", "'27'", '"27"', '884', '1260', '所管', '厚（ハ）', '文（本）']) expect(code).not.toContain(literal);
    expect(code).not.toContain('heading_candidate');
    expect(code).not.toContain('.classification');
  });

  it('パラメータをparametersに記録する', () => {
    const { tpl }: { tpl: PageTemplateResult } = sample();
    expect(tpl.parameters).toMatchObject({ ...DEFAULT_PAGE_TEMPLATE_OPTIONS, pageWidth: 842, pageHeight: 595, classificationUsed: false });
    expect(tpl.parameters.alignmentTolerance).toBe(1.736);
  });
});
