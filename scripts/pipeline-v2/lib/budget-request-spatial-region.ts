/**
 * SpatialRegionDetector PoC: 「ページ上で互いに近く、2次元的な連続性を持つ HorizontalSegment の集合」を、意味を付けずに観測する。
 *
 * SpatialRegionCandidate は semantic region ではない。core / remark / matter / amount / request_summary /
 * breakdown_table / staffing_table 等の意味名・種別を持たず、token文字列（rawText）を判定に使わない
 * （判定に使うのは bbox・baseline・x-gap・gutter などの幾何量だけ）。数値parse・符号解釈・Core/Auxiliary関連付けもしない。
 *
 * ## 検討した方式と採用
 * - A. connected-components（segmentをnode、x近接/重なり + y近接をedge）: 局所接続だけだと、同じy付近に並ぶ左側の構造と右側の大表が
 *   隣接edgeで橋渡し（bridge）されてページ全体が1 componentになりうる。診断として常に計算し `diagnostics.algorithmComparison.connectedComponentsOnly` に出す。
 * - B. gutter / whitespace（ページ全体の縦方向の空白帯＝x方向の被覆が途切れる区間を境界候補にする）: 構造の左右の境界は取れるが、
 *   gutterだけでは縦方向（行の塊）を分けられず、表の列間の空白も境界にしてしまいうる。診断に `gutterBandsOnly` として出す。
 * - C. hybrid（採用）: gutterで区切ったx-band内でだけ、局所接続（A）を行う。つまり「局所接続 + gutter evidence」。
 *   repeated alignment（ColumnBand）はregion判定に使わない（LogicalRowResolverの観測で判別力が弱いため）。
 *
 * ## 不変条件
 * - SourceToken / TableGeometry / LogicalRowResult は読み取るだけ（書き換えない）。LogicalRowCandidateの境界をregionの境界とは仮定しない
 *   （入力はHorizontalSegmentとPhysicalRowの幾何で、LogicalRowCandidateは参照用の `logicalRowIndexes` を引くためだけに使う）。
 * - regionはdisjoint（同じtokenは高々1 region）。根拠の弱いsegment（physical rowが minRows 未満の孤立component）は
 *   `unassigned` として追跡する。どちらのregionとも決められない境界（しきい値を少し変えると結合する/分割する）は
 *   `ambiguity` / `ambiguousAssignments` として残し、無理に結合しない。
 * - region は SourceToken.index / PhysicalRowCandidate.rowIndex / LogicalRowCandidate.logicalRowIndex / segment参照へ戻れる。
 *   bboxは構成tokenのbboxのunionとして再計算できる。tokenを文字列にcollapseしない。
 * - しきい値はページ由来の統計量（fontSize中央値・physical row間隔の中央値）に対する相対値で、すべて出力のparametersに残す。
 */
import type { LogicalRowResult, HorizontalSegment } from './budget-request-logical-row';
import type { SourceToken, SourceTokenBBox } from './budget-request-source-token';
import type { TableGeometryResult } from './budget-request-table-geometry';

export const SPATIAL_REGION_SCHEMA = 'budget-request-spatial-region-poc/v1';

export interface SpatialRegionOptions {
  /** x方向の被覆が途切れる空白帯のうち、幅が factor × fontSize中央値 以上のものをgutterとする */
  gutter: { factor: number };
  proximity: {
    /** x方向に重ならないsegment同士を接続する最大距離 = horizontalFactor × fontSize中央値 */
    horizontalFactor: number;
    /** baseline差の上限 = verticalPitchFactor × physical row間隔の中央値 */
    verticalPitchFactor: number;
  };
  /** regionにするcomponentのphysical row数の下限（未満はunassigned） */
  minRows: number;
  /** 感度分析: proximityをこの倍率/逆数で振って、結合・分割しうる境界をambiguityとして記録する */
  sensitivityScale: number;
}

export const DEFAULT_SPATIAL_REGION_OPTIONS: SpatialRegionOptions = {
  gutter: { factor: 3.0 },
  proximity: { horizontalFactor: 5.0, verticalPitchFactor: 2.0 },
  minRows: 2,
  sensitivityScale: 1.25,
};

export interface SegmentRef {
  physicalRowIndex: number;
  segmentIndex: number;
}

export interface SpatialRegionEvidence {
  /** gutterで区切ったx-bandの番号（0=最左）と、そのbandのx範囲（gutter間） */
  xBand: number;
  xBandRange: [number, number | null];
  /** componentを構成したedgeの数と、edgeで使った計測値の最大 */
  edgeCount: number;
  maxVerticalDistance: number;
  maxHorizontalGap: number;
}

export interface SpatialRegionCandidate {
  regionIndex: number;
  /** 構成SourceToken.index（昇順 = raw order） */
  tokenIndexes: number[];
  physicalRowIndexes: number[];
  logicalRowIndexes: number[];
  /** 構成segmentへの参照（regionはHorizontalSegmentの集合） */
  segments: SegmentRef[];
  /** 構成tokenのbbox和集合 */
  bbox: SourceTokenBBox;
  geometry: { width: number; height: number; tokenCount: number; segmentCount: number; physicalRowCount: number; logicalRowCount: number };
  evidence: SpatialRegionEvidence;
  ambiguity?: { neighboringRegionIndexes?: number[]; reason?: string };
}

export interface AmbiguousRegionAssignment {
  /** 境界にあたるsegmentのtoken（regionにもunassignedにも属したままの位置。移動はしていない） */
  tokenIndexes: number[];
  candidateRegionIndexes: number[];
  evidence: { kind: 'regions_merge_at_larger_proximity' | 'unassigned_attaches_at_larger_proximity'; scale: number };
}

export interface Gutter {
  xMin: number;
  xMax: number;
  width: number;
}

export interface SpatialRegionResult {
  parameters: {
    referenceFontSize: number;
    medianRowPitch: number;
    gutter: SpatialRegionOptions['gutter'] & { minWidth: number; definition: 'x intervals not covered by any non-blank token of the page rows, between the leftmost and rightmost token' };
    proximity: SpatialRegionOptions['proximity'] & {
      horizontalGap: number;
      verticalDistance: number;
      definition: 'edge between segments of the same x-band when |baselineY difference| <= verticalDistance and (x-overlap or horizontal gap <= horizontalGap)';
    };
    minRows: number;
    sensitivityScale: number;
    regionsAreDisjoint: true;
    semanticLabels: 'none';
  };
  regions: SpatialRegionCandidate[];
  /** physical rowに属するがどのregionにも入れなかったsegmentのtoken（根拠が弱い孤立component） */
  unassignedTokenIndexes: number[];
  unassignedPhysicalRowIndexes: number[];
  /** TableGeometryの行クラスタリングに入らなかったtoken（空白のみ・空文字）。regionの対象外 */
  nonRowTokenIndexes: number[];
  gutters: Gutter[];
  ambiguousAssignments: AmbiguousRegionAssignment[];
  diagnostics: {
    algorithmComparison: {
      connectedComponentsOnly: { componentCount: number; regionCount: number; largestRegionTokenCount: number; largestRegionPhysicalRowCount: number; edgesSuppressedByGutters: number };
      gutterBandsOnly: { bandCount: number };
      hybrid: { regionCount: number; unassignedSegmentCount: number; largestRegionTokenCount: number; largestRegionPhysicalRowCount: number };
    };
    counts: { sourceTokenCount: number; assignedTokenCount: number; unassignedTokenCount: number; nonRowTokenCount: number; ambiguousAssignmentCount: number };
    largestRegion?: { regionIndex: number; tokenCount: number; physicalRowCount: number; bbox: SourceTokenBBox };
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function unionBBox(boxes: SourceTokenBBox[]): SourceTokenBBox {
  return {
    xMin: round3(Math.min(...boxes.map(b => b.xMin))),
    yMin: round3(Math.min(...boxes.map(b => b.yMin))),
    xMax: round3(Math.max(...boxes.map(b => b.xMax))),
    yMax: round3(Math.max(...boxes.map(b => b.yMax))),
  };
}

/** x方向の被覆が途切れる空白帯（gutter）。最左〜最右のtokenの間で、幅が minWidth 以上のもの */
export function detectGutters(tokens: SourceToken[], tokenIndexes: number[], minWidth: number): Gutter[] {
  const iv = tokenIndexes.map(i => [tokens[i].bbox.xMin, tokens[i].bbox.xMax] as const).sort((a, b) => a[0] - b[0]);
  const gutters: Gutter[] = [];
  let reach = -Infinity;
  for (const [a, b] of iv) {
    if (reach !== -Infinity && a - reach >= minWidth) gutters.push({ xMin: round3(reach), xMax: round3(a), width: round3(a - reach) });
    reach = Math.max(reach, b);
  }
  return gutters;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

interface Node {
  ref: SegmentRef;
  segment: HorizontalSegment;
  baselineY: number;
  band: number;
}

export function detectSpatialRegions(
  tokens: SourceToken[],
  geometry: TableGeometryResult,
  logical: LogicalRowResult,
  options: SpatialRegionOptions = DEFAULT_SPATIAL_REGION_OPTIONS,
): SpatialRegionResult {
  const ref = geometry.parameters.rowClustering.referenceFontSize;
  const rowBaseline = new Map(geometry.physicalRows.map(r => [r.rowIndex, r.baselineY]));
  const sortedBaselines = [...new Set(geometry.physicalRows.map(r => r.baselineY))].sort((a, b) => a - b);
  const pitches = sortedBaselines.slice(1).map((y, i) => y - sortedBaselines[i]).filter(d => d > 0);
  const medianRowPitch = round3(median(pitches));
  const logicalOfRow = new Map<number, number>();
  for (const c of logical.logicalRowCandidates) for (const p of c.physicalRowIndexes) logicalOfRow.set(p, c.logicalRowIndex);

  const rowTokenIndexes = geometry.physicalRows.flatMap(r => r.rawTokenIndexes);
  const gutterMinWidth = options.gutter.factor * ref;
  const gutters = detectGutters(tokens, rowTokenIndexes, gutterMinWidth);
  const bandOf = (x: number): number => gutters.filter(g => (g.xMin + g.xMax) / 2 < x).length;

  const nodes: Node[] = logical.logicalRowCandidates.flatMap(c =>
    c.segments.map(segment => ({
      ref: { physicalRowIndex: segment.physicalRowIndex, segmentIndex: segment.segmentIndex },
      segment,
      baselineY: rowBaseline.get(segment.physicalRowIndex)!,
      band: bandOf((segment.bbox.xMin + segment.bbox.xMax) / 2),
    })),
  );

  const connect = (scale: number, useGutters: boolean) => {
    const hLimit = options.proximity.horizontalFactor * ref * scale;
    const vLimit = options.proximity.verticalPitchFactor * medianRowPitch * scale;
    const uf = new UnionFind(nodes.length);
    const edges: { a: number; b: number; dv: number; dh: number }[] = [];
    let suppressed = 0;
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const s = nodes[a].segment.bbox;
        const t = nodes[b].segment.bbox;
        const dv = Math.abs(nodes[a].baselineY - nodes[b].baselineY);
        const overlap = Math.min(s.xMax, t.xMax) - Math.max(s.xMin, t.xMin);
        const dh = overlap > 0 ? 0 : -overlap;
        if (dv > vLimit + 1e-9 || dh > hLimit + 1e-9) continue;
        if (useGutters && nodes[a].band !== nodes[b].band) {
          suppressed++;
          continue;
        }
        uf.union(a, b);
        edges.push({ a, b, dv, dh });
      }
    }
    return { uf, edges, suppressed };
  };

  const componentsOf = (uf: UnionFind) => {
    const map = new Map<number, number[]>();
    nodes.forEach((_, i) => map.set(uf.find(i), [...(map.get(uf.find(i)) ?? []), i]));
    return [...map.values()];
  };
  const rowsOf = (members: number[]) => new Set(members.map(i => nodes[i].ref.physicalRowIndex));
  const tokensOf = (members: number[]) => members.flatMap(i => nodes[i].segment.rawTokenIndexes).sort((a, b) => a - b);
  const bboxOf = (members: number[]) => unionBBox(tokensOf(members).map(i => tokens[i].bbox));

  // 採用方式（hybrid）: gutterで区切ったx-band内の局所接続
  const base = connect(1, true);
  const comps = componentsOf(base.uf);
  const accepted = comps.filter(m => rowsOf(m).size >= options.minRows);
  const rejected = comps.filter(m => rowsOf(m).size < options.minRows);
  const ordered = accepted
    .map(members => ({ members, bbox: bboxOf(members) }))
    .sort((a, b) => a.bbox.yMin - b.bbox.yMin || a.bbox.xMin - b.bbox.xMin);

  const nodeRegion = new Map<number, number>();
  const edgeStats = (members: number[]) => {
    const set = new Set(members);
    const es = base.edges.filter(e => set.has(e.a) && set.has(e.b));
    return { edgeCount: es.length, maxVerticalDistance: round3(Math.max(0, ...es.map(e => e.dv))), maxHorizontalGap: round3(Math.max(0, ...es.map(e => e.dh))) };
  };

  // 感度分析: proximityを振ったとき、結合する/分割する境界
  const larger = connect(options.sensitivityScale, true);
  const smaller = connect(1 / options.sensitivityScale, true);

  const regions: SpatialRegionCandidate[] = ordered.map(({ members, bbox }, regionIndex) => {
    members.forEach(m => nodeRegion.set(m, regionIndex));
    const tokenIndexes = tokensOf(members);
    const physicalRowIndexes = [...rowsOf(members)].sort((a, b) => a - b);
    const logicalRowIndexes = [...new Set(physicalRowIndexes.map(p => logicalOfRow.get(p)!))].sort((a, b) => a - b);
    const band = nodes[members[0]].band;
    const g = { width: round3(bbox.xMax - bbox.xMin), height: round3(bbox.yMax - bbox.yMin) };
    const splits = new Set(members.map(m => smaller.uf.find(m))).size;
    return {
      regionIndex,
      tokenIndexes,
      physicalRowIndexes,
      logicalRowIndexes,
      segments: members.map(m => nodes[m].ref).sort((a, b) => a.physicalRowIndex - b.physicalRowIndex || a.segmentIndex - b.segmentIndex),
      bbox,
      geometry: { ...g, tokenCount: tokenIndexes.length, segmentCount: members.length, physicalRowCount: physicalRowIndexes.length, logicalRowCount: logicalRowIndexes.length },
      evidence: {
        xBand: band,
        xBandRange: [band === 0 ? round3(Math.min(...tokenIndexes.map(i => tokens[i].bbox.xMin))) : gutters[band - 1].xMax, band < gutters.length ? gutters[band].xMin : null],
        ...edgeStats(members),
      },
      ...(splits > 1 ? { ambiguity: { reason: `splits into ${splits} components at proximity x${round3(1 / options.sensitivityScale)}` } } : {}),
    };
  });

  // 感度分析: 大きいproximityで別regionが結合する / unassignedがregionに付く
  const ambiguousAssignments: AmbiguousRegionAssignment[] = [];
  const mergedGroups = new Map<number, Set<number>>();
  nodeRegion.forEach((r, n) => {
    const k = larger.uf.find(n);
    mergedGroups.set(k, (mergedGroups.get(k) ?? new Set()).add(r));
  });
  for (const [k, rs] of mergedGroups) {
    if (rs.size < 2) continue;
    const idx = [...rs].sort((a, b) => a - b);
    const boundary = larger.edges.filter(e => larger.uf.find(e.a) === k && nodeRegion.get(e.a) !== nodeRegion.get(e.b)).flatMap(e => [e.a, e.b]);
    ambiguousAssignments.push({
      tokenIndexes: tokensOf([...new Set(boundary)]),
      candidateRegionIndexes: idx,
      evidence: { kind: 'regions_merge_at_larger_proximity', scale: options.sensitivityScale },
    });
    for (const r of idx) {
      const reg = regions[r];
      reg.ambiguity = { ...reg.ambiguity, neighboringRegionIndexes: idx.filter(x => x !== r), reason: reg.ambiguity?.reason ?? `merges with neighboring region(s) at proximity x${options.sensitivityScale}` };
    }
  }
  for (const m of rejected) {
    const attach = new Set<number>();
    for (const n of m) for (const e of larger.edges) {
      const other = e.a === n ? e.b : e.b === n ? e.a : -1;
      if (other >= 0 && nodeRegion.has(other)) attach.add(nodeRegion.get(other)!);
    }
    if (attach.size > 0) {
      ambiguousAssignments.push({ tokenIndexes: tokensOf(m), candidateRegionIndexes: [...attach].sort((a, b) => a - b), evidence: { kind: 'unassigned_attaches_at_larger_proximity', scale: options.sensitivityScale } });
    }
  }

  const unassignedSegments = rejected.flat();
  const unassignedTokenIndexes = tokensOf(unassignedSegments);
  const unassignedPhysicalRowIndexes = [...rowsOf(unassignedSegments)].sort((a, b) => a - b);
  const assignedTokenCount = regions.reduce((n, r) => n + r.tokenIndexes.length, 0);

  // 診断: 方式の比較（A: gutterなしのconnected-components / B: gutterだけ）
  const plain = connect(1, false);
  const plainComps = componentsOf(plain.uf);
  const plainRegions = plainComps.filter(m => rowsOf(m).size >= options.minRows);
  const biggest = (groups: number[][]) => groups.reduce<number[] | undefined>((a, b) => (!a || tokensOf(b).length > tokensOf(a).length ? b : a), undefined);
  const plainBiggest = biggest(plainRegions);
  const hybridBiggest = biggest(accepted);
  const largest = regions.reduce<SpatialRegionCandidate | undefined>((a, b) => (!a || b.geometry.tokenCount > a.geometry.tokenCount ? b : a), undefined);

  return {
    parameters: {
      referenceFontSize: ref,
      medianRowPitch,
      gutter: {
        ...options.gutter,
        minWidth: round3(gutterMinWidth),
        definition: 'x intervals not covered by any non-blank token of the page rows, between the leftmost and rightmost token',
      },
      proximity: {
        ...options.proximity,
        horizontalGap: round3(options.proximity.horizontalFactor * ref),
        verticalDistance: round3(options.proximity.verticalPitchFactor * medianRowPitch),
        definition: 'edge between segments of the same x-band when |baselineY difference| <= verticalDistance and (x-overlap or horizontal gap <= horizontalGap)',
      },
      minRows: options.minRows,
      sensitivityScale: options.sensitivityScale,
      regionsAreDisjoint: true,
      semanticLabels: 'none',
    },
    regions,
    unassignedTokenIndexes,
    unassignedPhysicalRowIndexes,
    nonRowTokenIndexes: geometry.excludedTokenIndexes,
    gutters,
    ambiguousAssignments,
    diagnostics: {
      algorithmComparison: {
        connectedComponentsOnly: {
          componentCount: plainComps.length,
          regionCount: plainRegions.length,
          largestRegionTokenCount: plainBiggest ? tokensOf(plainBiggest).length : 0,
          largestRegionPhysicalRowCount: plainBiggest ? rowsOf(plainBiggest).size : 0,
          edgesSuppressedByGutters: base.suppressed,
        },
        gutterBandsOnly: { bandCount: gutters.length + 1 },
        hybrid: {
          regionCount: regions.length,
          unassignedSegmentCount: unassignedSegments.length,
          largestRegionTokenCount: hybridBiggest ? tokensOf(hybridBiggest).length : 0,
          largestRegionPhysicalRowCount: hybridBiggest ? rowsOf(hybridBiggest).size : 0,
        },
      },
      counts: {
        sourceTokenCount: tokens.length,
        assignedTokenCount,
        unassignedTokenCount: unassignedTokenIndexes.length,
        nonRowTokenCount: geometry.excludedTokenIndexes.length,
        ambiguousAssignmentCount: ambiguousAssignments.length,
      },
      ...(largest ? { largestRegion: { regionIndex: largest.regionIndex, tokenCount: largest.geometry.tokenCount, physicalRowCount: largest.geometry.physicalRowCount, bbox: largest.bbox } } : {}),
    },
  };
}
