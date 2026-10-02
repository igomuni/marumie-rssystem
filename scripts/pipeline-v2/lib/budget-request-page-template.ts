/**
 * PageTemplateObservation PoC: ページ全体について「どのx位置に・どの種類の行構造が・どの順序で・どの程度反復し・どこで構造が切り替わるか」を、
 * semantic classification とは独立に観測する。局所的には似て見える見出し行・節(グループ)行・階層の上位行を区別する追加evidenceが
 * 得られるかを見るためのもので、いずれのsemantic typeも確定しない。
 *
 * ## 原則
 * - 観測対象は LogicalRowCandidate（PhysicalRowCandidate・SourceTokenへ戻れる）。SemanticRecordCandidateだけをページ全体とみなさない
 *   （anchorにならなかった行も観測する）。SpatialRegionは補助（行が触れるregion数）に使う。
 * - 主要ロジックは rawText の内容を使わない。使うのは bbox・fontSize・segment・金額groupのbbox・region参照・ページ寸法。
 *   例外は罫線token有無（ruleTokenPresence。罫線文字だけのtokenかどうかの文字クラス判定のみ）。
 *   特定のコード値・見出し語のliteralは使わない。
 * - **RecordAnchorAssessment の classification / stable を template の入力featureに使わない**（assessmentIndexは参照として持つだけ）。
 *   `010` のような個別の行のための例外ルール、RecordAnchorの topFraction の変更もしない。
 * - 絶対値（pt）とページ相対値（÷ページ幅・高さ）の両方を保持する。しきい値はページ由来の相対値で、すべて出力のparametersに残し、
 *   0.8× / 1.0× / 1.25× で感度を診断する（Golden Sampleの正解に合わせて調整しない）。
 * - ambiguity / unstable な観測を捨てず first-class に残す: 複数のfamilyが妥当な行、感度で変わる境界、複数の妥当な親を持つ階層候補。
 *   nearest winner を選ばない。
 * - 入力（SourceToken / TableGeometry / LogicalRow / SpatialRegion / SemanticRecord / RecordAnchor）は読み取るだけ。
 *
 * ## 観測
 * - rowObservations: 行の位置（raw + normalized）・layout特徴・row layout signature・文脈（後続行の階層上の子孫数など）
 * - indentationClusters: 行の「開始x」（先頭の単独の短いtokenのsegmentを飛ばした最初のsegmentの左端）の反復位置（最小値を起点にbin化、連鎖しない）。
 *   階層（見出し/節/明細）への対応は付けない。
 * - amountColumnPatterns: 金額groupの右端の並びが反復するpattern（3列=detailとは解釈しない）
 * - rowFamilies: (indent cluster, 金額列pattern, 罫線有無) が同じ行の反復（同じ階層だけでなく同じ行型の反復）
 * - sequenceObservations / boundaryCandidates: 行の縦の並びと、隣り合う行の間で構造が変わる箇所（複数のevidenceの組み合わせ。単独では確定しない）
 * - hierarchyRelationCandidates: indentationと縦の並びから、行Bを子孫に持ちうる「開いている」行Aの候補を全て保持（親/子のsemantic名なし）。
 *   indent差が1段の上限（maxIndentStep）を超える跳びは列の違いとして、遠い祖先とは結ばず、新しい列の起点にする。
 */
import type { LogicalRowCandidate, LogicalRowResult } from './budget-request-logical-row';
import type { RecordAnchorResult } from './budget-request-record-anchor';
import type { SemanticRecordCandidate, SemanticRecordResult } from './budget-request-semantic-record';
import type { PageMeta, SourceToken, SourceTokenBBox } from './budget-request-source-token';
import type { SpatialRegionResult } from './budget-request-spatial-region';
import type { TableGeometryResult } from './budget-request-table-geometry';

export const PAGE_TEMPLATE_SCHEMA = 'budget-request-page-template-poc/v1';

export interface PageTemplateOptions {
  /** 位置の揃い（indent・金額列の右端）の幅 = factor × fontSize中央値 */
  alignmentToleranceFactor: number;
  /** 階層とみなす1段のindent差の上限 = factor × fontSize中央値（これを超える位置の跳びは列の違いで、階層候補にしない） */
  maxIndentStepFactor: number;
  /** 縦の間隔が増えたとみなす baseline距離 / 行間の中央値 の下限 */
  verticalGapPitchFactor: number;
  /** relative width を丸める幅（ページ幅に対する比） */
  widthBucketSize: number;
  sensitivityScales: number[];
}

export const DEFAULT_PAGE_TEMPLATE_OPTIONS: PageTemplateOptions = {
  alignmentToleranceFactor: 0.25,
  maxIndentStepFactor: 10,
  verticalGapPitchFactor: 1.5,
  widthBucketSize: 0.1,
  sensitivityScales: [0.8, 1.25],
};

export interface Measure {
  value: number;
  normalized: number;
}

export interface RowLayoutSignature {
  indentationClusterIndex: number;
  segmentCountBucket: number;
  hasThreeAmountGroups: boolean;
  amountColumnPatternIndex: number | null;
  hasSignObservation: boolean;
  spansMultipleRegions: boolean;
  hasRuleTokens: boolean;
  relativeWidthBucket: number;
  fontSizeBucket: number;
}

export interface PageRowObservation {
  /** 観測順（y順）の番号 */
  rowIndex: number;
  logicalRowIndex: number;
  physicalRowIndexes: number[];
  bbox: SourceTokenBBox;
  normalized: { xMin: number; xMax: number; yMin: number; yMax: number; width: number };
  layoutFeatures: {
    segmentCount: number;
    tokenCount: number;
    fontSizeStats: { min: number; median: number; max: number };
    /** 行の開始x（先頭の単独の短いtokenのsegmentを飛ばした最初のsegmentの左端） */
    startX: Measure;
    leftEdgeX: Measure;
    regionIndexes: number[];
    hasRuleTokens: boolean;
    amountGroups: { count: number; rightEdges: Measure[] } | null;
  };
  signature: RowLayoutSignature;
  /** SemanticRecordCandidate.candidateIndex（anchorになった行のみ） */
  semanticCandidateIndexes: number[];
  /** RecordAnchorAssessment.assessmentIndex（参照のみ。templateのfeatureには使っていない） */
  recordAnchorAssessmentIndexes: number[];
  context: {
    rowsBefore: number;
    rowsAfter: number;
    /** この行より前（ページ上側）にある、金額列patternを持つ行の数 */
    rowsBeforeWithAmountPattern: number;
    /** 直前の行が金額列patternを持つか（先頭行はnull） */
    precedingRowHasAmountPattern: boolean | null;
    /** 階層候補として開いている間（後続で自分より深いindentが続く間）の行数 */
    descendantRowCount: number;
    descendantRowsWithAmountPattern: number;
    descendantFamilyCount: number;
    /** 後続の子孫の中に、自分と同じfamilyの行があるか */
    sameFamilyAmongDescendants: number;
    nextRowFamilyIndex: number | null;
    previousRowFamilyIndex: number | null;
    boundaryBefore: PageBoundaryKind[];
    boundaryAfter: PageBoundaryKind[];
    indentClusterSize: number;
    familySize: number;
    indentStableUnderSensitivity: boolean;
    familyStableUnderSensitivity: boolean;
  };
}

export interface IndentationCluster {
  clusterIndex: number;
  memberRowIndexes: number[];
  xRange: Measure[];
  stability: { stable: boolean; reasons: string[] };
}

export interface AmountColumnPatternObservation {
  patternIndex: number;
  groupCount: number;
  memberSemanticCandidateIndexes: number[];
  memberRowIndexes: number[];
  columnRightEdges: Measure[];
  /** 各列の右端のばらつき（max-min） */
  spread: number[];
  medianGroupWidths: number[];
  supportCount: number;
  stability: { stable: boolean; reasons: string[] };
}

export interface PageRowFamily {
  familyIndex: number;
  key: { indentationClusterIndex: number; amountColumnPatternIndex: number | null; hasRuleTokens: boolean };
  memberRowIndexes: number[];
  supportCount: number;
  isolated: boolean;
  ambiguousMemberRowIndexes: number[];
  stability: { stable: boolean; reasons: string[] };
}

export interface PageSequenceObservation {
  rowIndex: number;
  previousFamilyIndex: number | null;
  currentFamilyIndex: number;
  nextFamilyIndex: number | null;
  verticalGap: number | null;
  baselineDistance: number | null;
  rowPitchRatio: number | null;
}

export type PageBoundaryKind =
  | 'indentation_cluster_change'
  | 'row_family_change'
  | 'amount_pattern_appears'
  | 'amount_pattern_disappears'
  | 'amount_pattern_changes'
  | 'vertical_gap_increase'
  | 'font_size_pattern_change'
  | 'region_occupancy_change';

export interface PageStructureBoundaryCandidate {
  boundaryIndex: number;
  /** 前後の行の rowIndex（観測順） */
  beforeRowIndex: number;
  afterRowIndex: number;
  evidenceKinds: PageBoundaryKind[];
  measurements: { rowPitchRatio: number | null; verticalGap: number };
  stability: { stable: boolean; reasons: string[] };
}

export interface HierarchyRelationCandidate {
  relationIndex: number;
  /** より浅い位置にあり、後続の行が開いている間にある行（親/子というsemantic名は付けない） */
  sourceRowIndex: number;
  targetRowIndex: number;
  evidence: { kind: 'source_precedes_target' | 'target_more_indented' | 'target_family_repeats_after_source' | 'amount_pattern_in_source_descendants'; value: number | boolean }[];
  /** 開いているsourceのうち、targetに近い順の位置（0=直近）。選択ではなく説明用 */
  openStackDepth: number;
  competingRelationIndexes: number[];
  stability: { stable: boolean; reasons: string[] };
}

export interface PageTemplateResult {
  parameters: PageTemplateOptions & {
    pageWidth: number;
    pageHeight: number;
    referenceFontSize: number;
    medianRowPitch: number;
    alignmentTolerance: number;
    maxIndentStep: number;
    classificationUsed: false;
    recordAnchorClassificationUsedAsFeature: false;
    textUsed: 'only the rule-token character class (box-drawing characters)';
    startXRule: 'left edge of the first segment of the first physical row, skipping a first segment made of a single short token (width <= 3.5 x fontSize)';
  };
  rowObservations: PageRowObservation[];
  indentationClusters: IndentationCluster[];
  amountColumnPatterns: AmountColumnPatternObservation[];
  rowFamilies: PageRowFamily[];
  sequenceObservations: PageSequenceObservation[];
  boundaryCandidates: PageStructureBoundaryCandidate[];
  hierarchyRelationCandidates: HierarchyRelationCandidate[];
  diagnostics: {
    rowCount: number;
    indentationClusterCount: number;
    amountPatternCount: number;
    rowFamilyCount: number;
    isolatedFamilyCount: number;
    boundaryCandidateCount: number;
    hierarchyRelationCount: number;
    hierarchyRowsWithMultiplePlausibleParents: number;
    unstableObservations: { indentationClusters: number; amountPatterns: number; rowFamilies: number; boundaries: number; hierarchyRelations: number };
    boundaryEvidenceDistribution: Record<string, number>;
    indentJumpsNotTreatedAsHierarchy: number;
    sensitivity: { scale: number; indentationClusterCount: number; rowFamilyCount: number; boundaryCandidateCount: number; hierarchyRelationCount: number; amountPatternCount: number; changed: { indentationClusters: number; rowFamilies: number; boundaryCandidates: number; hierarchyRelations: number; amountPatterns: number } }[];
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const isBlank = (t: SourceToken): boolean => t.rawText.trim() === '';
const isRuleToken = (t: SourceToken): boolean => /^[─-╿\s]+$/.test(t.rawText) && /[─-╿]/.test(t.rawText);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function anchoredBins(items: { id: number; value: number }[], tol: number): number[][] {
  const sorted = [...items].sort((a, b) => a.value - b.value || a.id - b.id);
  const bins: { start: number; ids: number[] }[] = [];
  for (const it of sorted) {
    const last = bins[bins.length - 1];
    if (last && it.value - last.start <= tol + 1e-9) last.ids.push(it.id);
    else bins.push({ start: it.value, ids: [it.id] });
  }
  return bins.map(b => [...b.ids].sort((a, b2) => a - b2));
}

interface RowBase {
  logical: LogicalRowCandidate;
  tokenIdx: number[];
  bbox: SourceTokenBBox;
  startX: number;
  leftEdgeX: number;
  baselineY: number;
  segmentCount: number;
  fontStats: { min: number; median: number; max: number };
  regionIndexes: number[];
  hasRule: boolean;
  candidate: SemanticRecordCandidate | null;
}

/** 1 scale分の計算結果（感度分析のため scale ごとに実行する） */
interface Pass {
  clusterOf: number[];
  clusters: number[][];
  patterns: { groupCount: number; members: number[]; edges: number[][] }[];
  patternOf: (number | null)[];
  familyOf: number[];
  families: number[][];
  familyKeys: string[];
  boundaries: Map<string, PageBoundaryKind[]>;
  hierarchy: Map<string, { source: number; target: number; depth: number }>;
  indentJumps: number;
}

export function observePageTemplate(
  tokens: SourceToken[],
  page: PageMeta,
  geometry: TableGeometryResult,
  logical: LogicalRowResult,
  spatial: SpatialRegionResult,
  semantic: SemanticRecordResult,
  recordAnchor: RecordAnchorResult,
  options: PageTemplateOptions = DEFAULT_PAGE_TEMPLATE_OPTIONS,
): PageTemplateResult {
  const ref = geometry.parameters.rowClustering.referenceFontSize;
  const physical = new Map(geometry.physicalRows.map(r => [r.rowIndex, r]));
  const regionOfToken = new Map<number, number[]>();
  for (const r of spatial.regions) for (const t of r.tokenIndexes) regionOfToken.set(t, [...(regionOfToken.get(t) ?? []), r.regionIndex]);
  const candidateOfRow = new Map<number, SemanticRecordCandidate>();
  for (const c of semantic.semanticRecordCandidates) for (const l of c.anchorLogicalRowIndexes) candidateOfRow.set(l, c);

  // ---- 行の基礎観測（scaleに依存しない）----
  const bases: RowBase[] = logical.logicalRowCandidates
    .map(l => {
      const tokenIdx = l.rawTokenIndexes.filter(i => !isBlank(tokens[i]));
      const first = l.physicalRowIndexes[0];
      const segs = l.segments.filter(s => s.physicalRowIndex === first && s.rawTokenIndexes.some(i => !isBlank(tokens[i])));
      let seg = segs[0];
      if (segs.length > 1) {
        const nb = segs[0].visualTokenIndexes.filter(i => !isBlank(tokens[i]));
        if (nb.length === 1 && tokens[nb[0]].width <= 3.5 * ref) seg = segs[1];
      }
      const sizes = tokenIdx.map(i => tokens[i].fontSize);
      return {
        logical: l,
        tokenIdx,
        bbox: l.bbox,
        startX: (seg ?? segs[0])?.bbox.xMin ?? l.bbox.xMin,
        leftEdgeX: segs[0]?.bbox.xMin ?? l.bbox.xMin,
        baselineY: physical.get(first)!.baselineY,
        segmentCount: segs.length,
        fontStats: { min: Math.min(...sizes), median: median(sizes), max: Math.max(...sizes) },
        regionIndexes: [...new Set(tokenIdx.flatMap(i => regionOfToken.get(i) ?? []))].sort((a, b) => a - b),
        hasRule: tokenIdx.some(i => isRuleToken(tokens[i])),
        candidate: candidateOfRow.get(l.logicalRowIndex) ?? null,
      };
    })
    .filter(b => b.tokenIdx.length > 0)
    .sort((a, b) => a.bbox.yMin - b.bbox.yMin || a.logical.logicalRowIndex - b.logical.logicalRowIndex);
  const n = bases.length;
  const pitches = bases.slice(1).map((b, i) => b.baselineY - bases[i].baselineY).filter(d => d > 0);
  const medianRowPitch = round3(median(pitches));
  const measure = (v: number, dim: number): Measure => ({ value: round3(v), normalized: round3(v / dim) });

  function compute(scale: number): Pass {
    const tol = options.alignmentToleranceFactor * ref * scale;
    const maxStep = options.maxIndentStepFactor * ref * scale;
    // indentation clusters
    const clusters = anchoredBins(bases.map((b, id) => ({ id, value: b.startX })), tol);
    const clusterOf = new Array<number>(n).fill(-1);
    clusters.forEach((c, ci) => c.forEach(id => (clusterOf[id] = ci)));
    // amount column patterns（semantic candidateの金額group。groupCountごとに、右端の並びが揃うものを貪欲にまとめる）
    const withGroups = bases.map((b, id) => ({ id, edges: b.candidate && b.candidate.amountGroups.length > 0 ? b.candidate.amountGroups.map(g => g.bbox.xMax) : null })).filter(x => x.edges);
    const patterns: Pass['patterns'] = [];
    const patternOf: (number | null)[] = new Array(n).fill(null);
    for (const x of withGroups) {
      let hit = patterns.findIndex(p => p.groupCount === x.edges!.length && p.edges[0].every((e, k) => Math.abs(e - x.edges![k]) <= tol));
      if (hit < 0) {
        patterns.push({ groupCount: x.edges!.length, members: [], edges: [] });
        hit = patterns.length - 1;
      }
      patterns[hit].members.push(x.id);
      patterns[hit].edges.push(x.edges!);
      patternOf[x.id] = hit;
    }
    // row families: (indent cluster, amount pattern, rule presence)
    const familyKeys = bases.map((b, i) => `${clusterOf[i]}|${patternOf[i] ?? 'none'}|${b.hasRule ? 'rule' : 'plain'}`);
    const keyOrder = [...new Set(familyKeys)];
    const families = keyOrder.map(k => familyKeys.map((fk, i) => (fk === k ? i : -1)).filter(i => i >= 0));
    const familyOf = familyKeys.map(k => keyOrder.indexOf(k));
    // boundaries between consecutive rows
    const boundaries = new Map<string, PageBoundaryKind[]>();
    for (let i = 1; i < n; i++) {
      const kinds: PageBoundaryKind[] = [];
      if (clusterOf[i] !== clusterOf[i - 1]) kinds.push('indentation_cluster_change');
      if (familyOf[i] !== familyOf[i - 1]) kinds.push('row_family_change');
      const a = patternOf[i - 1];
      const b = patternOf[i];
      if (a === null && b !== null) kinds.push('amount_pattern_appears');
      else if (a !== null && b === null) kinds.push('amount_pattern_disappears');
      else if (a !== null && b !== null && a !== b) kinds.push('amount_pattern_changes');
      const ratio = (bases[i].baselineY - bases[i - 1].baselineY) / medianRowPitch;
      if (medianRowPitch > 0 && ratio >= options.verticalGapPitchFactor * scale) kinds.push('vertical_gap_increase');
      if (Math.abs(bases[i].fontStats.median - bases[i - 1].fontStats.median) > tol * 0.1) kinds.push('font_size_pattern_change');
      if (bases[i].regionIndexes.join(',') !== bases[i - 1].regionIndexes.join(',')) kinds.push('region_occupancy_change');
      if (kinds.length > 0) boundaries.set(`${i - 1}>${i}`, kinds);
    }
    // hierarchy: 開いている行（後続でより深いindentが続く間）の全てを候補として保持する
    const hierarchy: Pass['hierarchy'] = new Map();
    let jumps = 0;
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      while (stack.length > 0 && bases[stack[stack.length - 1]].startX >= bases[i].startX - tol) stack.pop();
      if (stack.length > 0) {
        const nearest = stack[stack.length - 1];
        if (bases[i].startX - bases[nearest].startX <= maxStep) {
          // 開いている行のうち、indent差が1段の上限以内のものだけを候補にする（遠い祖先まで推移的に結ばない）
          stack
            .slice()
            .reverse()
            .forEach((src, depth) => {
              if (bases[i].startX - bases[src].startX <= maxStep) hierarchy.set(`${src}>${i}`, { source: src, target: i, depth });
            });
        } else {
          // indentの跳びは列の違い（階層ではない）。この行は新しい列の起点になり、以前の開いている行とは結ばない
          jumps++;
          stack.length = 0;
        }
      }
      stack.push(i);
    }
    return { clusterOf, clusters, patterns, patternOf, familyOf, families, familyKeys, boundaries, hierarchy, indentJumps: jumps };
  }

  const base = compute(1);
  const others = options.sensitivityScales.map(scale => ({ scale, pass: compute(scale) }));
  const sig = (members: number[]) => members.join(',');
  const clusterSig = (p: Pass, i: number) => sig(p.clusters[p.clusterOf[i]]);
  const familySig = (p: Pass, i: number) => sig(p.families[p.familyOf[i]]);

  // ---- 階層の文脈 ----
  const descendants = new Map<number, number[]>();
  for (const h of base.hierarchy.values()) descendants.set(h.source, [...(descendants.get(h.source) ?? []), h.target]);

  // ---- 出力の組み立て ----
  const rowObservations: PageRowObservation[] = bases.map((b, i) => {
    const c = b.candidate;
    const groups = c && c.amountGroups.length > 0 ? c.amountGroups : null;
    const widthRatio = (b.bbox.xMax - b.bbox.xMin) / page.width;
    const signature: RowLayoutSignature = {
      indentationClusterIndex: base.clusterOf[i],
      segmentCountBucket: Math.min(b.segmentCount, 4),
      hasThreeAmountGroups: c?.amountGroups.length === 3,
      amountColumnPatternIndex: base.patternOf[i],
      hasSignObservation: c?.amountGroups.some(g => g.signObservation !== null) ?? false,
      spansMultipleRegions: b.regionIndexes.length > 1,
      hasRuleTokens: b.hasRule,
      relativeWidthBucket: Math.floor(widthRatio / options.widthBucketSize),
      fontSizeBucket: Math.round(b.fontStats.median / ref),
    };
    const desc = descendants.get(i) ?? [];
    const kindsBefore = base.boundaries.get(`${i - 1}>${i}`) ?? [];
    const kindsAfter = base.boundaries.get(`${i}>${i + 1}`) ?? [];
    const indentStable = others.every(o => clusterSig(o.pass, i) === clusterSig(base, i));
    const familyStable = others.every(o => familySig(o.pass, i) === familySig(base, i));
    return {
      rowIndex: i,
      logicalRowIndex: b.logical.logicalRowIndex,
      physicalRowIndexes: b.logical.physicalRowIndexes,
      bbox: b.bbox,
      normalized: { xMin: round3(b.bbox.xMin / page.width), xMax: round3(b.bbox.xMax / page.width), yMin: round3(b.bbox.yMin / page.height), yMax: round3(b.bbox.yMax / page.height), width: round3(widthRatio) },
      layoutFeatures: {
        segmentCount: b.segmentCount,
        tokenCount: b.tokenIdx.length,
        fontSizeStats: { min: round3(b.fontStats.min), median: round3(b.fontStats.median), max: round3(b.fontStats.max) },
        startX: measure(b.startX, page.width),
        leftEdgeX: measure(b.leftEdgeX, page.width),
        regionIndexes: b.regionIndexes,
        hasRuleTokens: b.hasRule,
        amountGroups: groups ? { count: groups.length, rightEdges: groups.map(g => measure(g.bbox.xMax, page.width)) } : null,
      },
      signature,
      semanticCandidateIndexes: c ? [c.candidateIndex] : [],
      recordAnchorAssessmentIndexes: c ? recordAnchor.anchorAssessments.filter(a => a.semanticCandidateIndex === c.candidateIndex).map(a => a.assessmentIndex) : [],
      context: {
        rowsBefore: i,
        rowsAfter: n - 1 - i,
        rowsBeforeWithAmountPattern: base.patternOf.slice(0, i).filter(p => p !== null).length,
        precedingRowHasAmountPattern: i > 0 ? base.patternOf[i - 1] !== null : null,
        descendantRowCount: desc.length,
        descendantRowsWithAmountPattern: desc.filter(d => base.patternOf[d] !== null).length,
        descendantFamilyCount: new Set(desc.map(d => base.familyOf[d])).size,
        sameFamilyAmongDescendants: desc.filter(d => base.familyOf[d] === base.familyOf[i]).length,
        nextRowFamilyIndex: i + 1 < n ? base.familyOf[i + 1] : null,
        previousRowFamilyIndex: i > 0 ? base.familyOf[i - 1] : null,
        boundaryBefore: kindsBefore,
        boundaryAfter: kindsAfter,
        indentClusterSize: base.clusters[base.clusterOf[i]].length,
        familySize: base.families[base.familyOf[i]].length,
        indentStableUnderSensitivity: indentStable,
        familyStableUnderSensitivity: familyStable,
      },
    };
  });

  const indentationClusters: IndentationCluster[] = base.clusters.map((members, clusterIndex) => {
    const xs = members.map(m => bases[m].startX);
    const reasons = others.filter(o => o.pass.clusters.every(c => sig(c) !== sig(members))).map(o => `membership_changes_at_x${o.scale}`);
    return { clusterIndex, memberRowIndexes: members, xRange: [measure(Math.min(...xs), page.width), measure(Math.max(...xs), page.width)], stability: { stable: reasons.length === 0, reasons } };
  });

  const amountColumnPatterns: AmountColumnPatternObservation[] = base.patterns.map((p, patternIndex) => {
    const cols = Array.from({ length: p.groupCount }, (_, k) => p.edges.map(e => e[k]));
    const widths = Array.from({ length: p.groupCount }, (_, k) => median(p.members.map(m => bases[m].candidate!.amountGroups[k].bbox.xMax - bases[m].candidate!.amountGroups[k].bbox.xMin)));
    const reasons = others.filter(o => !o.pass.patterns.some(q => sig(q.members) === sig(p.members))).map(o => `membership_changes_at_x${o.scale}`);
    return {
      patternIndex,
      groupCount: p.groupCount,
      memberSemanticCandidateIndexes: p.members.map(m => bases[m].candidate!.candidateIndex),
      memberRowIndexes: p.members,
      columnRightEdges: cols.map(c => measure(median(c), page.width)),
      spread: cols.map(c => round3(Math.max(...c) - Math.min(...c))),
      medianGroupWidths: widths.map(round3),
      supportCount: p.members.length,
      stability: { stable: reasons.length === 0, reasons },
    };
  });

  const rowFamilies: PageRowFamily[] = base.families.map((members, familyIndex) => {
    const i0 = members[0];
    const ambiguous = members.filter(m => !rowObservations[m].context.familyStableUnderSensitivity);
    const reasons = others.filter(o => !o.pass.families.some(f => sig(f) === sig(members))).map(o => `membership_changes_at_x${o.scale}`);
    return {
      familyIndex,
      key: { indentationClusterIndex: base.clusterOf[i0], amountColumnPatternIndex: base.patternOf[i0], hasRuleTokens: bases[i0].hasRule },
      memberRowIndexes: members,
      supportCount: members.length,
      isolated: members.length === 1,
      ambiguousMemberRowIndexes: ambiguous,
      stability: { stable: reasons.length === 0, reasons },
    };
  });

  const sequenceObservations: PageSequenceObservation[] = bases.map((b, i) => ({
    rowIndex: i,
    previousFamilyIndex: i > 0 ? base.familyOf[i - 1] : null,
    currentFamilyIndex: base.familyOf[i],
    nextFamilyIndex: i + 1 < n ? base.familyOf[i + 1] : null,
    verticalGap: i > 0 ? round3(b.bbox.yMin - bases[i - 1].bbox.yMax) : null,
    baselineDistance: i > 0 ? round3(b.baselineY - bases[i - 1].baselineY) : null,
    rowPitchRatio: i > 0 && medianRowPitch > 0 ? round3((b.baselineY - bases[i - 1].baselineY) / medianRowPitch) : null,
  }));

  const boundaryCandidates: PageStructureBoundaryCandidate[] = [...base.boundaries.entries()]
    .sort((a, b) => Number(a[0].split('>')[0]) - Number(b[0].split('>')[0]))
    .map(([key, kinds], boundaryIndex) => {
      const [bi, ai] = key.split('>').map(Number);
      const reasons = others.filter(o => (o.pass.boundaries.get(key) ?? []).join(',') !== kinds.join(',')).map(o => `evidence_changes_at_x${o.scale}`);
      return {
        boundaryIndex,
        beforeRowIndex: bi,
        afterRowIndex: ai,
        evidenceKinds: kinds,
        measurements: { rowPitchRatio: sequenceObservations[ai].rowPitchRatio, verticalGap: sequenceObservations[ai].verticalGap ?? 0 },
        stability: { stable: reasons.length === 0, reasons },
      };
    });

  const hierarchyRelationCandidates: HierarchyRelationCandidate[] = [...base.hierarchy.values()]
    .sort((a, b) => a.target - b.target || b.depth - a.depth)
    .map((h, relationIndex) => ({ h, relationIndex }))
    .map(({ h, relationIndex }) => {
      const reasons = others.filter(o => !o.pass.hierarchy.has(`${h.source}>${h.target}`)).map(o => `candidate_disappears_at_x${o.scale}`);
      const desc = descendants.get(h.source) ?? [];
      return {
        relationIndex,
        sourceRowIndex: h.source,
        targetRowIndex: h.target,
        evidence: [
          { kind: 'source_precedes_target' as const, value: true },
          { kind: 'target_more_indented' as const, value: round3(bases[h.target].startX - bases[h.source].startX) },
          { kind: 'target_family_repeats_after_source' as const, value: desc.filter(d => base.familyOf[d] === base.familyOf[h.target]).length },
          { kind: 'amount_pattern_in_source_descendants' as const, value: desc.filter(d => base.patternOf[d] !== null).length },
        ],
        openStackDepth: h.depth,
        competingRelationIndexes: [] as number[],
        stability: { stable: reasons.length === 0, reasons },
      };
    });
  // 同じtargetに複数の妥当なsourceがあれば全て残し、競合として記録する（winnerを選ばない）
  const byTarget = new Map<number, HierarchyRelationCandidate[]>();
  for (const r of hierarchyRelationCandidates) byTarget.set(r.targetRowIndex, [...(byTarget.get(r.targetRowIndex) ?? []), r]);
  for (const rs of byTarget.values()) {
    if (rs.length < 2) continue;
    for (const r of rs) {
      r.competingRelationIndexes = rs.filter(x => x !== r).map(x => x.relationIndex);
      r.stability.reasons.push('multiple_plausible_parents');
      r.stability.stable = false;
    }
  }

  const changedBetween = <T,>(a: Map<string, T> | string[], b: Map<string, T> | string[], eq: (x: T, y: T) => boolean = (x, y) => x === y): number => {
    if (Array.isArray(a) && Array.isArray(b)) return a.filter(x => !b.includes(x)).length + b.filter(x => !a.includes(x)).length;
    const ma = a as Map<string, T>;
    const mb = b as Map<string, T>;
    return [...ma.keys()].filter(k => !mb.has(k) || !eq(ma.get(k)!, mb.get(k)!)).length + [...mb.keys()].filter(k => !ma.has(k)).length;
  };
  const sensitivity = others.map(o => ({
    scale: o.scale,
    indentationClusterCount: o.pass.clusters.length,
    rowFamilyCount: o.pass.families.length,
    boundaryCandidateCount: o.pass.boundaries.size,
    hierarchyRelationCount: o.pass.hierarchy.size,
    amountPatternCount: o.pass.patterns.length,
    changed: {
      indentationClusters: rowObservations.filter((_, i) => clusterSig(o.pass, i) !== clusterSig(base, i)).length,
      rowFamilies: rowObservations.filter((_, i) => familySig(o.pass, i) !== familySig(base, i)).length,
      boundaryCandidates: changedBetween(new Map([...base.boundaries].map(([k, v]) => [k, v.join(',')])), new Map([...o.pass.boundaries].map(([k, v]) => [k, v.join(',')]))),
      hierarchyRelations: changedBetween(base.hierarchy, o.pass.hierarchy, (x, y) => x.depth === y.depth),
      amountPatterns: base.patterns.filter(p => !o.pass.patterns.some(q => sig(q.members) === sig(p.members))).length,
    },
  }));

  const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  return {
    parameters: {
      ...options,
      pageWidth: page.width,
      pageHeight: page.height,
      referenceFontSize: ref,
      medianRowPitch,
      alignmentTolerance: round3(options.alignmentToleranceFactor * ref),
      maxIndentStep: round3(options.maxIndentStepFactor * ref),
      classificationUsed: false,
      recordAnchorClassificationUsedAsFeature: false,
      textUsed: 'only the rule-token character class (box-drawing characters)',
      startXRule: 'left edge of the first segment of the first physical row, skipping a first segment made of a single short token (width <= 3.5 x fontSize)',
    },
    rowObservations,
    indentationClusters,
    amountColumnPatterns,
    rowFamilies,
    sequenceObservations,
    boundaryCandidates,
    hierarchyRelationCandidates,
    diagnostics: {
      rowCount: n,
      indentationClusterCount: indentationClusters.length,
      amountPatternCount: amountColumnPatterns.length,
      rowFamilyCount: rowFamilies.length,
      isolatedFamilyCount: rowFamilies.filter(f => f.isolated).length,
      boundaryCandidateCount: boundaryCandidates.length,
      hierarchyRelationCount: hierarchyRelationCandidates.length,
      hierarchyRowsWithMultiplePlausibleParents: [...byTarget.values()].filter(rs => rs.length >= 2).length,
      unstableObservations: {
        indentationClusters: indentationClusters.filter(c => !c.stability.stable).length,
        amountPatterns: amountColumnPatterns.filter(p => !p.stability.stable).length,
        rowFamilies: rowFamilies.filter(f => !f.stability.stable).length,
        boundaries: boundaryCandidates.filter(b => !b.stability.stable).length,
        hierarchyRelations: hierarchyRelationCandidates.filter(r => !r.stability.stable).length,
      },
      boundaryEvidenceDistribution: count(boundaryCandidates.flatMap(b => b.evidenceKinds)),
      indentJumpsNotTreatedAsHierarchy: base.indentJumps,
      sensitivity,
    },
  };
}
