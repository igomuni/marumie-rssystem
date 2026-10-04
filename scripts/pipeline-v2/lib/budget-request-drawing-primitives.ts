/**
 * pdf.js の operator list から、描画 primitive（線分・矩形・曲線）を source-faithful に取り出す research-only 純関数。
 * 罫線という意味は付けない（orientation と長さを記録するだけ）。見えない線は生成・補完しない。production の SourceToken / TableGeometry / FieldResolver からは使われない。
 *
 * 入力: operator list の fnArray / argsArray と pdf.js の OPS 定数（pdf.js 5.4.296 の constructPath = [paintOp, [pathData(Float32Array)], minMax]、pathData は [cmd, x, y...] の列）。
 * 座標: 現在の変換行列（transform / save / restore を追跡）で page の user space へ変換し、SourceToken と同じ左上原点（y 下向き）に揃える（y = view[3] - y_pdf）。
 */
export interface OpsTable { save: number; restore: number; transform: number; setLineWidth: number; constructPath: number; stroke: number; closeStroke: number; fill: number; eoFill: number; fillStroke: number; eoFillStroke: number; closeFillStroke: number; closeEOFillStroke: number; endPath: number; clip: number; eoClip: number }
export type PaintKind = 'stroke' | 'fill' | 'fill_stroke' | 'none' | 'other';
export type PrimitiveKind = 'line' | 'rect' | 'curve';
export interface DrawingPrimitive {
  operatorIndex: number;
  pathIndex: number;
  kind: PrimitiveKind;
  paint: PaintKind;
  lineWidth: number | null;
  /** page 座標（左上原点・y 下向き）。line は端点、rect は対角（xMin,yMin,xMax,yMax を x1,y1,x2,y2 に入れる） */
  x1: number; y1: number; x2: number; y2: number;
  orientation: 'vertical' | 'horizontal' | 'oblique' | 'area';
  length: number;
}
const round = (x: number) => Math.round(x * 1000) / 1000;
const CMD = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

const mul = (m: number[], n: number[]) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function paintOf(op: number, ops: OpsTable): PaintKind {
  if (op === ops.stroke || op === ops.closeStroke) return 'stroke';
  if (op === ops.fill || op === ops.eoFill) return 'fill';
  if (op === ops.fillStroke || op === ops.eoFillStroke || op === ops.closeFillStroke || op === ops.closeEOFillStroke) return 'fill_stroke';
  if (op === ops.endPath) return 'none';
  return 'other';
}

export function extractDrawingPrimitives(fnArray: number[], argsArray: unknown[], ops: OpsTable, view: number[]): DrawingPrimitive[] {
  const out: DrawingPrimitive[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: number[]; lw: number | null }[] = [];
  let lineWidth: number | null = null;
  let pathIndex = 0;
  const top = view[3];
  const pt = (x: number, y: number): [number, number] => { const [px, py] = apply(ctm, x, y); return [round(px - view[0]), round(top - py)]; };
  const orient = (x1: number, y1: number, x2: number, y2: number): DrawingPrimitive['orientation'] => (Math.abs(x1 - x2) < 1e-3 ? 'vertical' : Math.abs(y1 - y2) < 1e-3 ? 'horizontal' : 'oblique');
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === ops.save) stack.push({ ctm: [...ctm], lw: lineWidth });
    else if (fn === ops.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; lineWidth = s.lw; } }
    else if (fn === ops.transform) ctm = mul(ctm, argsArray[i] as number[]);
    else if (fn === ops.setLineWidth) lineWidth = (argsArray[i] as number[])[0];
    else if (fn === ops.constructPath) {
      const [paintOp, pathArgs] = argsArray[i] as [number, ArrayLike<number>[]];
      const data = Array.from(pathArgs[0] ?? []);
      const paint = paintOf(paintOp, ops);
      const sub: [number, number][][] = [];
      let cur: [number, number][] = [];
      let hasCurve = false;
      let closed = false;
      for (let k = 0; k < data.length;) {
        const c = data[k];
        if (c === CMD.moveTo) { if (cur.length) sub.push(cur); cur = [pt(data[k + 1], data[k + 2])]; k += 3; closed = false; }
        else if (c === CMD.lineTo) { cur.push(pt(data[k + 1], data[k + 2])); k += 3; }
        else if (c === CMD.curveTo) { hasCurve = true; cur.push(pt(data[k + 5], data[k + 6])); k += 7; }
        else if (c === CMD.quadraticCurveTo) { hasCurve = true; cur.push(pt(data[k + 3], data[k + 4])); k += 5; }
        else if (c === CMD.closePath) { closed = true; k += 1; }
        else { k += 1; }
      }
      if (cur.length) sub.push(cur);
      void closed;
      const pi = pathIndex++;
      const base = { operatorIndex: i, pathIndex: pi, paint, lineWidth };
      if (hasCurve) {
        const all = sub.flat();
        const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
        out.push({ ...base, kind: 'curve', x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys), orientation: 'area', length: 0 });
        continue;
      }
      for (const poly of sub) {
        const uniq = poly.filter((p, idx) => idx === 0 || p[0] !== poly[idx - 1][0] || p[1] !== poly[idx - 1][1]);
        const xs = [...new Set(poly.map(p => p[0]))], ys = [...new Set(poly.map(p => p[1]))];
        if (uniq.length >= 4 && xs.length === 2 && ys.length === 2) { // 軸に平行な矩形
          out.push({ ...base, kind: 'rect', x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys), orientation: 'area', length: 0 });
          continue;
        }
        for (let s = 1; s < uniq.length; s++) {
          const [a, b] = [uniq[s - 1], uniq[s]];
          out.push({ ...base, kind: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], orientation: orient(a[0], a[1], b[0], b[1]), length: round(Math.hypot(b[0] - a[0], b[1] - a[1])) });
        }
      }
    }
  }
  return out;
}
