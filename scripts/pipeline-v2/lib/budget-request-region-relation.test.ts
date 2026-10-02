import { describe, expect, it } from 'vitest';
import type { LogicalRowCandidate, LogicalRowResult } from './budget-request-logical-row';
import { resolveLogicalRows } from './budget-request-logical-row';
import { relationGeometry, resolveRegionRelations, type RegionRelationCandidate } from './budget-request-region-relation';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken, type SourceTokenBBox } from './budget-request-source-token';
import { detectSpatialRegions, type SpatialRegionCandidate, type SpatialRegionResult } from './budget-request-spatial-region';
import { buildTableGeometry } from './budget-request-table-geometry';

const page = pageMetaFrom(1, 1, [0, 0, 800, 600], 0);
const PITCH = 14; // 垂直cutoff = 2.0 × 14 = 28pt、水平cutoff = 0.4 × 800 = 320pt

const box = (xMin: number, yMin: number, xMax: number, yMax: number): SourceTokenBBox => ({ xMin, yMin, xMax, yMax });

function region(regionIndex: number, bbox: SourceTokenBBox, o: Partial<SpatialRegionCandidate> = {}): SpatialRegionCandidate {
  return {
    regionIndex,
    tokenIndexes: [regionIndex * 100, regionIndex * 100 + 1],
    physicalRowIndexes: [regionIndex * 10],
    logicalRowIndexes: [regionIndex * 10],
    segments: [],
    bbox,
    geometry: { width: bbox.xMax - bbox.xMin, height: bbox.yMax - bbox.yMin, tokenCount: 2, segmentCount: 1, physicalRowCount: 1, logicalRowCount: 1 },
    evidence: { xBand: 0, xBandRange: [0, null], edgeCount: 0, maxVerticalDistance: 0, maxHorizontalGap: 0 },
    ...o,
  };
}
function row(logicalRowIndex: number, bbox: SourceTokenBBox, o: Partial<LogicalRowCandidate> = {}): LogicalRowCandidate {
  return {
    logicalRowIndex,
    physicalRowIndexes: [900 + logicalRowIndex],
    rawTokenIndexes: [900 + logicalRowIndex],
    visualTokenIndexes: [900 + logicalRowIndex],
    bbox,
    segments: [],
    resolution: { kind: 'same_physical_row', evidence: {} },
    ...o,
  };
}
const stubs = (rows: LogicalRowCandidate[], regions: SpatialRegionCandidate[]) => ({
  logical: { logicalRowCandidates: rows } as unknown as LogicalRowResult,
  spatial: { regions, parameters: { medianRowPitch: PITCH }, unassignedPhysicalRowIndexes: [] } as unknown as SpatialRegionResult,
});
const resolve = (rows: LogicalRowCandidate[], regions: SpatialRegionCandidate[]) => {
  const { logical, spatial } = stubs(rows, regions);
  return resolveRegionRelations(page, logical, spatial);
};
const find = (rels: RegionRelationCandidate[], s: RegionRelationCandidate['source'], t: RegionRelationCandidate['target']) =>
  rels.find(r => JSON.stringify(r.source) === JSON.stringify(s) && JSON.stringify(r.target) === JSON.stringify(t));
const R = (regionIndex: number) => ({ kind: 'spatial_region' as const, regionIndex });
const L = (logicalRowIndex: number) => ({ kind: 'logical_row' as const, logicalRowIndex });

describe('relationGeometry（bboxから再計算できる幾何）', () => {
  it('水平方向: targetが右 → target_right_of_source、gap・overlapなし', () => {
    const g = relationGeometry(box(0, 0, 100, 10), box(150, 0, 200, 10));
    expect(g.direction).toEqual({ horizontal: 'target_right_of_source', vertical: 'overlap' });
    expect(g).toMatchObject({ horizontalGap: 50, xOverlap: 0, xOverlapRatio: 0, verticalGap: null, yOverlap: 10, yOverlapRatio: 1, centerDx: 125, centerDy: 0 });
  });
  it('targetが左・下・x/yが重なる場合の方向・overlap・ratio', () => {
    const left = relationGeometry(box(100, 0, 200, 10), box(0, 40, 60, 50));
    expect(left.direction).toEqual({ horizontal: 'target_left_of_source', vertical: 'target_below_source' });
    expect(left).toMatchObject({ horizontalGap: 40, verticalGap: 30 });
    const above = relationGeometry(box(0, 100, 100, 110), box(50, 0, 80, 20));
    expect(above.direction.vertical).toBe('target_above_source');
    expect(above).toMatchObject({ xOverlap: 30, xOverlapRatio: 1, horizontalGap: null, verticalGap: 80 }); // 狭い方（幅30）に対する割合
    const part = relationGeometry(box(0, 0, 100, 10), box(80, 5, 300, 30));
    expect(part).toMatchObject({ xOverlap: 20, xOverlapRatio: 0.2, yOverlap: 5, yOverlapRatio: 0.5 });
  });
});

describe('relation candidateの生成（方向・cutoff）', () => {
  it('region↔region: sourceはregionIndexの小さい側で、方向がdirectionで分かる', () => {
    const { relations } = resolve([], [region(0, box(0, 100, 100, 130)), region(1, box(200, 100, 300, 130))]);
    expect(relations).toHaveLength(1);
    expect(relations[0].source).toEqual(R(0));
    expect(relations[0].target).toEqual(R(1));
    expect(relations[0].direction).toEqual({ horizontal: 'target_right_of_source', vertical: 'overlap' });
    expect(relations[0].geometry.horizontalGap).toBe(100);
  });

  it('logical row → region: regionがrowの右側 / 直下 の方向を観測する', () => {
    const rows = [row(0, box(0, 100, 100, 110))];
    const right = resolve(rows, [region(0, box(150, 100, 250, 110))]).relations[0];
    expect(right.source).toEqual(L(0));
    expect(right.direction).toEqual({ horizontal: 'target_right_of_source', vertical: 'overlap' });
    const below = resolve(rows, [region(0, box(0, 120, 100, 150))]).relations[0];
    expect(below.direction).toEqual({ horizontal: 'overlap', vertical: 'target_below_source' });
    expect(below.geometry).toMatchObject({ verticalGap: 10, xOverlap: 100 });
  });

  it('距離cutoff: 水平(ページ幅×0.4=320)・垂直(2.0×pitch=28)を超えるpairは候補にならない。境界は含む', () => {
    const rows = [row(0, box(0, 100, 100, 110))];
    expect(resolve(rows, [region(0, box(420, 100, 500, 110))]).relations).toHaveLength(1); // gap 320 == cutoff
    expect(resolve(rows, [region(0, box(420.5, 100, 500, 110))]).relations).toHaveLength(0);
    expect(resolve(rows, [region(0, box(0, 138, 100, 150))]).relations).toHaveLength(1); // gap 28 == cutoff
    expect(resolve(rows, [region(0, box(0, 138.5, 100, 150))]).relations).toHaveLength(0);
  });

  it('logical rowのtokenを持つregionは、距離に関係なく所属のevidence付きで候補になる', () => {
    const r0 = region(0, box(0, 100, 100, 110), { tokenIndexes: [901] });
    const rel = resolve([row(0, box(0, 500, 100, 510), { rawTokenIndexes: [901] })], [r0]).relations[0];
    expect(rel.evidence.find(e => e.kind === 'row_tokens_in_region')).toMatchObject({ value: { rowTokens: 1, shared: 1, regionTokens: 1 } });
  });

  it('SourceTokenを複製せず、既存indexへ戻れる参照だけを持つ', () => {
    const { relations } = resolve([row(3, box(0, 100, 100, 110))], [region(2, box(150, 100, 250, 110))]);
    expect(relations[0].source).toEqual({ kind: 'logical_row', logicalRowIndex: 3 });
    expect(relations[0].target).toEqual({ kind: 'spatial_region', regionIndex: 2 });
    expect(JSON.stringify(relations)).not.toContain('rawText');
  });
});

describe('複数候補・ambiguity（nearest winnerを作らない）', () => {
  const rows = [row(0, box(0, 100, 100, 110))];
  const two = [region(0, box(150, 100, 250, 110)), region(1, box(300, 100, 400, 110))];

  it('同じ側に複数のregion候補があれば全て残し、互いをcompetingとして記録する（近い方を選ばない）', () => {
    const { relations } = resolve(rows, two);
    const near = find(relations, L(0), R(0))!;
    const far = find(relations, L(0), R(1))!;
    expect(near.ambiguity?.competingRelationIndexes).toEqual([far.relationIndex]);
    expect(far.ambiguity?.competingRelationIndexes).toEqual([near.relationIndex]);
    expect(near.ambiguity?.reason).toContain('no nearest winner');
    expect(near.stability.reasons).toContain('competing_candidates');
    expect(near.stability.stable).toBe(false);
    expect(far.stability.stable).toBe(false);
  });

  it('候補が1つだけなら競合なし（stable）', () => {
    const rel = resolve(rows, [two[0]]).relations[0];
    expect(rel.ambiguity).toBeUndefined();
    expect(rel.stability).toEqual({ stable: true, reasons: [] });
  });

  it('rowが複数regionにtokenを持つ（所属の事実）はcompetingにしない。複数regionにまたがることはdiagnosticsに出る', () => {
    const r0 = region(0, box(0, 100, 100, 110), { tokenIndexes: [901] });
    const r1 = region(1, box(300, 100, 400, 110), { tokenIndexes: [902] });
    const { relations, diagnostics } = resolve([row(0, box(0, 100, 400, 110), { rawTokenIndexes: [901, 902] })], [r0, r1]);
    expect(relations.filter(r => r.source.kind === 'logical_row').every(r => r.ambiguity === undefined)).toBe(true);
    expect(diagnostics.logicalRowsSpanningMultipleRegions).toBe(1);
  });
});

describe('stability（regionの安定性とは別に観測）と閾値感度', () => {
  it('ambiguousなsource/target region・logical rowはunstable（reasonを列挙）', () => {
    const amb = { reason: 'splits at x0.8' };
    const { relations } = resolve(
      [row(0, box(0, 100, 100, 110), { resolution: { kind: 'ambiguous', evidence: {} } })],
      [region(0, box(150, 100, 250, 110), { ambiguity: amb }), region(1, box(0, 300, 100, 310), { ambiguity: amb })],
    );
    const rr = find(relations, R(0), R(1));
    expect(rr).toBeUndefined(); // 垂直に遠い
    const rel = find(relations, L(0), R(0))!;
    expect(rel.stability.reasons).toEqual(expect.arrayContaining(['source_logical_row_is_ambiguous', 'target_region_is_ambiguous']));
    const both = resolve([], [region(0, box(0, 100, 100, 110), { ambiguity: amb }), region(1, box(150, 100, 250, 110), { ambiguity: amb })]).relations[0];
    expect(both.stability.reasons).toEqual(['source_region_is_ambiguous', 'target_region_is_ambiguous']);
  });

  it('regionがstableでも、cutoffを0.8倍にすると候補から外れるrelationはunstable', () => {
    // 水平gap = 300（cutoff 320 の範囲内、0.8×320=256 の外）
    const { relations, diagnostics } = resolve([row(0, box(0, 100, 100, 110))], [region(0, box(400, 100, 500, 110))]);
    expect(relations).toHaveLength(1);
    expect(relations[0].stability).toEqual({ stable: false, reasons: ['candidate_disappears_at_cutoff_x0.8'] });
    expect(diagnostics.sensitivity).toEqual([
      { scale: 0.8, candidateRelations: 0, added: 0, removed: 1 },
      { scale: 1, candidateRelations: 1, added: 0, removed: 0 },
      { scale: 1.25, candidateRelations: 1, added: 0, removed: 0 },
    ]);
  });

  it('cutoffを1.25倍にすると新たに現れる候補を diagnostics に数える（出力relationには入れない）', () => {
    const { relations, diagnostics } = resolve([row(0, box(0, 100, 100, 110))], [region(0, box(480, 100, 560, 110))]); // gap 380: 320外、400内
    expect(relations).toHaveLength(0);
    expect(diagnostics.sensitivity.find(s => s.scale === 1.25)).toMatchObject({ candidateRelations: 1, added: 1, removed: 0 });
  });

  it('診断カウント（pair数・候補数・stable/ambiguous）', () => {
    const rows = [row(0, box(0, 100, 100, 110))];
    const { diagnostics } = resolve(rows, [region(0, box(150, 100, 250, 110)), region(1, box(300, 100, 400, 110))]);
    expect(diagnostics.pairCounts).toEqual({ regionPairs: 1, logicalRowRegionPairs: 2 });
    expect(diagnostics.counts).toMatchObject({ candidateRelations: 3, regionRegion: 1, logicalRowRegion: 2, ambiguousRelations: 2 }); // row→region 2件が競合。region→regionは種類の違う相手との関係なので競合に含まれない
    expect(diagnostics.counts.stableRelations + diagnostics.counts.unstableRelations).toBe(3);
  });
});

describe('非破壊・semantic labelなし・決定性', () => {
  const build = () => {
    const rows = [row(0, box(0, 100, 100, 110)), row(1, box(0, 115, 100, 125))];
    const regions = [region(0, box(150, 100, 250, 130)), region(1, box(300, 100, 400, 130), { ambiguity: { reason: 'x' } })];
    return { rows, regions };
  };

  it('入力のLogicalRowResult / SpatialRegionResultを変更しない（書き込まない）', () => {
    const { rows, regions } = build();
    const { logical, spatial } = stubs(rows, regions);
    const before = JSON.stringify([logical, spatial]);
    resolveRegionRelations(page, logical, spatial);
    expect(JSON.stringify([logical, spatial])).toBe(before);
    expect(JSON.stringify(regions)).not.toContain('relatedTo');
  });

  it('semantic label（regionType/core/remark/request_summary/matter/amount等）を持たない', () => {
    const { rows, regions } = build();
    const json = JSON.stringify(resolve(rows, regions));
    for (const k of ['regionType', 'core', 'auxiliary', 'remark', 'request_summary', 'breakdown_table', 'staffing_table', 'matter', 'amount', 'columnName', 'rawText']) {
      expect(json).not.toContain(`"${k}"`);
    }
    expect(resolve(rows, regions).parameters.semanticLabels).toBe('none');
  });

  it('決定的: 同じ入力で同じ出力。relationIndexは (region-region → logical row-region) の順で、indexの昇順', () => {
    const { rows, regions } = build();
    const a = resolve(rows, regions);
    const b = resolve(rows, regions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.relations.map(r => r.relationIndex)).toEqual(a.relations.map((_, i) => i));
    const kinds = a.relations.map(r => r.source.kind);
    expect(kinds).toEqual([...kinds].sort((x, y) => (x === y ? 0 : x === 'spatial_region' ? -1 : 1)));
    const rowRegion = a.relations.filter(r => r.source.kind === 'logical_row');
    expect(rowRegion.map(r => [(r.source as { logicalRowIndex: number }).logicalRowIndex, (r.target as { regionIndex: number }).regionIndex])).toEqual(
      [...rowRegion.map(r => [(r.source as { logicalRowIndex: number }).logicalRowIndex, (r.target as { regionIndex: number }).regionIndex])].sort((x, y) => x[0] - y[0] || x[1] - y[1]),
    );
  });
});

describe('rawTextに依存しない（SourceTokenからのpipeline全体）', () => {
  const meta = pageMetaFrom(1, 1, [0, 0, 1200, 900], 0);
  const styles = { f1: { ascent: 0.859, descent: -0.141 } };
  function tok(text: string, x: number, baselineTop: number): SourceToken {
    const item: RawTextItem = { str: text, transform: [6.944, 0, 0, 6.944, x, 900 - baselineTop], width: 20, height: 6.944, fontName: 'f1', hasEOL: false, dir: 'ltr' };
    return toSourceToken(item, 0, meta, styles);
  }
  const layout = (a: string, b: string) => {
    const ts: SourceToken[] = [];
    for (const y of [100, 114, 128]) ts.push(tok(a, 100, y), tok(a, 130, y), tok(b, 700, y), tok(b, 730, y));
    return ts.map((t, i) => ({ ...t, index: i }));
  };
  const relations = (tokens: SourceToken[]) => {
    const g = buildTableGeometry(tokens, meta);
    const l = resolveLogicalRows(tokens, meta, g);
    const s = detectSpatialRegions(tokens, g, l);
    return resolveRegionRelations(meta, l, s);
  };

  it('文字列だけを変えてもrelation構造は同一', () => {
    expect(JSON.stringify(relations(layout('01-95', '（要求要旨）')))).toBe(JSON.stringify(relations(layout('zzz', 'qqq'))));
    expect(relations(layout('@', '備考')).relations.length).toBeGreaterThan(0);
  });
});
