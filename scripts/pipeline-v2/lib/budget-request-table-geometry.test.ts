import { describe, expect, it } from 'vitest';
import {
  buildTableGeometry,
  baselineTopOf,
  clusterPhysicalRows,
  DEFAULT_GEOMETRY_OPTIONS,
  observeColumnBands,
  referenceFontSizeOf,
  sweepYReference,
  TABLE_GEOMETRY_SCHEMA,
} from './budget-request-table-geometry';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';

const meta = pageMetaFrom(1, 1, [0, 0, 842, 595], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };

/** SourceTokenを作る。baselineTop = ページ上端からのベースライン位置（左上原点）。PDF user spaceのfは 595 - baselineTop */
let counter = 0;
function tok(text: string, x: number, baselineTop: number, width = 10, size = 6.944, index = counter++): SourceToken {
  const item: RawTextItem = { str: text, transform: [size, 0, 0, size, x, 595 - baselineTop], width, height: size, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, index, meta, styles);
}
const reindex = (ts: SourceToken[]): SourceToken[] => ts.map((t, i) => ({ ...t, index: i }));

describe('baseline', () => {
  it('transform[5]（PDF user space）を左上原点へ揃える', () => {
    expect(baselineTopOf(tok('a', 10, 120.5), meta)).toBeCloseTo(120.5, 6);
  });
});

describe('clusterPhysicalRows', () => {
  it('同じbaseline付近のtokenは、x位置が大きく離れていても同一row（xはrow判定に使わない）', () => {
    const ts = reindex([tok('左', 50, 100), tok('右', 700, 100.2), tok('次の行', 50, 120)]);
    const { rows } = clusterPhysicalRows(ts, meta);
    expect(rows).toHaveLength(2);
    expect(rows[0].rawTokenIndexes).toEqual([0, 1]);
    expect(rows[1].rawTokenIndexes).toEqual([2]);
  });

  it('明確に異なるyは別row', () => {
    expect(clusterPhysicalRows(reindex([tok('a', 50, 100), tok('b', 50, 103.5)]), meta).rows).toHaveLength(2); // 半行(3.472)離れた行
  });

  it('toleranceの境界: gap == tolerance は同一row、わずかに超えると別row', () => {
    const tol = DEFAULT_GEOMETRY_OPTIONS.rowClustering.toleranceFactor * 6.944;
    expect(clusterPhysicalRows(reindex([tok('a', 50, 100), tok('b', 50, 100 + tol)]), meta).rows).toHaveLength(1);
    expect(clusterPhysicalRows(reindex([tok('a', 50, 100), tok('b', 50, 100 + tol + 0.01)]), meta).rows).toHaveLength(2);
  });

  it('toleranceはページのfontSize中央値に比例する（相対値）', () => {
    const big = (y: number) => tok('x', 50, y, 10, 13.888);
    const rows = clusterPhysicalRows(reindex([big(100), big(103.4)]), meta); // 0.25*13.888=3.472 → 同一row
    expect(rows.tolerance).toBeCloseTo(3.472, 3);
    expect(rows.rows).toHaveLength(1);
    expect(referenceFontSizeOf([tok('a', 1, 1), tok('b', 1, 1), tok('c', 1, 1, 5, 13.888)])).toBe(6.944);
  });

  it('SourceToken indexを失わず、raw orderを保持し、visual-x orderを別に持つ（金額chunk逆順）', () => {
    // pdf.jsの出力順（raw order）は右から左: 916 → 599, → 234,
    const ts = reindex([tok('916', 245.021, 100), tok('599,', 232.942, 100), tok('234,', 220.864, 100)]);
    const row = clusterPhysicalRows(ts, meta).rows[0];
    expect(row.rawTokenIndexes).toEqual([0, 1, 2]);
    expect(row.visualTokenIndexes).toEqual([2, 1, 0]);
    expect(row.rawOrderMatchesVisualOrder).toBe(false);
    // 結合した文字列を作らない（rowはtoken参照のみ）
    expect(Object.keys(row)).not.toContain('text');
  });

  it('raw orderとvisual orderが同じ行は rawOrderMatchesVisualOrder=true', () => {
    const row = clusterPhysicalRows(reindex([tok('a', 10, 100), tok('b', 30, 100)]), meta).rows[0];
    expect(row.rawOrderMatchesVisualOrder).toBe(true);
  });

  it('空白のみ・空文字tokenはクラスタリング対象外で、近い行から参照される（SourceTokenは削除しない）', () => {
    const ts = reindex([tok('a', 10, 100), tok(' ', 20, 100, 99, 0), tok('', 30, 100.1, 0, 0), tok('b', 40, 130), tok(' ', 50, 200, 5, 0)]);
    const r = clusterPhysicalRows(ts, meta);
    expect(r.excluded).toEqual([1, 2, 4]);
    expect(r.rows).toHaveLength(2); // 空白tokenだけでrowを作らない
    expect(r.rows[0]).toMatchObject({ rawTokenIndexes: [0], whitespaceTokenIndexes: [1, 2], tokenCount: 3, nonWhitespaceTokenCount: 1 });
    expect(r.unassignedWhitespace).toEqual([4]); // どの行からもtolerance以内にない
    expect(ts).toHaveLength(5);
  });

  it('row bboxはconstituent token bboxの和集合（空白tokenは含めない）', () => {
    const a = tok('a', 10, 100, 20);
    const b = tok('b', 200, 100, 30);
    const ws = tok(' ', 300, 100, 500, 0);
    const row = clusterPhysicalRows(reindex([a, b, ws]), meta).rows[0];
    expect(row.bbox).toEqual({
      xMin: 10,
      yMin: Math.min(a.bbox.yMin, b.bbox.yMin),
      xMax: 230,
      yMax: Math.max(a.bbox.yMax, b.bbox.yMax),
    });
  });

  it('入力のSourceTokenを変更しない', () => {
    const ts = reindex([tok('916', 245, 100), tok('599,', 233, 100), tok(' ', 1, 100, 3, 0)]);
    const before = JSON.stringify(ts);
    buildTableGeometry(ts, meta);
    expect(JSON.stringify(ts)).toBe(before);
  });

  it('y代表値の比較: 同じbaselineでfontSizeが違うtokenは、baselineなら同一row、yMinでは小さいfactorで別rowになる', () => {
    const ts = reindex([tok('小', 10, 100, 7, 6.944), tok('小', 20, 100, 7, 6.944), tok('小', 30, 100, 7, 6.944), tok('大', 40, 100, 14, 13.888)]);
    expect(clusterPhysicalRows(ts, meta, { yReference: 'baseline', toleranceFactor: 0.1 }).rows).toHaveLength(1);
    expect(clusterPhysicalRows(ts, meta, { yReference: 'yMin', toleranceFactor: 0.1 }).rows).toHaveLength(2);
    const sweep = sweepYReference(ts, meta, [0.1]);
    expect(sweep.baseline[0].rowCount).toBe(1);
    expect(sweep.yMin[0].rowCount).toBe(2);
  });
});

describe('observeColumnBands', () => {
  // 3行 x 3列（左端が揃う）+ 離れた右側の揃い
  const grid = (): SourceToken[] => {
    const ts: SourceToken[] = [];
    for (const y of [100, 120, 140]) {
      ts.push(tok('番', 50, y, 12), tok('事項', 90, y, 30), tok('金', 300 + (y % 7), y, 20), tok('右', 480, y, 40));
    }
    return reindex(ts);
  };

  it('x座標の近いtoken群が同じband候補になり、大きく離れたtoken群は別bandになる', () => {
    const ts = grid();
    const { rows, referenceFontSize } = clusterPhysicalRows(ts, meta);
    const bands = observeColumnBands(ts, rows, referenceFontSize);
    const left = bands.filter(b => b.edge === 'xMin');
    expect(left.map(b => Math.round(b.edgeRange[0]))).toEqual(expect.arrayContaining([50, 90, 480]));
    const b50 = left.find(b => Math.round(b.edgeRange[0]) === 50)!;
    expect(b50).toMatchObject({ tokenCount: 3, rowCount: 3 });
    expect(left.filter(b => Math.round(b.edgeRange[0]) === 480)).toHaveLength(1);
    expect(b50.xMax).toBeLessThan(90); // 別bandと混ざらない
  });

  it('semantic label（columnName/regionType/relation等）を持たない', () => {
    const ts = grid();
    const { rows, referenceFontSize } = clusterPhysicalRows(ts, meta);
    for (const b of observeColumnBands(ts, rows, referenceFontSize)) {
      expect(Object.keys(b).sort()).toEqual(['bandIndex', 'edge', 'edgeRange', 'rowCount', 'tokenCount', 'tokenIndexes', 'xMax', 'xMin']);
    }
  });

  it('minRows未満の繰り返しは帯にしない', () => {
    const ts = reindex([tok('a', 50, 100), tok('b', 50, 120)]);
    const { rows, referenceFontSize } = clusterPhysicalRows(ts, meta);
    expect(observeColumnBands(ts, rows, referenceFontSize, { edgeToleranceFactor: 0.25, minRows: 3 })).toEqual([]);
  });

  it('罫線文字のみのtokenは行には含まれるが、帯の観測からは除外される', () => {
    const ts = reindex([100, 120, 140].flatMap(y => [tok('│', 200, y, 3), tok('字', 50, y, 7)]));
    const { rows, referenceFontSize } = clusterPhysicalRows(ts, meta);
    expect(rows[0].rawTokenIndexes).toHaveLength(2); // 行には残る
    const bands = observeColumnBands(ts, rows, referenceFontSize);
    expect(bands.every(b => b.tokenIndexes.every(i => ts[i].rawText !== '│'))).toBe(true);
    expect(bands.length).toBeGreaterThan(0);
  });
});

describe('buildTableGeometry（出力にparameterを残す）', () => {
  it('行クラスタリング・帯観測のalgorithm/threshold/除外ルールをparametersに記録する', () => {
    const r = buildTableGeometry(reindex([tok('a', 50, 100), tok(' ', 60, 100, 5, 0), tok('b', 50, 120)]), meta);
    expect(TABLE_GEOMETRY_SCHEMA).toBe('budget-request-table-geometry-poc/v1');
    expect(r.parameters.rowClustering).toMatchObject({
      yReference: 'baseline',
      toleranceFactor: 0.25,
      referenceFontSize: 6.944,
      tolerance: 1.736,
      xUsedForRowMembership: false,
    });
    expect(r.parameters.rowClustering.excludedFromClustering).toContain('whitespace');
    expect(r.parameters.columnBands).toMatchObject({ edgeToleranceFactor: 0.25, minRows: 3, edgeTolerance: 1.736, bandsMayOverlap: true });
    expect(r).toMatchObject({ sourceTokenCount: 3, excludedTokenIndexes: [1] });
  });
});
