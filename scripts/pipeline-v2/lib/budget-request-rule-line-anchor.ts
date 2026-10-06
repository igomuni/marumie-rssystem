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

export const THIN_LINE_WIDTH_MAX = 0.5; // 観測された線幅は 0.333（表の罫線）と 1（page 枠）の 2 種のみ（development inventory）。thin = 全ての線幅が 0.5 未満
export const isThinRule = (r: MergedRule): boolean => r.lineWidths.length > 0 && r.lineWidths.every(w => w < THIN_LINE_WIDTH_MAX);

/** development inventory 後に追加した候補 T1: page の long rule のうち thin なものの最も左の x（page 枠の太い線を除く）。同 x に離れた rule が複数なら ambiguous */
export function leftmostThinAnchor(long: MergedRule[]): { status: AnchorStatus; x: number | null } {
  return ordinalAnchor(long.filter(isThinRule), 1);
}

/** range-local anchor: range 内の各 page の T1（unique のもの）の x の最頻値（同数なら小さい x）。unique な page が 1 つも無ければ unavailable */
export function rangeAnchor(pageAnchors: { status: AnchorStatus; x: number | null }[]): { status: 'available' | 'unavailable'; x: number | null; uniquePages: number; modalPages: number } {
  const counts = new Map<number, number>();
  let unique = 0;
  for (const a of pageAnchors) if (a.status === 'unique' && a.x !== null) { unique++; counts.set(a.x, (counts.get(a.x) ?? 0) + 1); }
  if (unique === 0) return { status: 'unavailable', x: null, uniquePages: 0, modalPages: 0 };
  let best: [number, number] | null = null;
  for (const [x, n] of counts) if (!best || n > best[1] || (n === best[1] && x < best[0])) best = [x, n];
  return { status: 'available', x: best![0], uniquePages: unique, modalPages: best![1] };
}
