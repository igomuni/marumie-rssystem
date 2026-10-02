/**
 * TableGeometry PoC: SourceToken[] → PhysicalRowCandidate[] / ColumnBandObservation[]（物理配置の観測のみ）。
 *
 * このモジュールは意味を決めない。PhysicalRowCandidate は「ページ上でほぼ同じ高さに配置された SourceToken の集合」、
 * ColumnBandObservation は「x座標の分布から観測された、縦方向に繰り返し現れる配置帯」であり、
 * 明細行・事項・金額・備考などの意味ラベルを付けない（regionType / columnName は持たない）。
 *
 * ## 不変条件
 * - 入力のSourceToken（rawText・index・bbox・transform等）は読み取るだけで、書き換えない。
 * - raw order（SourceToken.index = pdf.js text item順）を捨てない。`rawTokenIndexes` は index昇順（content stream順）、
 *   `visualTokenIndexes` は bbox.xMin昇順（同値はindex昇順）の観測上の順序。visual-x order は「正しい文字列順」ではない。
 *   両者が違う（例: 金額chunkが右から左のitemで並ぶ）という事実を `rawOrderMatchesVisualOrder` で観測できる。
 *   chunkを結合して金額文字列を作ることはしない。
 * - 空白のみ・空文字のtokenは行クラスタリングの入力から除外する（観測条件としてparametersに記録）が、
 *   SourceTokenからは削除しない。近い行があれば `whitespaceTokenIndexes` として参照する。
 * - 罫線文字（`│` 等のみのtoken）は行には含めるが、ColumnBand観測のノイズになるため帯の観測からは除外する
 *   （`ignoredForBands`。SourceTokenは残す）。
 * - PDF固有のルール・Golden Sampleの座標・人間確認値は使わない。しきい値は相対値（ページのfontSize中央値×係数）で、
 *   すべて出力JSONの parameters に残す。
 *
 * ## 行クラスタリング
 * 1次元gap法: 対象tokenを y代表値（yReference）で昇順に並べ、隣り合う代表値の差が tolerance を超えたら新しい行。
 * tolerance = toleranceFactor × （ページの非空白tokenのfontSize中央値）。xはrow判定に使わない。
 * y代表値は baseline / yMin / centerY を選べる（既定: baseline。理由は docs 7-3節の比較参照）。
 * baseline は transform[5]（PDF user space, 左下原点）を SourceToken と同じ左上原点へ揃えた値
 * （pageHeight − (f − view.y0)）。
 */
import type { PageMeta, SourceToken, SourceTokenBBox } from './budget-request-source-token';

export const TABLE_GEOMETRY_SCHEMA = 'budget-request-table-geometry-poc/v1';

export type YReference = 'baseline' | 'yMin' | 'centerY';

export interface RowClusteringOptions {
  yReference: YReference;
  /** tolerance = toleranceFactor × referenceFontSize */
  toleranceFactor: number;
}

export interface ColumnBandOptions {
  /** 端(xMin/xMax)の揃いとみなす幅 = edgeToleranceFactor × referenceFontSize */
  edgeToleranceFactor: number;
  /** 帯として観測する最小の物理行数（縦方向の繰り返し） */
  minRows: number;
}

export interface TableGeometryOptions {
  rowClustering: RowClusteringOptions;
  columnBands: ColumnBandOptions;
}

export const DEFAULT_GEOMETRY_OPTIONS: TableGeometryOptions = {
  rowClustering: { yReference: 'baseline', toleranceFactor: 0.25 },
  columnBands: { edgeToleranceFactor: 0.25, minRows: 3 },
};

export interface PhysicalRowCandidate {
  rowIndex: number;
  /** この行を構成する（クラスタリング対象の）SourceToken.index。content stream順（index昇順）= raw order */
  rawTokenIndexes: number[];
  /** 同じtokenを bbox.xMin 昇順（同値はindex昇順）に並べた観測上の順序（visual-x order。正しい文字列順ではない） */
  visualTokenIndexes: number[];
  /** raw order と visual-x order が一致するか（false=並びが違う。例: 金額chunkの逆順） */
  rawOrderMatchesVisualOrder: boolean;
  /** 近い行として参照した空白のみ・空文字のSourceToken.index（クラスタリングには使っていない） */
  whitespaceTokenIndexes: number[];
  /** クラスタリング対象tokenのbbox和集合（空白tokenは含めない） */
  bbox: SourceTokenBBox;
  /** 行のy代表値（メンバーの代表値の中央値。yReferenceに依存。左上原点） */
  repY: number;
  baselineY: number;
  centerY: number;
  /** rawTokenIndexes + whitespaceTokenIndexes */
  tokenCount: number;
  /** rawTokenIndexes の数（空白のみ・空文字を除く） */
  nonWhitespaceTokenCount: number;
}

export interface ColumnBandObservation {
  bandIndex: number;
  /** 何の端の揃いとして観測したか（xMin=左端揃い / xMax=右端揃い）。意味ではなく幾何の種別 */
  edge: 'xMin' | 'xMax';
  /** 揃いの端の値の範囲 */
  edgeRange: [number, number];
  /** 帯に含まれるtokenのbbox x範囲 */
  xMin: number;
  xMax: number;
  tokenCount: number;
  /** 帯のtokenが属する物理行の数 */
  rowCount: number;
  tokenIndexes: number[];
}

export interface TableGeometryResult {
  parameters: {
    rowClustering: RowClusteringOptions & {
      algorithm: 'gap-1d (sorted y-reference; new row when gap > tolerance)';
      referenceFontSize: number;
      referenceFontSizeBasis: 'median fontSize of non-whitespace tokens on the page';
      tolerance: number;
      excludedFromClustering: 'tokens with rawText.trim() === "" (empty or whitespace-only); kept in SourceToken, referenced as whitespaceTokenIndexes when within tolerance of a row';
      xUsedForRowMembership: false;
    };
    columnBands: ColumnBandOptions & {
      algorithm: 'edge clustering (bins anchored at the smallest edge, width <= edgeTolerance); keep bins with rowCount >= minRows';
      edgeTolerance: number;
      ignoredForBands: 'tokens that are empty/whitespace-only, or consist only of box-drawing characters (U+2500-257F)';
      bandsMayOverlap: true;
    };
  };
  sourceTokenCount: number;
  /** クラスタリング対象外のSourceToken.index（空白のみ・空文字）。うち行に参照されなかったもの */
  excludedTokenIndexes: number[];
  unassignedWhitespaceTokenIndexes: number[];
  physicalRows: PhysicalRowCandidate[];
  columnBands: ColumnBandObservation[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const isBlank = (t: SourceToken): boolean => t.rawText.trim() === '';
const isBoxDrawingOnly = (t: SourceToken): boolean => /^[─-╿\s]+$/.test(t.rawText) && /[─-╿]/.test(t.rawText);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** SourceTokenと同じ左上原点でのベースラインy（transform[5]はPDF user space・左下原点） */
export function baselineTopOf(token: SourceToken, meta: PageMeta): number {
  return meta.height - (token.transform[5] - meta.view[1]);
}

export function yReferenceOf(token: SourceToken, meta: PageMeta, ref: YReference): number {
  if (ref === 'baseline') return baselineTopOf(token, meta);
  if (ref === 'yMin') return token.bbox.yMin;
  return (token.bbox.yMin + token.bbox.yMax) / 2;
}

/** ページの非空白tokenのfontSize中央値（相対しきい値の基準）。tokenが無ければ0 */
export function referenceFontSizeOf(tokens: SourceToken[]): number {
  return median(tokens.filter(t => !isBlank(t) && t.fontSize > 0).map(t => t.fontSize));
}

/** 昇順にソートした値を、隣との差が tolerance を超えたところで区切る（1次元gap法）。各グループは入力配列のindexを返す */
function gapGroups(items: { value: number; id: number }[], tolerance: number): number[][] {
  const sorted = [...items].sort((a, b) => a.value - b.value || a.id - b.id);
  const groups: number[][] = [];
  let prev = -Infinity;
  for (const it of sorted) {
    if (groups.length === 0 || it.value - prev > tolerance) groups.push([]);
    groups[groups.length - 1].push(it.id);
    prev = it.value;
  }
  return groups;
}

function unionBBox(tokens: SourceToken[]): SourceTokenBBox {
  return {
    xMin: round3(Math.min(...tokens.map(t => t.bbox.xMin))),
    yMin: round3(Math.min(...tokens.map(t => t.bbox.yMin))),
    xMax: round3(Math.max(...tokens.map(t => t.bbox.xMax))),
    yMax: round3(Math.max(...tokens.map(t => t.bbox.yMax))),
  };
}

/** SourceToken[] → PhysicalRowCandidate[]（行クラスタリングのみ。tokensは変更しない） */
export function clusterPhysicalRows(
  tokens: SourceToken[],
  meta: PageMeta,
  options: RowClusteringOptions = DEFAULT_GEOMETRY_OPTIONS.rowClustering,
): { rows: PhysicalRowCandidate[]; referenceFontSize: number; tolerance: number; excluded: number[]; unassignedWhitespace: number[] } {
  const referenceFontSize = referenceFontSizeOf(tokens);
  const tolerance = options.toleranceFactor * referenceFontSize;
  const eligible = tokens.filter(t => !isBlank(t));
  const excluded = tokens.filter(isBlank).map(t => t.index);
  const yRef = (t: SourceToken) => yReferenceOf(t, meta, options.yReference);

  const groups = gapGroups(eligible.map((t, i) => ({ value: yRef(t), id: i })), tolerance);
  const rows: PhysicalRowCandidate[] = groups.map((g, rowIndex) => {
    const members = g.map(i => eligible[i]);
    const raw = members.map(t => t.index).sort((a, b) => a - b);
    const byIndex = new Map(members.map(t => [t.index, t]));
    const visual = [...raw].sort((a, b) => byIndex.get(a)!.bbox.xMin - byIndex.get(b)!.bbox.xMin || a - b);
    const bbox = unionBBox(members);
    return {
      rowIndex,
      rawTokenIndexes: raw,
      visualTokenIndexes: visual,
      rawOrderMatchesVisualOrder: raw.every((v, i) => v === visual[i]),
      whitespaceTokenIndexes: [],
      bbox,
      repY: round3(median(members.map(yRef))),
      baselineY: round3(median(members.map(t => baselineTopOf(t, meta)))),
      centerY: round3((bbox.yMin + bbox.yMax) / 2),
      tokenCount: raw.length,
      nonWhitespaceTokenCount: raw.length,
    };
  });

  // 空白のみ・空文字のtokenは、y代表値が最も近い行（tolerance以内）から参照する。クラスタリング自体には影響しない
  const unassignedWhitespace: number[] = [];
  const blanks = new Map(tokens.filter(isBlank).map(t => [t.index, t]));
  for (const [index, t] of blanks) {
    let best: PhysicalRowCandidate | undefined;
    let bestDist = Infinity;
    for (const r of rows) {
      const d = Math.abs(r.repY - yRef(t));
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    if (best && bestDist <= tolerance) {
      best.whitespaceTokenIndexes.push(index);
      best.tokenCount++;
    } else {
      unassignedWhitespace.push(index);
    }
  }
  for (const r of rows) r.whitespaceTokenIndexes.sort((a, b) => a - b);
  return { rows, referenceFontSize, tolerance, excluded, unassignedWhitespace };
}

/** 左端/右端の揃いから、縦方向に繰り返し現れる配置帯を観測する（意味ラベルなし。帯は重なり得る） */
export function observeColumnBands(
  tokens: SourceToken[],
  rows: PhysicalRowCandidate[],
  referenceFontSize: number,
  options: ColumnBandOptions = DEFAULT_GEOMETRY_OPTIONS.columnBands,
): ColumnBandObservation[] {
  const tolerance = options.edgeToleranceFactor * referenceFontSize;
  const rowOf = new Map<number, number>();
  for (const r of rows) for (const i of r.rawTokenIndexes) rowOf.set(i, r.rowIndex);
  const eligible = tokens.filter(t => !isBlank(t) && !isBoxDrawingOnly(t) && rowOf.has(t.index));

  const bands: Omit<ColumnBandObservation, 'bandIndex'>[] = [];
  for (const edge of ['xMin', 'xMax'] as const) {
    const sorted = [...eligible].sort((a, b) => a.bbox[edge] - b.bbox[edge] || a.index - b.index);
    // 帯の幅（端の値の範囲）が tolerance を超えないよう、最小の端の値を起点に区切る
    let bin: SourceToken[] = [];
    const flush = () => {
      const rowCount = new Set(bin.map(t => rowOf.get(t.index))).size;
      if (rowCount >= options.minRows) {
        bands.push({
          edge,
          edgeRange: [round3(bin[0].bbox[edge]), round3(bin[bin.length - 1].bbox[edge])],
          xMin: round3(Math.min(...bin.map(t => t.bbox.xMin))),
          xMax: round3(Math.max(...bin.map(t => t.bbox.xMax))),
          tokenCount: bin.length,
          rowCount,
          tokenIndexes: bin.map(t => t.index).sort((a, b) => a - b),
        });
      }
      bin = [];
    };
    for (const t of sorted) {
      if (bin.length > 0 && t.bbox[edge] - bin[0].bbox[edge] > tolerance) flush();
      bin.push(t);
    }
    if (bin.length > 0) flush();
  }
  return bands.sort((a, b) => a.edgeRange[0] - b.edgeRange[0] || a.edge.localeCompare(b.edge)).map((b, bandIndex) => ({ bandIndex, ...b }));
}

export function buildTableGeometry(
  tokens: SourceToken[],
  meta: PageMeta,
  options: TableGeometryOptions = DEFAULT_GEOMETRY_OPTIONS,
): TableGeometryResult {
  const c = clusterPhysicalRows(tokens, meta, options.rowClustering);
  const bands = observeColumnBands(tokens, c.rows, c.referenceFontSize, options.columnBands);
  return {
    parameters: {
      rowClustering: {
        ...options.rowClustering,
        algorithm: 'gap-1d (sorted y-reference; new row when gap > tolerance)',
        referenceFontSize: c.referenceFontSize,
        referenceFontSizeBasis: 'median fontSize of non-whitespace tokens on the page',
        tolerance: round3(c.tolerance),
        excludedFromClustering:
          'tokens with rawText.trim() === "" (empty or whitespace-only); kept in SourceToken, referenced as whitespaceTokenIndexes when within tolerance of a row',
        xUsedForRowMembership: false,
      },
      columnBands: {
        ...options.columnBands,
        algorithm: 'edge clustering (bins anchored at the smallest edge, width <= edgeTolerance); keep bins with rowCount >= minRows',
        edgeTolerance: round3(options.columnBands.edgeToleranceFactor * c.referenceFontSize),
        ignoredForBands: 'tokens that are empty/whitespace-only, or consist only of box-drawing characters (U+2500-257F)',
        bandsMayOverlap: true,
      },
    },
    sourceTokenCount: tokens.length,
    excludedTokenIndexes: c.excluded,
    unassignedWhitespaceTokenIndexes: c.unassignedWhitespace,
    physicalRows: c.rows,
    columnBands: bands,
  };
}

/**
 * y代表値ごとの安定性の比較（診断）。toleranceFactor を振ったときの行数と、ページ内で最も近い2行の代表値の差。
 * 行数がfactorの広い範囲で変わらない方が、しきい値に依存しにくい（安定）。
 */
export function sweepYReference(
  tokens: SourceToken[],
  meta: PageMeta,
  factors: number[] = [0.05, 0.1, 0.25, 0.4, 0.5, 0.75],
): Record<YReference, { toleranceFactor: number; rowCount: number }[]> {
  const out = {} as Record<YReference, { toleranceFactor: number; rowCount: number }[]>;
  for (const yReference of ['baseline', 'yMin', 'centerY'] as const) {
    out[yReference] = factors.map(toleranceFactor => ({
      toleranceFactor,
      rowCount: clusterPhysicalRows(tokens, meta, { yReference, toleranceFactor }).rows.length,
    }));
  }
  return out;
}
