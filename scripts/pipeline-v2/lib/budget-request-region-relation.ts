/**
 * RegionRelationResolver PoC: SpatialRegionCandidate / LogicalRowCandidate の間の「空間関係の観測」を relation candidate と
 * evidence として可逆に記録する。
 *
 * RegionRelationCandidate は semantic record ではない。「source と target がページ上の配置・近接・包含から関連している
 * 可能性」を記録するだけで、`target is remark of source` のような意味関係は作らない。core / auxiliary / remark /
 * request_summary / breakdown_table / matter / amount 等のラベルを持たず、rawTextを判定に使わない（幾何量のみ）。
 *
 * ## 方針
 * - relation は方向を明示した幾何の観測: horizontal = target_right_of_source | target_left_of_source | overlap、
 *   vertical = target_below_source | target_above_source | overlap（どちらからどちらを見たrelationかが分かる）。
 * - node は SpatialRegionCandidate（regionIndex）と LogicalRowCandidate（logicalRowIndex）。region↔region（sourceは
 *   regionIndexの小さい側）と logical_row→region の2種類。SourceTokenは複製せず、すべて既存indexへ戻れる。
 * - 候補の条件（ページ由来の相対cutoff）: ①tokenを共有する（logical rowのtokenがregionに属する）、または
 *   ②bbox間の水平距離 ≤ horizontalCutoffPageFraction × ページ幅 かつ 垂直距離 ≤ verticalCutoffPitchFactor × physical row間隔の中央値。
 *   垂直cutoffの既定値(2.0×)はSpatialRegionDetectorの垂直近接と同じ値を流用したもの（その値自体は前段で4サンプルの診断を見て決めた）。
 *   水平cutoff(ページ幅の0.4)は大きめの任意値で、このPoCでは調整していない。physical row間隔の中央値はページごとに変わる（p1555は6.94pt）。
 * - **nearest winner は作らない**: 同じnodeから見て同じ種類の相手・同じ方向の候補が2つ以上ある場合は、全て残して
 *   `ambiguity.competingRelationIndexes` を付ける。ただし logical row がregionにtokenを持つ関係（`row_tokens_in_region` evidence=
 *   所属の事実）は「どれか1つを選ぶ候補」ではないので競合の対象にしない（rowが複数regionにまたがることは `row_tokens_in_region` の
 *   relationが複数あること自体で観測でき、diagnosticsにも出す）。
 * - **stability（relationの安定性）はregionの安定性とは別に観測する**: stableなのは、①source/targetがambiguousなregion・logical rowでない
 *   ②cutoffを0.8倍にしても候補として残る ③競合候補がない、のすべてを満たすとき。理由は `stability.reasons` に列挙。
 *   cutoffを0.8/1.0/1.25倍に振ったときの候補数の変化は diagnostics.sensitivity に出す。
 * - confidence のような単一スコアは作らず、evidence（種別と計測値）に分解する。
 * - 入力（SourceToken / TableGeometry / LogicalRowResult / SpatialRegionResult）は読み取るだけで、書き込まない。
 */
import type { LogicalRowResult } from './budget-request-logical-row';
import type { PageMeta, SourceTokenBBox } from './budget-request-source-token';
import type { SpatialRegionResult } from './budget-request-spatial-region';

export const REGION_RELATION_SCHEMA = 'budget-request-region-relation-poc/v1';

export interface RegionRelationOptions {
  /** 水平cutoff = horizontalCutoffPageFraction × ページ幅（token共有の無いpairに適用） */
  horizontalCutoffPageFraction: number;
  /** 垂直cutoff = verticalCutoffPitchFactor × physical row間隔の中央値 */
  verticalCutoffPitchFactor: number;
  /** 感度分析: cutoffをこの倍率で振る */
  sensitivityScales: number[];
}

export const DEFAULT_REGION_RELATION_OPTIONS: RegionRelationOptions = {
  horizontalCutoffPageFraction: 0.4,
  verticalCutoffPitchFactor: 2.0,
  sensitivityScales: [0.8, 1.25],
};

export type RelationNodeRef = { kind: 'spatial_region'; regionIndex: number } | { kind: 'logical_row'; logicalRowIndex: number };

export interface RelationGeometry {
  /** bbox間の水平距離（x方向に重なるときnull） */
  horizontalGap: number | null;
  verticalGap: number | null;
  xOverlap: number;
  yOverlap: number;
  /** overlap / 狭い方の幅（高さ）。重ならなければ0 */
  xOverlapRatio: number;
  yOverlapRatio: number;
  /** target中心 − source中心 */
  centerDx: number;
  centerDy: number;
}

export interface RelationDirection {
  horizontal: 'target_right_of_source' | 'target_left_of_source' | 'overlap';
  vertical: 'target_below_source' | 'target_above_source' | 'overlap';
}

export type RelationEvidence =
  | { kind: 'shares_physical_rows'; value: number }
  | { kind: 'shares_logical_rows'; value: number }
  | { kind: 'row_tokens_in_region'; value: { rowTokens: number; shared: number; regionTokens: number } }
  | { kind: 'within_horizontal_cutoff'; value: { gap: number | null; cutoff: number } }
  | { kind: 'within_vertical_cutoff'; value: { gap: number | null; cutoff: number } };

export interface RegionRelationCandidate {
  relationIndex: number;
  source: RelationNodeRef;
  target: RelationNodeRef;
  direction: RelationDirection;
  geometry: RelationGeometry;
  evidence: RelationEvidence[];
  stability: { stable: boolean; reasons: string[] };
  ambiguity?: { competingRelationIndexes: number[]; reason: string };
}

export interface RegionRelationResult {
  parameters: {
    horizontalCutoffPageFraction: number;
    horizontalCutoff: number;
    verticalCutoffPitchFactor: number;
    verticalCutoff: number;
    pageWidth: number;
    medianRowPitch: number;
    sensitivityScales: number[];
    candidateRule: 'token-sharing pair, or (horizontal gap <= horizontalCutoff and vertical gap <= verticalCutoff); nearest winner is never selected';
    semanticLabels: 'none';
  };
  relations: RegionRelationCandidate[];
  diagnostics: {
    pairCounts: { regionPairs: number; logicalRowRegionPairs: number };
    counts: { candidateRelations: number; regionRegion: number; logicalRowRegion: number; ambiguousRelations: number; stableRelations: number; unstableRelations: number };
    unstableReasons: Record<string, number>;
    sensitivity: { scale: number; candidateRelations: number; added: number; removed: number }[];
    /** relationの端点になっていないnode（観測できなかったもの） */
    isolated: { regionIndexes: number[]; logicalRowIndexes: number[] };
    unassignedPhysicalRowCountFromSpatialRegion: number;
    /** tokenを持つregionが2つ以上ある logical row の数（rowが複数regionにまたがる観測） */
    logicalRowsSpanningMultipleRegions: number;
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const keyOf = (n: RelationNodeRef): string => (n.kind === 'spatial_region' ? `R${n.regionIndex}` : `L${n.logicalRowIndex}`);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** source→target の幾何（bboxのみから再計算できる） */
export function relationGeometry(s: SourceTokenBBox, t: SourceTokenBBox): RelationGeometry & { direction: RelationDirection } {
  const xOverlap = Math.max(0, Math.min(s.xMax, t.xMax) - Math.max(s.xMin, t.xMin));
  const yOverlap = Math.max(0, Math.min(s.yMax, t.yMax) - Math.max(s.yMin, t.yMin));
  const sw = s.xMax - s.xMin;
  const tw = t.xMax - t.xMin;
  const sh = s.yMax - s.yMin;
  const th = t.yMax - t.yMin;
  const hGap = xOverlap > 0 ? null : Math.max(t.xMin - s.xMax, s.xMin - t.xMax);
  const vGap = yOverlap > 0 ? null : Math.max(t.yMin - s.yMax, s.yMin - t.yMax);
  return {
    horizontalGap: hGap === null ? null : round3(hGap),
    verticalGap: vGap === null ? null : round3(vGap),
    xOverlap: round3(xOverlap),
    yOverlap: round3(yOverlap),
    xOverlapRatio: round3(xOverlap > 0 ? xOverlap / Math.min(sw, tw) : 0),
    yOverlapRatio: round3(yOverlap > 0 ? yOverlap / Math.min(sh, th) : 0),
    centerDx: round3((t.xMin + t.xMax) / 2 - (s.xMin + s.xMax) / 2),
    centerDy: round3((t.yMin + t.yMax) / 2 - (s.yMin + s.yMax) / 2),
    direction: {
      horizontal: xOverlap > 0 ? 'overlap' : t.xMin >= s.xMax ? 'target_right_of_source' : 'target_left_of_source',
      vertical: yOverlap > 0 ? 'overlap' : t.yMin >= s.yMax ? 'target_below_source' : 'target_above_source',
    },
  };
}

interface Pair {
  source: RelationNodeRef;
  target: RelationNodeRef;
  sBox: SourceTokenBBox;
  tBox: SourceTokenBBox;
  shared: { physicalRows: number; logicalRows: number; rowTokens?: { rowTokens: number; shared: number; regionTokens: number } };
}

export function resolveRegionRelations(
  page: PageMeta,
  logical: LogicalRowResult,
  spatial: SpatialRegionResult,
  options: RegionRelationOptions = DEFAULT_REGION_RELATION_OPTIONS,
): RegionRelationResult {
  const regions = spatial.regions;
  const rows = logical.logicalRowCandidates;
  const medianRowPitch = spatial.parameters.medianRowPitch;

  // 全pairを列挙（O(n²)。観測した構造をそのまま出す）
  const pairs: Pair[] = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      pairs.push({
        source: { kind: 'spatial_region', regionIndex: a.regionIndex },
        target: { kind: 'spatial_region', regionIndex: b.regionIndex },
        sBox: a.bbox,
        tBox: b.bbox,
        shared: {
          physicalRows: a.physicalRowIndexes.filter(p => b.physicalRowIndexes.includes(p)).length,
          logicalRows: a.logicalRowIndexes.filter(l => b.logicalRowIndexes.includes(l)).length,
        },
      });
    }
  }
  for (const l of rows) {
    const lTokens = new Set(l.rawTokenIndexes);
    for (const r of regions) {
      const sharedTokens = r.tokenIndexes.filter(t => lTokens.has(t)).length;
      pairs.push({
        source: { kind: 'logical_row', logicalRowIndex: l.logicalRowIndex },
        target: { kind: 'spatial_region', regionIndex: r.regionIndex },
        sBox: l.bbox,
        tBox: r.bbox,
        shared: {
          physicalRows: l.physicalRowIndexes.filter(p => r.physicalRowIndexes.includes(p)).length,
          logicalRows: r.logicalRowIndexes.includes(l.logicalRowIndex) ? 1 : 0,
          rowTokens: { rowTokens: l.rawTokenIndexes.length, shared: sharedTokens, regionTokens: r.tokenIndexes.length },
        },
      });
    }
  }

  const cutoffs = (scale: number) => ({ h: options.horizontalCutoffPageFraction * page.width * scale, v: options.verticalCutoffPitchFactor * medianRowPitch * scale });
  const isCandidate = (p: Pair, scale: number): boolean => {
    const g = relationGeometry(p.sBox, p.tBox);
    const c = cutoffs(scale);
    const sharesTokens = (p.shared.rowTokens?.shared ?? 0) > 0 || (p.source.kind === 'spatial_region' && p.shared.physicalRows > 0);
    return sharesTokens || ((g.horizontalGap === null || g.horizontalGap <= c.h) && (g.verticalGap === null || g.verticalGap <= c.v));
  };
  const pairKey = (p: Pair) => `${keyOf(p.source)}>${keyOf(p.target)}`;

  const sensitivityKeys = new Map<number, Set<string>>();
  for (const s of [1, ...options.sensitivityScales]) sensitivityKeys.set(s, new Set(pairs.filter(p => isCandidate(p, s)).map(pairKey)));
  const defaultKeys = sensitivityKeys.get(1)!;

  const regionByIndex = new Map(regions.map(r => [r.regionIndex, r]));
  const rowByIndex = new Map(rows.map(l => [l.logicalRowIndex, l]));
  const regionAmbiguous = (i: number): boolean => regionByIndex.get(i)?.ambiguity !== undefined;
  const rowAmbiguous = (i: number): boolean => rowByIndex.get(i)?.resolution.kind === 'ambiguous';

  const relations: RegionRelationCandidate[] = pairs
    .filter(p => defaultKeys.has(pairKey(p)))
    .map((p, relationIndex) => {
      const g = relationGeometry(p.sBox, p.tBox);
      const { direction, ...geometry } = g;
      const c = cutoffs(1);
      const evidence: RelationEvidence[] = [];
      if (p.shared.physicalRows > 0) evidence.push({ kind: 'shares_physical_rows', value: p.shared.physicalRows });
      if (p.shared.logicalRows > 0) evidence.push({ kind: 'shares_logical_rows', value: p.shared.logicalRows });
      if (p.shared.rowTokens && p.shared.rowTokens.shared > 0) evidence.push({ kind: 'row_tokens_in_region', value: p.shared.rowTokens });
      evidence.push({ kind: 'within_horizontal_cutoff', value: { gap: geometry.horizontalGap, cutoff: round3(c.h) } });
      evidence.push({ kind: 'within_vertical_cutoff', value: { gap: geometry.verticalGap, cutoff: round3(c.v) } });

      const reasons: string[] = [];
      if (p.source.kind === 'spatial_region' && regionAmbiguous(p.source.regionIndex)) reasons.push('source_region_is_ambiguous');
      if (p.source.kind === 'logical_row' && rowAmbiguous(p.source.logicalRowIndex)) reasons.push('source_logical_row_is_ambiguous');
      if (p.target.kind === 'spatial_region' && regionAmbiguous(p.target.regionIndex)) reasons.push('target_region_is_ambiguous');
      const smaller = Math.min(...options.sensitivityScales);
      if (smaller < 1 && !sensitivityKeys.get(smaller)!.has(pairKey(p))) reasons.push(`candidate_disappears_at_cutoff_x${smaller}`);
      return { relationIndex, source: p.source, target: p.target, direction, geometry, evidence, stability: { stable: true, reasons } };
    });

  // 競合: あるnodeから見て、同じ種類の相手・同じ方向（horizontal, vertical）に2つ以上の候補があるとき、全て残す（winnerを選ばない）
  const side = (r: RegionRelationCandidate, nodeKey: string): string => {
    const flip = keyOf(r.target) === nodeKey;
    const h = r.direction.horizontal === 'overlap' ? 'overlap' : (r.direction.horizontal === 'target_right_of_source') !== flip ? 'right' : 'left';
    const v = r.direction.vertical === 'overlap' ? 'overlap' : (r.direction.vertical === 'target_below_source') !== flip ? 'below' : 'above';
    return `${h}/${v}`;
  };
  const groups = new Map<string, number[]>();
  const isMembership = (r: RegionRelationCandidate) => r.evidence.some(e => e.kind === 'row_tokens_in_region');
  for (const r of relations) {
    if (isMembership(r)) continue;
    for (const node of [r.source, r.target]) {
      const nk = keyOf(node);
      const other = node === r.source ? r.target : r.source;
      const k = `${nk}|${other.kind}|${side(r, nk)}`;
      groups.set(k, [...(groups.get(k) ?? []), r.relationIndex]);
    }
  }
  for (const [k, idxs] of groups) {
    if (idxs.length < 2) continue;
    const [nodeKey, otherKind, sideKey] = k.split('|');
    for (const i of idxs) {
      const r = relations[i];
      const prev = r.ambiguity?.competingRelationIndexes ?? [];
      const merged = [...new Set([...prev, ...idxs.filter(x => x !== i)])].sort((a, b) => a - b);
      r.ambiguity = {
        competingRelationIndexes: merged,
        reason: `multiple candidates from ${nodeKey} to ${otherKind} on the same side (${sideKey}); no nearest winner is selected`,
      };
    }
  }
  for (const r of relations) {
    if (r.ambiguity) r.stability.reasons.push('competing_candidates');
    r.stability.stable = r.stability.reasons.length === 0;
  }

  const unstableReasons: Record<string, number> = {};
  for (const r of relations) for (const reason of r.stability.reasons) unstableReasons[reason] = (unstableReasons[reason] ?? 0) + 1;

  const touchedRegions = new Set<number>();
  const touchedRows = new Set<number>();
  for (const r of relations) for (const n of [r.source, r.target]) n.kind === 'spatial_region' ? touchedRegions.add(n.regionIndex) : touchedRows.add(n.logicalRowIndex);

  return {
    parameters: {
      horizontalCutoffPageFraction: options.horizontalCutoffPageFraction,
      horizontalCutoff: round3(cutoffs(1).h),
      verticalCutoffPitchFactor: options.verticalCutoffPitchFactor,
      verticalCutoff: round3(cutoffs(1).v),
      pageWidth: page.width,
      medianRowPitch,
      sensitivityScales: options.sensitivityScales,
      candidateRule: 'token-sharing pair, or (horizontal gap <= horizontalCutoff and vertical gap <= verticalCutoff); nearest winner is never selected',
      semanticLabels: 'none',
    },
    relations,
    diagnostics: {
      pairCounts: { regionPairs: (regions.length * (regions.length - 1)) / 2, logicalRowRegionPairs: rows.length * regions.length },
      counts: {
        candidateRelations: relations.length,
        regionRegion: relations.filter(r => r.source.kind === 'spatial_region').length,
        logicalRowRegion: relations.filter(r => r.source.kind === 'logical_row').length,
        ambiguousRelations: relations.filter(r => r.ambiguity).length,
        stableRelations: relations.filter(r => r.stability.stable).length,
        unstableRelations: relations.filter(r => !r.stability.stable).length,
      },
      unstableReasons,
      sensitivity: [...sensitivityKeys.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([scale, keys]) => ({
          scale,
          candidateRelations: keys.size,
          added: [...keys].filter(k => !defaultKeys.has(k)).length,
          removed: [...defaultKeys].filter(k => !keys.has(k)).length,
        })),
      isolated: {
        regionIndexes: regions.map(r => r.regionIndex).filter(i => !touchedRegions.has(i)),
        logicalRowIndexes: rows.map(r => r.logicalRowIndex).filter(i => !touchedRows.has(i)),
      },
      unassignedPhysicalRowCountFromSpatialRegion: spatial.unassignedPhysicalRowIndexes.length,
      logicalRowsSpanningMultipleRegions: rows.filter(l => relations.filter(r => r.source.kind === 'logical_row' && r.source.logicalRowIndex === l.logicalRowIndex && r.evidence.some(e => e.kind === 'row_tokens_in_region')).length >= 2).length,
    },
  };
}
