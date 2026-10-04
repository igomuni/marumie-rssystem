/**
 * 描画 primitive（budget-request-drawing-primitives.ts）から、比較用の merged vertical rule と候補 anchor（page の long rule の左から k 番目）を作る research-only 純関数。
 * 規則は docs/tasks/20261005_0839_Budget_Request_Rule_Line_Geometry_Inventory_Protocol.md（先に固定）。意味（項・organization）は付けない。
 */
import type { DrawingPrimitive } from './budget-request-drawing-primitives';

export const X_ROUND = 0.01; // merged rule の x の丸め（pt）
export const Y_JOIN_GAP = 0.01; // 同じ x の線分をつなぐ y の隙間（pt）
export const LONG_RULE_FRACTION = 0.5; // long rule = 長さが page 高さの 0.5 倍以上

export interface MergedRule { x: number; yMin: number; yMax: number; lineWidths: number[]; sourcePaths: number[] }
const r2 = (x: number) => Math.round(x / X_ROUND) * X_ROUND;
const fix = (x: number) => Math.round(x * 100) / 100;

/** stroke の垂直線分を、x（0.01pt）が同じで y 区間が重なる・接するものごとに 1 本へまとめる。fill の矩形・曲線・水平線は含めない */
export function mergeVerticalRules(prims: DrawingPrimitive[]): MergedRule[] {
  const by = new Map<number, { y1: number; y2: number; lw: number | null; path: number }[]>();
  for (const p of prims) {
    if (p.kind !== 'line' || p.orientation !== 'vertical' || p.paint !== 'stroke') continue;
    const x = fix(r2(p.x1));
    if (!by.has(x)) by.set(x, []);
    by.get(x)!.push({ y1: Math.min(p.y1, p.y2), y2: Math.max(p.y1, p.y2), lw: p.lineWidth, path: p.pathIndex });
  }
  const out: MergedRule[] = [];
  for (const [x, segs] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    segs.sort((a, b) => a.y1 - b.y1);
    let cur: MergedRule | null = null;
    for (const s of segs) {
      if (cur && s.y1 <= cur.yMax + Y_JOIN_GAP) { cur.yMax = Math.max(cur.yMax, s.y2); if (s.lw !== null && !cur.lineWidths.includes(s.lw)) cur.lineWidths.push(s.lw); cur.sourcePaths.push(s.path); }
      else { if (cur) out.push(cur); cur = { x, yMin: s.y1, yMax: s.y2, lineWidths: s.lw === null ? [] : [s.lw], sourcePaths: [s.path] }; }
    }
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => a.x - b.x || a.yMin - b.yMin);
}

export const longRules = (rules: MergedRule[], pageHeight: number): MergedRule[] => rules.filter(r => r.yMax - r.yMin >= LONG_RULE_FRACTION * pageHeight);

export type AnchorStatus = 'unique' | 'unavailable' | 'ambiguous';
/** page の long rule を x の小さい方から数えた k 番目（1 始まり）。同じ x に y 区間の離れた long rule が複数ある場合は ambiguous（x の値は返すが unique とは数えない） */
export function ordinalAnchor(long: MergedRule[], k: number): { status: AnchorStatus; x: number | null } {
  const xs = [...new Set(long.map(r => r.x))].sort((a, b) => a - b);
  if (k < 1 || k > xs.length) return { status: 'unavailable', x: null };
  const x = xs[k - 1];
  return { status: long.filter(r => r.x === x).length > 1 ? 'ambiguous' : 'unique', x };
}
