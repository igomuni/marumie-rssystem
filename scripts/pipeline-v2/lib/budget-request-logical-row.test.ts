import { describe, expect, it } from 'vitest';
import { baselineSpanOf, DEFAULT_LOGICAL_ROW_OPTIONS, resolveLogicalRows, segmentPhysicalRow } from './budget-request-logical-row';
import { buildTableGeometry, clusterPhysicalRows } from './budget-request-table-geometry';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';

const meta = pageMetaFrom(1, 1, [0, 0, 842, 595], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;

/** baselineTop = ページ上端からのベースライン位置（左上原点）。widthを省略すると文字数×fontSize */
function tok(text: string, x: number, baselineTop: number, width?: number, size = FS): SourceToken {
  const item: RawTextItem = { str: text, transform: [size, 0, 0, size, x, 595 - baselineTop], width: width ?? text.length * size, height: size, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
}
const index = (ts: SourceToken[]): SourceToken[] => ts.map((t, i) => ({ ...t, index: i }));
const run = (ts: SourceToken[]) => {
  const tokens = index(ts);
  const geometry = buildTableGeometry(tokens, meta);
  return { tokens, geometry, result: resolveLogicalRows(tokens, meta, geometry) };
};

describe('segmentPhysicalRow（水平分割: geometryのみ）', () => {
  it('大きなx-gapで左右を別segmentに分け、小さなgapでは分けない', () => {
    const ts = index([tok('甲', 40, 100), tok('乙', 49, 100), tok('丙', 400, 100), tok('丁', 600, 100)]);
    const row = clusterPhysicalRows(ts, meta).rows[0];
    const segs = segmentPhysicalRow(row, ts, FS);
    expect(segs.map(s => s.rawTokenIndexes)).toEqual([[0, 1], [2], [3]]);
    expect(segs[1].gapBefore).toBeGreaterThan(2.5 * FS);
    expect(segs[0]).toMatchObject({ segmentIndex: 0, physicalRowIndex: row.rowIndex });
    expect(segs[0].gapBefore).toBeUndefined();
    expect(segs[2].gapAfter).toBeUndefined();
  });

  it('gap境界: gap == gapFactor×fontSize は同一segment、わずかに超えると別segment', () => {
    const limit = 2.5 * FS;
    const make = (extra: number) => index([tok('a', 10, 100, 5), tok('b', 15 + limit + extra, 100, 5)]);
    for (const [extra, n] of [[0, 1], [0.01, 2]] as const) {
      const ts = make(extra);
      expect(segmentPhysicalRow(clusterPhysicalRows(ts, meta).rows[0], ts, FS)).toHaveLength(n);
    }
  });

  it('raw orderとvisual-x orderを別に持つ（金額chunkの逆順。結合はしない）', () => {
    const ts = index([tok('916', 245.021, 100, 10.4), tok('599,', 232.942, 100, 13.9), tok('234,', 220.864, 100, 13.9)]);
    const [seg] = segmentPhysicalRow(clusterPhysicalRows(ts, meta).rows[0], ts, FS);
    expect(seg.rawTokenIndexes).toEqual([0, 1, 2]);
    expect(seg.visualTokenIndexes).toEqual([2, 1, 0]);
    expect(Object.keys(seg)).not.toContain('text');
  });

  it('同じbaseline上の左右独立構造を1つのsegmentへcollapseしない', () => {
    const ts = index([tok('01-95', 65, 100), tok('事項名', 90, 100), tok('（要旨）', 500, 100), tok('本文', 540, 100)]);
    const segs = segmentPhysicalRow(clusterPhysicalRows(ts, meta).rows[0], ts, FS);
    expect(segs.length).toBe(2);
    expect(segs[0].bbox.xMax).toBeLessThan(segs[1].bbox.xMin);
  });
});

describe('resolveLogicalRows: continuation / non-continuation / ambiguous', () => {
  it('近接（dy=1行）かつ開始位置が揃う → continuation_by_geometry（physical rowを可逆に保持）', () => {
    const { result } = run([tok('事項名の前半', 90, 100), tok('金額', 300, 100), tok('後半', 90, 100 + FS)]);
    expect(result.logicalRowCandidates).toHaveLength(1);
    const c = result.logicalRowCandidates[0];
    expect(c.resolution.kind).toBe('continuation_by_geometry');
    expect(c.physicalRowIndexes).toEqual([0, 1]);
    expect(c.resolution.evidence.vertical).toMatchObject({ previousPhysicalRowIndex: 0, dy: FS, withinContinuationRange: true });
    expect(c.resolution.evidence.alignment?.every(a => a.alignedToTokenIndex !== undefined)).toBe(true);
  });

  it('同じ位置で行間が通常の行ピッチ（2行分）なら別の論理行候補（merge しない）', () => {
    const { result } = run([tok('一行目', 90, 100), tok('二行目', 90, 100 + 2 * FS)]);
    expect(result.logicalRowCandidates.map(c => c.resolution.kind)).toEqual(['same_physical_row', 'same_physical_row']);
  });

  it('yが近くても開始位置が揃わない（indentが異なる）→ ambiguous（merge しない）。理由と計測値をevidenceに残す', () => {
    const { result } = run([tok('一行目', 90, 100), tok('字下げ', 140, 100 + FS)]);
    const [a, b] = result.logicalRowCandidates;
    expect(a.resolution.kind).toBe('same_physical_row');
    expect(b.resolution.kind).toBe('ambiguous');
    expect(b.resolution.evidence).toMatchObject({ possibleContinuationOfLogicalRow: 0 });
    expect(b.resolution.evidence.reason).toContain('not aligned');
    expect(b.physicalRowIndexes).toEqual([1]);
    expect(result.diagnostics.ambiguousContinuations).toEqual([expect.objectContaining({ logicalRowIndex: 1, physicalRowIndex: 1, previousPhysicalRowIndex: 0 })]);
  });

  it('一部のsegmentだけ揃う（左は継続に見えるが右は別構造）→ 無条件にmergeせず ambiguous', () => {
    const { result } = run([tok('事項', 90, 100), tok('右の独立構造', 500, 100), tok('続き', 90, 100 + FS), tok('別の表', 620, 100 + FS)]);
    const c = result.logicalRowCandidates[1];
    expect(c.resolution.kind).toBe('ambiguous');
    expect(c.resolution.evidence.alignment?.map(a => a.alignedToTokenIndex !== undefined)).toEqual([true, false]);
  });

  it('罫線文字を含む行（表のグリッド）は縦が近くてもmergeしない', () => {
    const { result } = run([tok('│', 40, 100, 3), tok('項目', 50, 100), tok('│', 40, 100 + FS, 3), tok('項目', 50, 100 + FS)]);
    expect(result.logicalRowCandidates.map(c => c.resolution.kind)).toEqual(['same_physical_row', 'ambiguous']);
    expect(result.logicalRowCandidates[1].resolution.evidence.reason).toContain('ruled_grid_row');
  });

  it('縦が半行（0.5行）以下の近接は継続範囲外でmergeしない', () => {
    const { result } = run([tok('見出し', 90, 100), tok('見出し2', 90, 100 + FS / 2)]);
    expect(result.logicalRowCandidates).toHaveLength(2);
  });

  it('継続は連鎖できる（3行折り返し）', () => {
    const { result } = run([tok('一', 90, 100), tok('二', 90, 100 + FS), tok('三', 90, 100 + 2 * FS)]);
    expect(result.logicalRowCandidates).toHaveLength(1);
    expect(result.logicalRowCandidates[0].physicalRowIndexes).toEqual([0, 1, 2]);
  });

  it('ColumnBandはevidence（columnBandEvidence）として記録するだけで、判定には使わない', () => {
    const { result } = run([tok('一', 90, 100), tok('二', 90, 100 + FS)]);
    const a = result.logicalRowCandidates[0].resolution.evidence.alignment![0];
    expect(a).toHaveProperty('columnBandEvidence');
    expect(result.parameters.continuation.columnBandUsage).toContain('not used for the decision');
  });
});

describe('可逆性・非破壊・参照', () => {
  const ts = [tok('916', 245, 100, 10.4), tok('599,', 233, 100, 13.9), tok('234,', 221, 100, 13.9), tok('次の行', 245, 100 + FS)];

  it('SourceTokenとTableGeometry結果をresolverは変更しない', () => {
    const tokens = index(ts);
    const geometry = buildTableGeometry(tokens, meta);
    const before = JSON.stringify([tokens, geometry]);
    resolveLogicalRows(tokens, meta, geometry);
    expect(JSON.stringify([tokens, geometry])).toBe(before);
  });

  it('candidateから元のphysical row・SourceTokenへ辿れ、physical rowはちょうど1つのcandidateに属する', () => {
    const { tokens, geometry, result } = run(ts);
    const seen: number[] = [];
    for (const c of result.logicalRowCandidates) {
      for (const pi of c.physicalRowIndexes) {
        seen.push(pi);
        const row = geometry.physicalRows[pi];
        expect(row).toBeDefined();
        for (const ti of row.rawTokenIndexes) expect(c.rawTokenIndexes).toContain(ti);
      }
      for (const i of [...c.rawTokenIndexes, ...c.visualTokenIndexes]) expect(tokens[i]).toBeDefined();
    }
    expect(seen.sort()).toEqual(geometry.physicalRows.map(r => r.rowIndex));
  });

  it('raw order（index昇順）とvisual-x order（physical row順の連結）を混同しない。金額文字列を作らない', () => {
    const { result } = run(ts.slice(0, 3));
    const c = result.logicalRowCandidates[0];
    expect(c.rawTokenIndexes).toEqual([0, 1, 2]);
    expect(c.visualTokenIndexes).toEqual([2, 1, 0]);
    const json = JSON.stringify(result);
    expect(json).not.toContain('234,599,916');
    for (const k of ['text', 'requestNumber', 'matter', 'previousBudget', 'requestAmount', 'difference', 'regionType', 'columnName']) {
      expect(json).not.toContain(`"${k}"`);
    }
  });

  it('candidate bboxはconstituent physical rowのbbox和集合', () => {
    const { geometry, result } = run([tok('一', 90, 100), tok('二', 90, 100 + FS)]);
    const c = result.logicalRowCandidates[0];
    const rows = geometry.physicalRows;
    expect(c.bbox.yMin).toBe(Math.min(...rows.map(r => r.bbox.yMin)));
    expect(c.bbox.yMax).toBe(Math.max(...rows.map(r => r.bbox.yMax)));
  });

  it('しきい値は相対値で、algorithm・基準・定義をparametersに残す', () => {
    const { result } = run([tok('一', 90, 100)]);
    expect(result.parameters.horizontalSegmentation).toMatchObject({ gapFactor: 2.5, referenceFontSize: FS, gap: 17.36 });
    expect(result.parameters.continuation).toMatchObject({
      verticalGapFactorMin: DEFAULT_LOGICAL_ROW_OPTIONS.continuation.verticalGapFactorMin,
      verticalGapFactorMax: DEFAULT_LOGICAL_ROW_OPTIONS.continuation.verticalGapFactorMax,
      alignmentToleranceFactor: 0.25,
    });
  });
});

describe('TableGeometry single-linkage chainingの診断', () => {
  // A=100.0, B=101.5, C=103.0: 隣同士のgap 1.5 <= tolerance(1.736) なので1つのphysical rowになるが、A-Cは3.0pt離れる
  const chain = [tok('A', 10, 100.0), tok('B', 60, 101.5), tok('C', 110, 103.0), tok('D', 10, 200)];

  it('physical row内のbaseline spanがTableGeometry toleranceを超えるrowを検出できる', () => {
    const { geometry, result } = run(chain);
    expect(geometry.physicalRows[0].rawTokenIndexes).toEqual([0, 1, 2]); // chainingで1行になっている
    const d = result.diagnostics.tableGeometryChaining;
    expect(d.tableGeometryTolerance).toBe(1.736);
    expect(d.rowsExceedingTolerance).toEqual([
      expect.objectContaining({ rowIndex: 0, baselineSpan: 3, tableGeometryTolerance: 1.736, exceedsTolerance: true, topToken: { index: 0, baselineY: 100 }, bottomToken: { index: 2, baselineY: 103 } }),
    ]);
    expect(d.maxBaselineSpan).toBe(3);
  });

  it('chainingが無いページでは該当なし', () => {
    const { result } = run([tok('A', 10, 100), tok('B', 60, 100.1), tok('C', 10, 140)]);
    expect(result.diagnostics.tableGeometryChaining.rowsExceedingTolerance).toEqual([]);
  });

  it('baselineSpanOfはTableGeometryのrow定義を変更しない（診断のみ）', () => {
    const { tokens, geometry } = run(chain);
    const before = JSON.stringify(geometry);
    baselineSpanOf(geometry.physicalRows[0], tokens, meta);
    expect(JSON.stringify(geometry)).toBe(before);
  });
});
