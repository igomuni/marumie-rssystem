/**
 * P1 outlier の source-only position 分類（research-only 純関数）。規則は docs/tasks/20261005_1255_Budget_Request_P1_Outlier_Failure_Isolation_Protocol.md §4（個別 page の inspection の前に固定）。
 * P1 / first code row / raw text の意味 / manual contract / MOF は使わず、table frame（long な垂直 rule の範囲）と candidate の bbox だけで決める。
 */
export const FRAME_TOLERANCE = 0.5;
export interface Frame { top: number; bottom: number; left: number; right: number }
export interface BBox { xMin: number; xMax: number; yMin: number; yMax: number }
export type SourcePosition = 'SOURCE_HEADER_POSITION_SUPPORTED' | 'SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED' | 'SOURCE_POSITION_AMBIGUOUS';

/** long な垂直 rule（{x, yMin, yMax}）から table frame を作る。rule が無ければ null */
export function frameOf(longVerticalRules: { x: number; yMin: number; yMax: number }[]): Frame | null {
  if (longVerticalRules.length === 0) return null;
  return { top: Math.min(...longVerticalRules.map(r => r.yMin)), bottom: Math.max(...longVerticalRules.map(r => r.yMax)), left: Math.min(...longVerticalRules.map(r => r.x)), right: Math.max(...longVerticalRules.map(r => r.x)) };
}

export function classifyPosition(c: BBox, frame: Frame | null): { classification: SourcePosition; basis: string } {
  if (!frame) return { classification: 'SOURCE_POSITION_AMBIGUOUS', basis: 'table frame（long な垂直 rule）が page に無い' };
  const t = FRAME_TOLERANCE;
  if (c.yMax <= frame.top + t) return { classification: 'SOURCE_HEADER_POSITION_SUPPORTED', basis: `candidate yMax ${c.yMax} ≤ frameTop ${frame.top} + ${t}` };
  const inside = c.yMin >= frame.top - t && c.yMax <= frame.bottom + t && c.xMin >= frame.left - t && c.xMax <= frame.right + t;
  if (inside) return { classification: 'SOURCE_BODY_OR_TABLE_POSITION_SUPPORTED', basis: `candidate bbox が frame [x ${frame.left}–${frame.right}, y ${frame.top}–${frame.bottom}] の内側` };
  return { classification: 'SOURCE_POSITION_AMBIGUOUS', basis: `candidate bbox [x ${c.xMin}–${c.xMax}, y ${c.yMin}–${c.yMax}] が frame [x ${frame.left}–${frame.right}, y ${frame.top}–${frame.bottom}] の上側にも内側にも収まらない` };
}
