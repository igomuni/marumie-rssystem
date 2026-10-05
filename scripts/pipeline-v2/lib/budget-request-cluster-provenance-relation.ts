/**
 * Phase B の純関数（Phase A freeze 後のみ使用）。規則は docs/tasks/20261005_1640_Budget_Request_Level_Frame_Cluster_Provenance_Protocol.md。
 * C0 の正しさ・cluster の良否は意味しない。
 */
export type Relation = 'B1_one_to_one' | 'B2_split_member' | 'B3_crosses_c0_clusters' | 'B4_c0_unassigned_only' | 'B5_mixed_assigned_unassigned' | 'B6_unclassifiable';

/** assigned[i] は support node の C0 cluster id（未割当は null）。単一対応する cluster の対応先を target として返す */
export function classifyRelations(clusters: { id: number; assigned: (number | null)[] }[]): { relation: Map<number, Relation>; target: Map<number, number> } {
  const relation = new Map<number, Relation>(), target = new Map<number, number>();
  const pending: number[] = [];
  for (const c of clusters) {
    const a = new Set(c.assigned.filter((x): x is number => x !== null));
    const u = c.assigned.filter(x => x === null).length;
    if (c.assigned.length === 0) relation.set(c.id, 'B6_unclassifiable');
    else if (a.size === 0) relation.set(c.id, 'B4_c0_unassigned_only');
    else if (u > 0) relation.set(c.id, 'B5_mixed_assigned_unassigned');
    else if (a.size > 1) relation.set(c.id, 'B3_crosses_c0_clusters');
    else { target.set(c.id, [...a][0]); pending.push(c.id); }
  }
  for (const id of pending) relation.set(id, pending.filter(o => target.get(o) === target.get(id)).length === 1 ? 'B1_one_to_one' : 'B2_split_member');
  return { relation, target };
}

export interface PatternInput {
  relation: Map<string, Relation>; // key = `${pdf}|${clusterId}`
  target: Map<string, string>; // key -> `${pdf}|${c0 cluster}`（単一対応のみ）
  regions: Map<string, Set<string>>; // cluster -> support の region 集合
  layoutRanges: Map<string, Set<string>>; // cluster -> support の layout range id 集合
  runs: Map<string, { start: number; end: number }[]>;
  pdfOf: (key: string) => string;
}
export interface Patterns { A: boolean; B: boolean; C: boolean; D: boolean; E: boolean }

/** 各 family は PDF 別に判定し、いずれかの PDF で成立すれば成立 */
export function patternsOf(i: PatternInput): Patterns {
  const pdfs = [...new Set([...i.relation.keys()].map(i.pdfOf))];
  const res: Patterns = { A: false, B: false, C: false, D: false, E: false };
  const groupMax = (keys: string[], f: (k: string) => string | null) => { const m = new Map<string, number>(); for (const k of keys) { const g = f(k); if (g !== null) m.set(g, (m.get(g) ?? 0) + 1); } return Math.max(0, ...m.values()); };
  for (const pdf of pdfs) {
    const keys = [...i.relation.keys()].filter(k => i.pdfOf(k) === pdf);
    if (groupMax(keys, k => i.target.get(k) ?? null) >= 2) res.A = true;
    if (keys.filter(k => i.relation.get(k) === 'B4_c0_unassigned_only' || i.relation.get(k) === 'B5_mixed_assigned_unassigned').length >= 2) res.B = true;
    if (groupMax(keys, k => { const s = i.regions.get(k); return s && s.size === 1 ? [...s][0] : null; }) >= 2) res.C = true;
    if (groupMax(keys, k => { const s = i.layoutRanges.get(k); return s && s.size === 1 && !s.has('unassigned') ? [...s][0] : null; }) >= 2) res.D = true;
    const runCount = new Map<string, Set<string>>();
    for (const k of keys) for (const r of i.runs.get(k) ?? []) { const rk = `${r.start}-${r.end}`; if (!runCount.has(rk)) runCount.set(rk, new Set()); runCount.get(rk)!.add(k); }
    if ([...runCount.values()].some(s => s.size >= 2)) res.E = true;
  }
  return res;
}

export type ProvenanceDecision = 'CLUSTER_PROVENANCE_STRUCTURALLY_LOCALIZED' | 'CLUSTER_PROVENANCE_REPRODUCIBLE_BUT_DIFFUSE' | 'CLUSTER_PROVENANCE_INCOMPLETE' | 'INVALID';
/** 順序: INVALID → D3 → D1 → D2 */
export function decideProvenance(f: { gatesPass: boolean; b6: number; joinComplete: boolean; patterns: Patterns }): { decision: ProvenanceDecision; rule: string } {
  if (!f.gatesPass) return { decision: 'INVALID', rule: 'gate' };
  if (f.b6 > 0 || !f.joinComplete) return { decision: 'CLUSTER_PROVENANCE_INCOMPLETE', rule: 'D3' };
  if (Object.values(f.patterns).some(Boolean)) return { decision: 'CLUSTER_PROVENANCE_STRUCTURALLY_LOCALIZED', rule: 'D1' };
  return { decision: 'CLUSTER_PROVENANCE_REPRODUCIBLE_BUT_DIFFUSE', rule: 'D2' };
}
