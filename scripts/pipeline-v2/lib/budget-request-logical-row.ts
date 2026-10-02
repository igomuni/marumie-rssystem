/**
 * LogicalRowResolver PoC: PhysicalRowCandidate[] → LogicalRowCandidate[]（論理行「候補」の観測と可逆な解決）。
 *
 * LogicalRowCandidate は「複数の PhysicalRowCandidate が、ページ上の配置から見て同一の論理行候補を構成している
 * 可能性」を表す中間的・可逆な観測結果であり、予算明細のsemantic record（LogicalDetailRecord）ではない。
 * 要求番号・事項・金額・備考などの意味、数値parse、符号（△▲-）、blankの扱い、Core/Auxiliary関連付けは行わない。
 *
 * ## 不変条件（source fidelity > reversibility > ambiguity保持 > geometry観測 > 意味解釈）
 * - SourceToken・PhysicalRowCandidate・TableGeometry結果は読み取るだけ。書き換えない。
 * - すべてのcandidate/segmentは `SourceToken.index` と `physicalRowIndex` の参照で表し、文字列を結合しない。
 *   raw order（rawTokenIndexes）とvisual-x order（visualTokenIndexes）を区別して保持する（金額chunkの
 *   `916 → 599, → 234,` を `234,599,916` にしない）。
 * - 統合は可逆: candidateは必ず元の physicalRowIndexes を持つ。誤統合の疑いは merge せず `ambiguous` として残す。
 *   false positive merge より ambiguous を優先する。
 * - しきい値は相対値（ページのfontSize中央値×係数）で、すべて出力のparametersに残す。PDF別・Golden Sample別の
 *   座標hard-code（x<460等）はない。
 *
 * ## 水平分割（HorizontalSegment）: 純粋なgeometry
 * 1つのphysical row内のtokenを visual-x順に見て、隣り合うtoken間のx-gap（次のxMin − ここまでのxMax最大値）が
 * `gapFactor × referenceFontSize` を超えたところで区切る。同じphysical row（同じbaseline）に左右の独立構造が
 * 同居しても、1つの文字列にせず別segmentとして保持する。segmentに意味名（matter/amount/remark）は付けない。
 * gapが小さい左右（例: 金額の右隣の `（要求要旨）` が1文字分しか離れていない）は区切れない（既知の限界）。
 *
 * ## 継続候補（continuation）: 隣り合うphysical row A→B の幾何条件
 * 1. 縦: baseline差 dy が [verticalGapFactorMin, verticalGapFactorMax] × referenceFontSize（折り返し行の行間）
 * 2. 横: Bのすべてのsegmentについて、そのsegmentの開始xが、candidateに既に含まれるphysical rowのtokenのxMin
 *    （=開始位置）と alignmentToleranceFactor × referenceFontSize 以内で揃う
 * 3. 罫線文字（`│` `─` 等のみのtoken）を含むphysical rowは、折り返し行ではなく表のグリッドの一部の可能性が高いため、
 *    縦が範囲内でも merge しない（`ambiguous`、reason=ruled_grid_row）。
 * 縦が範囲内で横もすべて揃えば `continuation_by_geometry`（merge）。縦が範囲内だが一部のsegmentが揃わなければ
 * `ambiguous`（merge せず、揃った/揃わないsegmentと計測値を evidence に残す）。縦が範囲外なら独立した行
 * （`same_physical_row`）。ColumnBandObservationは判定には使わず、segment開始位置が繰り返し配置帯に載るかを
 * 補助的なevidence（columnBandEvidence）として記録するだけ。
 */
import { baselineTopOf, type PhysicalRowCandidate, type TableGeometryResult, type ColumnBandObservation } from './budget-request-table-geometry';
import type { PageMeta, SourceToken, SourceTokenBBox } from './budget-request-source-token';

export const LOGICAL_ROW_SCHEMA = 'budget-request-logical-row-poc/v1';

export interface LogicalRowOptions {
  horizontalSegmentation: { gapFactor: number };
  continuation: {
    verticalGapFactorMin: number;
    verticalGapFactorMax: number;
    alignmentToleranceFactor: number;
  };
}

export const DEFAULT_LOGICAL_ROW_OPTIONS: LogicalRowOptions = {
  horizontalSegmentation: { gapFactor: 2.5 },
  continuation: { verticalGapFactorMin: 0.75, verticalGapFactorMax: 1.5, alignmentToleranceFactor: 0.25 },
};

export interface HorizontalSegment {
  segmentIndex: number; // physical row内の順序（左から）
  physicalRowIndex: number;
  /** SourceToken.index（raw order = index昇順） */
  rawTokenIndexes: number[];
  /** 同じtokenのvisual-x order（bbox.xMin昇順） */
  visualTokenIndexes: number[];
  bbox: SourceTokenBBox;
  /** 左隣のsegmentとのx-gap（pt）。先頭segmentは無し */
  gapBefore?: number;
  /** 右隣のsegmentとのx-gap（pt）。末尾segmentは無し */
  gapAfter?: number;
}

export interface SegmentAlignment {
  segmentIndex: number;
  /** segment開始x（bbox.xMin） */
  xStart: number;
  /** 揃ったtokenのindexと差（揃わなければundefined） */
  alignedToTokenIndex?: number;
  alignedToPhysicalRowIndex?: number;
  dx?: number;
  /** 補助evidence: segment開始xが載る左端揃いのColumnBandのbandIndex（判定には使わない） */
  columnBandEvidence?: number | null;
}

export type ResolutionKind = 'same_physical_row' | 'continuation_by_geometry' | 'ambiguous';

export interface ResolutionEvidence {
  /** 直前のphysical rowとの縦の計測（先頭のrowは無し） */
  vertical?: { previousPhysicalRowIndex: number; dy: number; dyFactor: number; withinContinuationRange: boolean };
  /** 縦が範囲内のとき、Bの各segmentの横の揃い */
  alignment?: SegmentAlignment[];
  /** ambiguousの理由 */
  reason?: string;
  /** ambiguousのとき、継続の可能性があるcandidate（mergeしていない） */
  possibleContinuationOfLogicalRow?: number;
}

export interface LogicalRowCandidate {
  logicalRowIndex: number;
  /** 元のPhysicalRowCandidate.rowIndex（昇順）。必ず辿れる */
  physicalRowIndexes: number[];
  /** 構成SourceToken.index（昇順 = raw order） */
  rawTokenIndexes: number[];
  /** physical row順に、各rowのvisual-x order（rowVisualTokenIndexesの連結。物理行をまたいだx順ではない） */
  visualTokenIndexes: number[];
  bbox: SourceTokenBBox;
  segments: HorizontalSegment[];
  resolution: { kind: ResolutionKind; evidence: ResolutionEvidence };
}

export interface ChainingRowDiagnostic {
  rowIndex: number;
  baselineSpan: number;
  tableGeometryTolerance: number;
  exceedsTolerance: boolean;
  /** span両端のtoken（index・baseline） */
  topToken: { index: number; baselineY: number };
  bottomToken: { index: number; baselineY: number };
}

export interface LogicalRowResult {
  parameters: {
    horizontalSegmentation: LogicalRowOptions['horizontalSegmentation'] & { reference: 'median fontSize of non-whitespace tokens on the page'; referenceFontSize: number; gap: number; gapDefinition: 'next token xMin - max xMax so far, in visual-x order, within one physical row' };
    continuation: LogicalRowOptions['continuation'] & {
      verticalGapMin: number;
      verticalGapMax: number;
      alignmentTolerance: number;
      verticalGapDefinition: 'baseline difference between adjacent physical rows (top-left origin)';
      alignmentDefinition: 'segment start x vs xMin of any token already in the candidate';
      columnBandUsage: 'supporting evidence only (columnBandEvidence); not used for the decision';
    };
  };
  logicalRowCandidates: LogicalRowCandidate[];
  diagnostics: {
    tableGeometryChaining: { rowsExceedingTolerance: ChainingRowDiagnostic[]; maxBaselineSpan: number; tableGeometryTolerance: number };
    ambiguousContinuations: { logicalRowIndex: number; physicalRowIndex: number; previousPhysicalRowIndex: number; reason: string }[];
    segmentation: { segmentCount: number; rowsWithMultipleSegments: number; maxSegmentsInRow: number };
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const isBoxDrawingOnly = (t: SourceToken): boolean => /^[\u2500-\u257f\s]+$/.test(t.rawText) && /[\u2500-\u257f]/.test(t.rawText);

function unionBBox(boxes: SourceTokenBBox[]): SourceTokenBBox {
  return {
    xMin: round3(Math.min(...boxes.map(b => b.xMin))),
    yMin: round3(Math.min(...boxes.map(b => b.yMin))),
    xMax: round3(Math.max(...boxes.map(b => b.xMax))),
    yMax: round3(Math.max(...boxes.map(b => b.yMax))),
  };
}

/** 1つのphysical rowをvisual-x順のx-gapで水平に分割する（意味なし。tokenは参照のみ） */
export function segmentPhysicalRow(
  row: PhysicalRowCandidate,
  tokens: SourceToken[],
  referenceFontSize: number,
  gapFactor: number = DEFAULT_LOGICAL_ROW_OPTIONS.horizontalSegmentation.gapFactor,
): HorizontalSegment[] {
  const gapLimit = gapFactor * referenceFontSize;
  const groups: { visual: number[]; gapBefore?: number }[] = [];
  let maxX = -Infinity;
  for (const idx of row.visualTokenIndexes) {
    const t = tokens[idx];
    const gap = t.bbox.xMin - maxX;
    if (groups.length === 0 || gap > gapLimit) groups.push({ visual: [], ...(groups.length > 0 ? { gapBefore: round3(gap) } : {}) });
    groups[groups.length - 1].visual.push(idx);
    maxX = Math.max(maxX, t.bbox.xMax);
  }
  return groups.map((g, segmentIndex) => ({
    segmentIndex,
    physicalRowIndex: row.rowIndex,
    rawTokenIndexes: [...g.visual].sort((a, b) => a - b),
    visualTokenIndexes: g.visual,
    bbox: unionBBox(g.visual.map(i => tokens[i].bbox)),
    ...(g.gapBefore !== undefined ? { gapBefore: g.gapBefore } : {}),
    ...(groups[segmentIndex + 1]?.gapBefore !== undefined ? { gapAfter: groups[segmentIndex + 1].gapBefore } : {}),
  }));
}

/** physical row内のbaseline span（TableGeometryのsingle-linkage chainingの実害診断） */
export function baselineSpanOf(row: PhysicalRowCandidate, tokens: SourceToken[], meta: PageMeta): ChainingRowDiagnostic['topToken'][] {
  const ys = row.rawTokenIndexes.map(i => ({ index: i, baselineY: round3(baselineTopOf(tokens[i], meta)) }));
  return [ys.reduce((a, b) => (b.baselineY < a.baselineY ? b : a)), ys.reduce((a, b) => (b.baselineY > a.baselineY ? b : a))];
}

function bandEvidence(xStart: number, bands: ColumnBandObservation[], tolerance: number): number | null {
  const hit = bands.find(b => b.edge === 'xMin' && xStart >= b.edgeRange[0] - tolerance && xStart <= b.edgeRange[1] + tolerance);
  return hit ? hit.bandIndex : null;
}

export function resolveLogicalRows(
  tokens: SourceToken[],
  meta: PageMeta,
  geometry: TableGeometryResult,
  options: LogicalRowOptions = DEFAULT_LOGICAL_ROW_OPTIONS,
): LogicalRowResult {
  const ref = geometry.parameters.rowClustering.referenceFontSize;
  const c = options.continuation;
  const dyMin = c.verticalGapFactorMin * ref;
  const dyMax = c.verticalGapFactorMax * ref;
  const alignTol = c.alignmentToleranceFactor * ref;
  const rows = geometry.physicalRows;
  const segmentsByRow = new Map(rows.map(r => [r.rowIndex, segmentPhysicalRow(r, tokens, ref, options.horizontalSegmentation.gapFactor)]));

  // candidateを行の並び（physical rowIndex昇順＝ページ上端から）に沿って構築する
  interface Draft {
    rows: PhysicalRowCandidate[];
    kind: ResolutionKind;
    evidence: ResolutionEvidence;
  }
  const drafts: Draft[] = [];
  for (const row of rows) {
    const prev = drafts.length > 0 ? drafts[drafts.length - 1] : undefined;
    const prevRow = prev ? prev.rows[prev.rows.length - 1] : undefined;
    if (!prev || !prevRow) {
      drafts.push({ rows: [row], kind: 'same_physical_row', evidence: {} });
      continue;
    }
    const dy = round3(row.baselineY - prevRow.baselineY);
    const withinRange = dy >= dyMin - 1e-9 && dy <= dyMax + 1e-9;
    const vertical = { previousPhysicalRowIndex: prevRow.rowIndex, dy, dyFactor: round3(dy / ref), withinContinuationRange: withinRange };
    if (!withinRange) {
      drafts.push({ rows: [row], kind: 'same_physical_row', evidence: { vertical } });
      continue;
    }
    // 罫線文字を含むrow（表のグリッド）は折り返しとはみなさず、mergeしない
    const ruled = [...prev.rows, row].some(r => r.rawTokenIndexes.some(i => isBoxDrawingOnly(tokens[i])));
    if (ruled) {
      drafts.push({
        rows: [row],
        kind: 'ambiguous',
        evidence: { vertical, reason: 'ruled_grid_row: the row or the preceding candidate contains box-drawing characters (table grid), not treated as a wrapped line', possibleContinuationOfLogicalRow: drafts.length - 1 },
      });
      continue;
    }
    // 縦は継続の範囲内 → 横: Bの各segment開始xが、candidateに含まれるrowのtoken開始xと揃うか
    const candidateTokenIdx = prev.rows.flatMap(r => r.rawTokenIndexes);
    const alignment: SegmentAlignment[] = segmentsByRow.get(row.rowIndex)!.map(seg => {
      const xStart = seg.bbox.xMin;
      let best: { index: number; dx: number } | undefined;
      for (const i of candidateTokenIdx) {
        const dx = xStart - tokens[i].bbox.xMin;
        if (Math.abs(dx) <= alignTol && (!best || Math.abs(dx) < Math.abs(best.dx))) best = { index: i, dx };
      }
      const owner = best ? prev.rows.find(r => r.rawTokenIndexes.includes(best!.index)) : undefined;
      return {
        segmentIndex: seg.segmentIndex,
        xStart,
        ...(best ? { alignedToTokenIndex: best.index, alignedToPhysicalRowIndex: owner?.rowIndex, dx: round3(best.dx) } : {}),
        columnBandEvidence: bandEvidence(xStart, geometry.columnBands, alignTol),
      };
    });
    const unaligned = alignment.filter(a => a.alignedToTokenIndex === undefined);
    if (unaligned.length === 0) {
      prev.rows.push(row);
      prev.kind = 'continuation_by_geometry';
      prev.evidence = { vertical, alignment };
    } else {
      drafts.push({
        rows: [row],
        kind: 'ambiguous',
        evidence: {
          vertical,
          alignment,
          reason: `vertical gap is within the continuation range but ${unaligned.length}/${alignment.length} segment start(s) are not aligned with any token start in the preceding candidate`,
          possibleContinuationOfLogicalRow: drafts.length - 1,
        },
      });
    }
  }

  const candidates: LogicalRowCandidate[] = drafts.map((d, logicalRowIndex) => {
    const segments = d.rows.flatMap(r => segmentsByRow.get(r.rowIndex)!);
    return {
      logicalRowIndex,
      physicalRowIndexes: d.rows.map(r => r.rowIndex),
      rawTokenIndexes: d.rows.flatMap(r => r.rawTokenIndexes).sort((a, b) => a - b),
      visualTokenIndexes: d.rows.flatMap(r => r.visualTokenIndexes),
      bbox: unionBBox(d.rows.map(r => r.bbox)),
      segments,
      resolution: { kind: d.kind, evidence: d.evidence },
    };
  });

  const tolerance = geometry.parameters.rowClustering.tolerance;
  const spans = rows.map(r => {
    const [top, bottom] = baselineSpanOf(r, tokens, meta);
    const baselineSpan = round3(bottom.baselineY - top.baselineY);
    return { rowIndex: r.rowIndex, baselineSpan, tableGeometryTolerance: tolerance, exceedsTolerance: baselineSpan > tolerance, topToken: top, bottomToken: bottom };
  });
  const allSegments = [...segmentsByRow.values()];
  return {
    parameters: {
      horizontalSegmentation: {
        ...options.horizontalSegmentation,
        reference: 'median fontSize of non-whitespace tokens on the page',
        referenceFontSize: ref,
        gap: round3(options.horizontalSegmentation.gapFactor * ref),
        gapDefinition: 'next token xMin - max xMax so far, in visual-x order, within one physical row',
      },
      continuation: {
        ...c,
        verticalGapMin: round3(dyMin),
        verticalGapMax: round3(dyMax),
        alignmentTolerance: round3(alignTol),
        verticalGapDefinition: 'baseline difference between adjacent physical rows (top-left origin)',
        alignmentDefinition: 'segment start x vs xMin of any token already in the candidate',
        columnBandUsage: 'supporting evidence only (columnBandEvidence); not used for the decision',
      },
    },
    logicalRowCandidates: candidates,
    diagnostics: {
      tableGeometryChaining: {
        rowsExceedingTolerance: spans.filter(s => s.exceedsTolerance),
        maxBaselineSpan: Math.max(0, ...spans.map(s => s.baselineSpan)),
        tableGeometryTolerance: tolerance,
      },
      ambiguousContinuations: candidates
        .filter(l => l.resolution.kind === 'ambiguous')
        .map(l => ({
          logicalRowIndex: l.logicalRowIndex,
          physicalRowIndex: l.physicalRowIndexes[0],
          previousPhysicalRowIndex: l.resolution.evidence.vertical!.previousPhysicalRowIndex,
          reason: l.resolution.evidence.reason!,
        })),
      segmentation: {
        segmentCount: allSegments.reduce((n, s) => n + s.length, 0),
        rowsWithMultipleSegments: allSegments.filter(s => s.length > 1).length,
        maxSegmentsInRow: Math.max(0, ...allSegments.map(s => s.length)),
      },
    },
  };
}
