import { describe, expect, it } from 'vitest';
import { extractDrawingPrimitives, type OpsTable } from './budget-request-drawing-primitives';
import { longRules, mergeVerticalRules, ordinalAnchor } from './budget-request-rule-line-anchor';

const OPS: OpsTable = { save: 10, restore: 11, transform: 12, setLineWidth: 13, constructPath: 91, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, clip: 29, eoClip: 30 };
const path = (paint: number, ...cmds: number[]) => [paint, [Float32Array.from(cmds)], null];
const run = (fn: number[], args: unknown[]) => extractDrawingPrimitives(fn, args, OPS, [0, 0, 842, 595]);

describe('extractDrawingPrimitives', () => {
  it('線分は左上原点（y 下向き）の page 座標、線幅と paint を保持する', () => {
    const p = run([OPS.setLineWidth, OPS.constructPath], [[0.5], path(OPS.stroke, 0, 50, 100, 1, 50, 500)]);
    expect(p).toEqual([{ operatorIndex: 1, pathIndex: 0, kind: 'line', paint: 'stroke', lineWidth: 0.5, x1: 50, y1: 495, x2: 50, y2: 95, orientation: 'vertical', length: 400 }]);
  });
  it('transform と save/restore を追跡する（restore で線幅・変換が戻る）', () => {
    const p = run([OPS.save, OPS.transform, OPS.setLineWidth, OPS.constructPath, OPS.restore, OPS.constructPath], [null, [1, 0, 0, 1, 10, 0], [2], path(OPS.stroke, 0, 0, 0, 1, 0, 100), null, path(OPS.stroke, 0, 0, 0, 1, 0, 100)]);
    expect(p.map(x => [x.x1, x.lineWidth])).toEqual([[10, 2], [0, null]]);
  });
  it('4 点の軸平行な閉じた path は rect、曲線は curve、斜め線は oblique', () => {
    const rect = run([OPS.constructPath], [path(OPS.fill, 0, 10, 10, 1, 20, 10, 1, 20, 30, 1, 10, 30, 4)]);
    expect(rect[0]).toMatchObject({ kind: 'rect', paint: 'fill', orientation: 'area' });
    expect(run([OPS.constructPath], [path(OPS.stroke, 0, 0, 0, 2, 1, 1, 2, 2, 3, 3)])[0].kind).toBe('curve');
    expect(run([OPS.constructPath], [path(OPS.stroke, 0, 0, 0, 1, 10, 10)])[0].orientation).toBe('oblique');
  });
});

describe('merged vertical rule / ordinal anchor', () => {
  const v = (x: number, y1: number, y2: number) => run([OPS.constructPath], [path(OPS.stroke, 0, x, 595 - y1, 1, x, 595 - y2)])[0];
  it('同じ x で接する線分は 1 本にまとめ、離れていれば別の rule', () => {
    const m = mergeVerticalRules([v(50, 0, 100), v(50, 100, 300), v(50, 400, 500), v(80, 0, 10)]);
    expect(m.map(r => [r.x, r.yMin, r.yMax])).toEqual([[50, 0, 300], [50, 400, 500], [80, 0, 10]]);
  });
  it('long rule は page 高さの 0.5 倍以上。k 番目は x の昇順、足りなければ unavailable、同 x に複数あれば ambiguous', () => {
    const m = mergeVerticalRules([v(31, 0, 560), v(50, 0, 560), v(200, 0, 100), v(300, 0, 560), v(300, 0, 20).x1 === 300 ? v(300, 100, 560) : v(0, 0, 0)]);
    const long = longRules(m, 595);
    expect(ordinalAnchor(long, 1)).toEqual({ status: 'unique', x: 31 });
    expect(ordinalAnchor(long, 2)).toEqual({ status: 'unique', x: 50 });
    expect(ordinalAnchor(long, 4)).toEqual({ status: 'unavailable', x: null });
  });
});
