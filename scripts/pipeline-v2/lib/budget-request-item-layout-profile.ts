/**
 * 項の物理 anchor が 1 段シフトした layout の profile 導出と項 candidate 抽出（research-only 純関数）。規則は
 * docs/tasks/20261005_2245_Budget_Request_Item_Layout_Anchor_Coverage_Protocol.md。MOF・名称の意味・PDF filename を使わず、PDF 自身の表構造
 * （「組織計」marker・request 行・縦罫線との deltaX）だけから導出する。
 */
export interface ProfileRow { page: number; y: number; kind: 'plain3' | 'request'; deltaX: number | null; ruleX: number | null }
export interface OrgSubtotalMarker { page: number; y: number }
export type Level = 'organization' | 'item' | 'event';
export interface ClusterStat { deltaX: number; count: number; min: number; max: number; spread: number }
export interface LayoutProfile {
  valid: boolean; invalidReason: string | null; ruleX: number | null; organization: ClusterStat | null; item: ClusterStat | null; event: ClusterStat | null; tolerance: number | null;
  evidence: { markerPages: number[]; levelCounts: Record<Level, number>; rowsWithoutLinkedRule: number };
}

const eps = 1e-9;
/** 文書順（page → y）に走査。marker の後（と文書の先頭）の最初の plain 3 桁 row を組織、以降の plain 3 桁 row を項、request-shaped row を事項とする */
export function assignLevels(rows: ProfileRow[], markers: OrgSubtotalMarker[]): { row: ProfileRow; level: Level }[] {
  type Ev = { t: 'row'; r: ProfileRow } | { t: 'marker'; m: OrgSubtotalMarker };
  const events: Ev[] = [...rows.map(r => ({ t: 'row', r }) as Ev), ...markers.map(m => ({ t: 'marker', m }) as Ev)];
  const pos = (e: Ev) => (e.t === 'row' ? [e.r.page, e.r.y] : [e.m.page, e.m.y]);
  events.sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1] || (a.t === 'marker' ? -1 : 1) - (b.t === 'marker' ? -1 : 1));
  const out: { row: ProfileRow; level: Level }[] = [];
  let expectOrg = true;
  for (const e of events) {
    if (e.t === 'marker') { expectOrg = true; continue; }
    if (e.r.kind === 'request') { out.push({ row: e.r, level: 'event' }); continue; }
    if (expectOrg) { out.push({ row: e.r, level: 'organization' }); expectOrg = false; } else out.push({ row: e.r, level: 'item' });
  }
  return out;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
function stat(xs: number[]): ClusterStat | null {
  if (xs.length === 0) return null;
  const c = new Map<number, number>();
  for (const x of xs) c.set(round3(x), (c.get(round3(x)) ?? 0) + 1);
  let mode = xs[0], best = -1;
  for (const [v, n] of [...c.entries()].sort((a, b) => a[0] - b[0])) if (n > best) { best = n; mode = v; }
  return { deltaX: mode, count: xs.length, min: Math.min(...xs), max: Math.max(...xs), spread: round3(Math.max(...xs) - Math.min(...xs)) };
}

export const MAX_CLUSTER_SPREAD = 0.1; // sanity（観測は 0.01pt 未満）。結果を見て変更しない

export function deriveProfile(rows: ProfileRow[], markers: OrgSubtotalMarker[]): LayoutProfile {
  const levels = assignLevels(rows, markers);
  const linked = levels.filter(l => l.row.deltaX !== null && l.row.ruleX !== null);
  const by = (lv: Level) => linked.filter(l => l.level === lv).map(l => l.row.deltaX as number);
  const org = stat(by('organization')), item = stat(by('item')), event = stat(by('event'));
  const ruleXs = [...new Set(linked.map(l => round3(l.row.ruleX as number)))];
  const levelCounts = { organization: levels.filter(l => l.level === 'organization').length, item: levels.filter(l => l.level === 'item').length, event: levels.filter(l => l.level === 'event').length };
  const base = { evidence: { markerPages: [...new Set(markers.map(m => m.page))].sort((a, b) => a - b), levelCounts, rowsWithoutLinkedRule: levels.length - linked.length } };
  const bad = (reason: string): LayoutProfile => ({ valid: false, invalidReason: reason, ruleX: null, organization: org, item, event, tolerance: null, ...base });
  if (!org || !item || !event) return bad('level_cluster_empty');
  if (!(org.deltaX < item.deltaX && item.deltaX < event.deltaX)) return bad('level_order_not_organization_item_event');
  if (Math.max(org.spread, item.spread, event.spread) > MAX_CLUSTER_SPREAD) return bad('cluster_spread_exceeds_sanity');
  if (ruleXs.length === 0 || Math.max(...ruleXs) - Math.min(...ruleXs) > 0.01) return bad('linked_rule_not_unique');
  const gap = Math.min(item.deltaX - org.deltaX, event.deltaX - item.deltaX);
  return { valid: true, invalidReason: null, ruleX: ruleXs[0], organization: org, item, event, tolerance: round3(gap / 2), ...base };
}

/** 項 candidate: request-shaped でない plain 3 桁 row のうち、linked rule が profile の ruleX で、deltaX が 項 cluster の tolerance 内 */
export function isItemRow(row: { kind: 'plain3' | 'request'; deltaX: number | null; ruleX: number | null }, p: LayoutProfile): boolean {
  if (!p.valid || !p.item || p.tolerance === null || p.ruleX === null) return false;
  return row.kind === 'plain3' && row.deltaX !== null && row.ruleX !== null && Math.abs(row.ruleX - p.ruleX) <= 0.01 && Math.abs(row.deltaX - p.item.deltaX) <= p.tolerance + eps;
}

export interface TokenLite { index: number; rawText: string; bbox: { xMin: number; xMax: number; yMin: number; yMax: number } }
const yCenter = (t: TokenLite) => (t.bbox.yMin + t.bbox.yMax) / 2;
/** 「組織計」marker: 同じ縦位置（0.5pt 丸め）に token「組」「織」「計」が揃う行 */
export function findOrgSubtotalMarkers(page: number, tokens: TokenLite[]): OrgSubtotalMarker[] {
  const ys = new Map<number, TokenLite[]>();
  for (const t of tokens) if (['組', '織', '計'].includes(t.rawText.trim())) { const k = Math.round(t.bbox.yMin * 2) / 2; ys.set(k, [...(ys.get(k) ?? []), t]); }
  return [...ys.entries()].filter(([, ts]) => ts.sort((a, b) => a.bbox.xMin - b.bbox.xMin).map(t => t.rawText.trim()).join('') === '組織計').map(([y]) => ({ page, y }));
}

/** 同じ行の token のうち、code token の右端より右・右境界（code の右側で最も近い縦罫線）より左のものを x 昇順に連結（推測・補完なし） */
export function rowNameFromTokens(tokens: TokenLite[], rowBBox: { yMin: number; yMax: number }, codeRight: number, rightBoundary: number): string {
  return tokens.filter(t => t.rawText.trim() !== '' && yCenter(t) >= rowBBox.yMin && yCenter(t) <= rowBBox.yMax && t.bbox.xMin > codeRight && t.bbox.xMin < rightBoundary)
    .sort((a, b) => a.bbox.xMin - b.bbox.xMin || a.index - b.index).map(t => t.rawText.trim()).join('');
}
