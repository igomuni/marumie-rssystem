import { describe, expect, it } from 'vitest';
import { resolveLogicalRows } from './budget-request-logical-row';
import { detectGutters, detectSpatialRegions, DEFAULT_SPATIAL_REGION_OPTIONS } from './budget-request-spatial-region';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { buildTableGeometry } from './budget-request-table-geometry';

const meta = pageMetaFrom(1, 1, [0, 0, 1200, 900], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const PITCH = 14;

/** baselineTop = ページ上端からのベースライン位置（左上原点） */
function tok(text: string, x: number, baselineTop: number, width = 20, size = FS): SourceToken {
  const item: RawTextItem = { str: text, transform: [size, 0, 0, size, x, 900 - baselineTop], width, height: size, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
}
const index = (ts: SourceToken[]): SourceToken[] => ts.map((t, i) => ({ ...t, index: i }));

/** x位置からcols列、y=y0からrows行（PITCH間隔）の格子 */
function stack(x: number, y0: number, rows: number, cols = 2, colGap = 30, text = 'a', size = FS, pitch = PITCH): SourceToken[] {
  const out: SourceToken[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(tok(text, x + c * colGap, y0 + r * pitch, 20, size));
  return out;
}

function run(tokensIn: SourceToken[]) {
  const tokens = index(tokensIn);
  const geometry = buildTableGeometry(tokens, meta);
  const logical = resolveLogicalRows(tokens, meta, geometry);
  const spatial = detectSpatialRegions(tokens, geometry, logical);
  return { tokens, geometry, logical, spatial };
}

describe('region候補の形成', () => {
  it('近接したsegment群（複数rowの2Dブロック）が1つのregionになる', () => {
    const { spatial } = run(stack(100, 100, 4));
    expect(spatial.regions).toHaveLength(1);
    const r = spatial.regions[0];
    expect(r.physicalRowIndexes).toEqual([0, 1, 2, 3]);
    expect(r.geometry).toMatchObject({ tokenCount: 8, physicalRowCount: 4, segmentCount: 4 });
    expect(spatial.unassignedTokenIndexes).toEqual([]);
  });

  it('大きなhorizontal gutterでregionが分かれる（同じy帯でも無条件にmergeしない）', () => {
    const { spatial } = run([...stack(100, 100, 3), ...stack(700, 100, 3)]);
    expect(spatial.gutters).toHaveLength(1);
    expect(spatial.gutters[0].width).toBeGreaterThan(spatial.parameters.gutter.minWidth);
    expect(spatial.regions).toHaveLength(2);
    expect(spatial.regions.map(r => r.evidence.xBand)).toEqual([0, 1]);
    expect(spatial.regions[0].bbox.xMax).toBeLessThan(spatial.regions[1].bbox.xMin);
    expect(spatial.regions[1].evidence.xBandRange[0]).toBe(spatial.gutters[0].xMax);
  });

  it('大きなvertical gapでregionが分かれる。x overlapがあってもyが十分離れていればmergeしない', () => {
    const { spatial } = run([...stack(100, 100, 3), ...stack(100, 400, 3)]);
    expect(spatial.regions).toHaveLength(2);
    expect(spatial.regions[0].physicalRowIndexes).toEqual([0, 1, 2]);
    expect(spatial.regions[1].physicalRowIndexes).toEqual([3, 4, 5]);
    expect(spatial.regions[0].bbox.yMax).toBeLessThan(spatial.regions[1].bbox.yMin);
  });

  it('yが近くてもxが十分離れていて接続evidenceが無ければ無条件にmergeしない（gutterなしでもproximity外）', () => {
    // 同じrow上の2つのstack。水平距離 = 5×fontSize(34.7)を超えるが gutter(3×fs=20.8)は小さい列間隔ではない配置
    const { spatial } = run([...stack(100, 100, 3, 1), ...stack(100 + 20 + 40, 100, 3, 1)]);
    expect(spatial.regions.length).toBe(2);
  });

  it('孤立したsegment（physical rowがminRows未満）はunassignedとして追跡され、どのregionにも入らない', () => {
    const lone = tok('孤', 600, 500);
    const { tokens, spatial } = run([...stack(100, 100, 3), lone]);
    expect(spatial.regions).toHaveLength(1);
    const loneIndex = tokens.findIndex(t => t.rawText === '孤');
    expect(spatial.unassignedTokenIndexes).toEqual([loneIndex]);
    expect(spatial.unassignedPhysicalRowIndexes).toHaveLength(1);
    expect(spatial.regions[0].tokenIndexes).not.toContain(loneIndex);
    expect(spatial.diagnostics.counts).toMatchObject({ unassignedTokenCount: 1 });
  });

  it('空白tokenはregionの対象外（nonRowTokenIndexes）', () => {
    const { tokens, spatial } = run([...stack(100, 100, 3), tok(' ', 130, 100, 50, 0)]);
    const ws = tokens.findIndex(t => t.rawText === ' ');
    expect(spatial.nonRowTokenIndexes).toEqual([ws]);
    expect(spatial.regions.flatMap(r => r.tokenIndexes)).not.toContain(ws);
  });
});

describe('しきい値（相対値）', () => {
  it('縦方向の境界: 距離 == verticalPitchFactor×median pitch は接続、わずかに超えると分離', () => {
    // 3行（pitch 14）の下に、距離dだけ離れた3行。median pitch=14 なので 2.0×14=28 が境界
    const at = (d: number) => run([...stack(100, 100, 3), ...stack(100, 100 + 2 * PITCH + d, 3)]).spatial;
    expect(at(2 * PITCH).parameters.proximity.verticalDistance).toBe(28);
    expect(at(2 * PITCH).regions).toHaveLength(1); // 28 == 2×14
    expect(at(2 * PITCH + 0.5).regions).toHaveLength(2); // 28.5 > 28
  });

  it('fontSizeとレイアウトを同率で拡大しても同じ構造になる（ページ由来の相対しきい値）', () => {
    const layout = (k: number) => {
      const ts = [...stack(100 * k, 100 * k, 3, 2, 30 * k, 'a', FS * k, PITCH * k), ...stack(500 * k, 100 * k, 3, 2, 30 * k, 'a', FS * k, PITCH * k)];
      return run(ts).spatial;
    };
    const a = layout(1);
    const b = layout(1.5);
    expect(b.regions).toHaveLength(a.regions.length);
    expect(b.regions.map(r => r.physicalRowIndexes)).toEqual(a.regions.map(r => r.physicalRowIndexes));
    expect(b.parameters.referenceFontSize).toBeCloseTo(a.parameters.referenceFontSize * 1.5, 2);
  });

  it('しきい値・定義・方式をparametersに残す（意味ラベルなし）', () => {
    const { spatial } = run(stack(100, 100, 3));
    expect(spatial.parameters).toMatchObject({
      referenceFontSize: FS,
      gutter: { factor: 3, minWidth: 20.832 },
      proximity: { horizontalFactor: DEFAULT_SPATIAL_REGION_OPTIONS.proximity.horizontalFactor, verticalPitchFactor: DEFAULT_SPATIAL_REGION_OPTIONS.proximity.verticalPitchFactor },
      minRows: 2,
      regionsAreDisjoint: true,
      semanticLabels: 'none',
    });
    expect(spatial.parameters.medianRowPitch).toBe(PITCH);
  });

  it('detectGutters: 被覆が途切れる空白帯のうち minWidth 以上だけを返す', () => {
    const ts = index([tok('a', 10, 100, 10), tok('b', 40, 100, 10), tok('c', 200, 100, 10)]);
    expect(detectGutters(ts, [0, 1, 2], 30)).toEqual([{ xMin: 50, xMax: 200, width: 150 }]);
    expect(detectGutters(ts, [0, 1, 2], 20)).toEqual([{ xMin: 20, xMax: 40, width: 20 }, { xMin: 50, xMax: 200, width: 150 }]);
  });
});

describe('可逆性・参照・非破壊', () => {
  const build = () => [...stack(100, 100, 4), ...stack(700, 100, 3), tok('孤', 400, 600)];

  it('SourceToken / TableGeometry / LogicalRowResult を変更しない', () => {
    const tokens = index(build());
    const geometry = buildTableGeometry(tokens, meta);
    const logical = resolveLogicalRows(tokens, meta, geometry);
    const before = JSON.stringify([tokens, geometry, logical]);
    detectSpatialRegions(tokens, geometry, logical);
    expect(JSON.stringify([tokens, geometry, logical])).toBe(before);
  });

  it('token・physical row・logical rowへ戻れ、tokenはregion/unassigned/nonRowのどれか1つに属する（disjoint）', () => {
    const { tokens, geometry, logical, spatial } = run(build());
    const all = [...spatial.regions.flatMap(r => r.tokenIndexes), ...spatial.unassignedTokenIndexes, ...spatial.nonRowTokenIndexes].sort((a, b) => a - b);
    expect(all).toEqual(tokens.map(t => t.index)); // 完全性 + 重複なし
    for (const r of spatial.regions) {
      for (const i of r.tokenIndexes) expect(tokens[i]).toBeDefined();
      for (const p of r.physicalRowIndexes) expect(geometry.physicalRows[p]).toBeDefined();
      for (const l of r.logicalRowIndexes) expect(logical.logicalRowCandidates[l]).toBeDefined();
      for (const ref of r.segments) expect(logical.logicalRowCandidates.flatMap(c => c.segments).some(s => s.physicalRowIndex === ref.physicalRowIndex && s.segmentIndex === ref.segmentIndex)).toBe(true);
    }
  });

  it('region bboxは構成tokenのbboxのunion（再計算できる）', () => {
    const { tokens, spatial } = run(build());
    for (const r of spatial.regions) {
      const boxes = r.tokenIndexes.map(i => tokens[i].bbox);
      expect(r.bbox).toEqual({
        xMin: Math.min(...boxes.map(b => b.xMin)),
        yMin: Math.min(...boxes.map(b => b.yMin)),
        xMax: Math.max(...boxes.map(b => b.xMax)),
        yMax: Math.max(...boxes.map(b => b.yMax)),
      });
    }
  });

  it('semantic labelを持たない（出力にregionType等のキーが無い）', () => {
    const { spatial } = run(build());
    const json = JSON.stringify(spatial);
    for (const k of ['regionType', 'core', 'remark', 'matter', 'amount', 'request_summary', 'breakdown_table', 'staffing_table', 'columnName', 'text']) {
      expect(json).not.toContain(`"${k}"`);
    }
  });
});

describe('文字内容に依存しない / LogicalRowCandidateがambiguousでも動く', () => {
  it('同じ幾何で文字列だけ変えても、region構造は同一（rawTextを判定に使わない）', () => {
    const make = (texts: string[]) => {
      const ts = [...stack(100, 100, 3, 2, 30, texts[0]), ...stack(700, 100, 3, 2, 30, texts[1])];
      return run(ts).spatial.regions.map(r => ({ rows: r.physicalRowIndexes, tokens: r.tokenIndexes, bbox: r.bbox }));
    };
    expect(make(['01-95', '（要求要旨）'])).toEqual(make(['zzz', 'qqq']));
    expect(make(['@', '備考'])).toEqual(make(['x', 'y']));
  });

  it('LogicalRowCandidateにambiguousがあっても、region detectorは動き、logicalRowIndexesはregionをまたぎうる', () => {
    // 字下げの違う近接行（LogicalRowResolverはambiguousにする）を含む
    const ts = [tok('一行目', 90, 100), tok('字下げ', 140, 100 + FS), tok('三行目', 90, 100 + 2 * PITCH)];
    const { logical, spatial } = run(ts);
    expect(logical.logicalRowCandidates.some(c => c.resolution.kind === 'ambiguous')).toBe(true);
    expect(spatial.regions.length + (spatial.unassignedPhysicalRowIndexes.length > 0 ? 1 : 0)).toBeGreaterThan(0);
    for (const r of spatial.regions) expect(r.logicalRowIndexes.length).toBeGreaterThan(0);
  });
});
