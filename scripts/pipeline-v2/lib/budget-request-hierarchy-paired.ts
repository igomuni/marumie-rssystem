/**
 * hierarchy ON / OFF の paired diagnostic の分析用純関数。FieldResolver の出力（RecordFieldResolution）を join・集計するだけで、値を補正・補完しない。
 * join key は上流の provenance（同一 PDF・同一ページ集合の anchor = page + logicalRowIndex）だけ。新しい意味論的 ID は作らない。
 */
export interface PairRecord {
  anchor: { page: number; logicalRowIndex: number };
  recordKind: string;
  rowLocal: { name: { status: string; reasonCode: string | null } };
  hierarchyDependent: { parentItemAssociation: { status: string; value: { parentNodeRef: string } | null; reasonCode: string | null } };
}

export const anchorKey = (r: { anchor: { page: number; logicalRowIndex: number } }) => `${r.anchor.page}:${r.anchor.logicalRowIndex}`;

export interface Joined<T extends PairRecord> { key: string; on: T; off: T }
export interface JoinResult<T extends PairRecord> { pairs: Joined<T>[]; unjoinableOn: string[]; unjoinableOff: string[]; duplicateOn: string[]; duplicateOff: string[] }

/** ON / OFF の record を anchor で 1 対 1 に join する。対応しないもの・重複は推測で対応付けず unjoinable / duplicate として返す */
export function joinOnOff<T extends PairRecord>(on: T[], off: T[]): JoinResult<T> {
  const index = (rs: T[]) => { const m = new Map<string, T>(); const dup: string[] = []; for (const r of rs) { const k = anchorKey(r); if (m.has(k)) dup.push(k); else m.set(k, r); } return { m, dup }; };
  const a = index(on), b = index(off);
  const pairs: Joined<T>[] = [];
  for (const [k, r] of a.m) { const o = b.m.get(k); if (o) pairs.push({ key: k, on: r, off: o }); }
  return { pairs, unjoinableOn: [...a.m.keys()].filter(k => !b.m.has(k)), unjoinableOff: [...b.m.keys()].filter(k => !a.m.has(k)), duplicateOn: a.dup, duplicateOff: b.dup };
}

const KINDS = ['organization', 'item', 'request', 'detail_line', 'unclassified'];
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };

/** ON の recordKind × OFF の recordKind（join できた unit のみ。KINDS 以外は other） */
export function kindMatrix<T extends PairRecord>(pairs: Joined<T>[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = Object.fromEntries(KINDS.map(k => [k, Object.fromEntries([...KINDS, 'other'].map(o => [o, 0]))]));
  for (const p of pairs) {
    const on = KINDS.includes(p.on.recordKind) ? p.on.recordKind : 'other';
    if (!m[on]) m[on] = Object.fromEntries([...KINDS, 'other'].map(o => [o, 0]));
    inc(m[on], KINDS.includes(p.off.recordKind) ? p.off.recordKind : 'other');
  }
  return m;
}

/** ON で item だった unit の OFF での recordKind。unjoinable は別に数える（呼び出し側で join 結果から渡す） */
export function itemTransitions<T extends PairRecord>(j: JoinResult<T>, onAll: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of j.pairs) if (p.on.recordKind === 'item') inc(out, `off_${p.off.recordKind}`);
  const unj = new Set(j.unjoinableOn);
  for (const r of onAll) if (r.recordKind === 'item' && unj.has(anchorKey(r))) inc(out, 'off_missing_unjoinable');
  return out;
}

/** request の親の項の状態（その record 自身の parentItemAssociation と、同一側の record 集合から引いた親の種別だけで決める） */
export function parentState<T extends PairRecord>(r: T, side: Map<string, T>): string {
  const a = r.hierarchyDependent.parentItemAssociation;
  if (a.status === 'not_observed') return 'not_observed';
  if (a.status !== 'resolved' || !a.value) return a.status === 'unresolved' ? 'unresolved' : `other:${a.status}`;
  const m = /-p(\d+)-r(\d+)$/.exec(a.value.parentNodeRef);
  const parent = m ? side.get(`${m[1]}:${m[2]}`) : undefined;
  if (!parent) return 'resolved_parent_record_missing';
  return parent.recordKind === 'item' ? 'resolved_item' : 'resolved_non_item';
}

/** ON で request だった unit の親の項の状態の遷移（`on→off`） */
export function requestParentTransitions<T extends PairRecord>(j: JoinResult<T>, onSide: T[], offSide: T[]): Record<string, number> {
  const on = new Map(onSide.map(r => [anchorKey(r), r])), off = new Map(offSide.map(r => [anchorKey(r), r]));
  const out: Record<string, number> = {};
  for (const p of j.pairs) if (p.on.recordKind === 'request') inc(out, `${parentState(p.on, on)}→${parentState(p.off, off)}`);
  return out;
}

/** 名称の status / reasonCode が ON と OFF で変わったか（join できた全 unit） */
export function nameStatusTransitions<T extends PairRecord>(pairs: Joined<T>[]): { unchanged: number; changed: Record<string, number>; byReasonUnchanged: Record<string, number> } {
  let unchanged = 0;
  const changed: Record<string, number> = {};
  const byReasonUnchanged: Record<string, number> = {};
  const label = (r: T) => `${r.rowLocal.name.status}/${r.rowLocal.name.reasonCode ?? 'none'}`;
  for (const p of pairs) {
    const a = label(p.on), b = label(p.off);
    if (a === b) { unchanged++; inc(byReasonUnchanged, a); } else inc(changed, `${a}→${b}`);
  }
  return { unchanged, changed, byReasonUnchanged };
}

export type IsolationDecision = 'HIERARCHY_MAJOR_CAUSAL_FACTOR' | 'HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT' | 'HIERARCHY_NOT_PRIMARY' | 'INCONCLUSIVE';
export interface IsolationFacts {
  controlMatched: boolean; unjoinable: number; duplicates: number; pageSetsEqual: boolean; offRunFailed: boolean;
  pairedPdfs: number; publishers: number;
  I: number; R: number; X: number; Y: number; P: number; Con: number; Coff: number;
  pdfsWithI: number; publishersWithI: number; pdfsWithP: number; publishersWithP: number;
}

/** 事前登録（Hierarchy_Failure_Isolation_Preregistration の判定規則）の転記。結果を見た後に条件・閾値を足さない */
export function decideIsolation(f: IsolationFacts): { decision: IsolationDecision; rule: number } {
  if (!f.controlMatched || f.unjoinable > 0 || f.duplicates > 0 || !f.pageSetsEqual || f.offRunFailed || f.pairedPdfs < 2 || f.publishers < 2) return { decision: 'INCONCLUSIVE', rule: 1 };
  if (f.I === 0 && f.X === 0) return { decision: 'HIERARCHY_NOT_PRIMARY', rule: 2 };
  const major = f.I > 0 && f.P > 0 && f.Con > f.Coff && f.pdfsWithI >= 2 && f.publishersWithI >= 2 && f.pdfsWithP >= 2 && f.publishersWithP >= 2 && f.I > f.R && f.X > f.Y;
  return major ? { decision: 'HIERARCHY_MAJOR_CAUSAL_FACTOR', rule: 3 } : { decision: 'HIERARCHY_CONTRIBUTES_BUT_NOT_SUFFICIENT', rule: 4 };
}
