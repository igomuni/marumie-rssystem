/**
 * 概算要求PDF（既存の抽出 population）× MOF V2 事項 の deterministic な照合（P1）。規則は
 * docs/tasks/20261005_0608_Budget_Request_MOF_Reconciliation_P1_Preregistration.md（凍結済み）のとおり。
 * 名称は同一の normalizeKey（NFKC + 空白除去）で比べる exact 照合のみ。金額・コード・fuzzy・substring による正式 match は行わない。
 * 純関数（fs・network に触れない）。
 */
import { normalizeText } from './stable-id';

/** preregistration §4: NFKC のあと全空白を除去。V2 の normalizeText と同じ関数 */
export const normalizeKey = normalizeText;

export interface NameValue { raw: string; normalized: string | null }
export interface ParentRef { status: string; reasonCode: string | null; ref: string | null; recordKind: string | null; name: NameValue | null; rawCode: string | null }
export interface PdfPopulationRecord {
  runId: string; canonicalUrl: string; sourceAuthority: string; accountType: string;
  page: number; logicalRowIndex: number; recordKind: 'item' | 'request';
  rawCode: string | null; nameStatus: string; name: NameValue | null;
  parentOrganization: ParentRef; parentItem: ParentRef | null;
}
export interface MofSection { id: string; organization: string; sectionName: string }
export interface MofJikou { parentSectionId: string; jikouName: string; recordId: string }

export type MatchClass = 'exact_unique' | 'exact_ambiguous' | 'no_exact_match' | 'parent_unresolved' | 'name_unavailable' | 'out_of_scope';
export interface MatchResult {
  runId: string; canonicalUrl: string; sourceAuthority: string; page: number; logicalRowIndex: number; recordKind: 'item' | 'request';
  classification: MatchClass;
  /** parent_unresolved の理由 */
  reason: string | null;
  /** item: 一致した section id、request: 一致した jikou recordId（候補が 1 件のとき） */
  matchedId: string | null;
  candidateIds: string[];
  /** exact_unique 以外の record に付ける診断（正式な分類ではない） */
  diagnostic: string | null;
}

const locatorOf = (r: { runId: string; page: number; logicalRowIndex: number }) => `${r.runId}#${r.page}:${r.logicalRowIndex}`;
const anchorOfRef = (runId: string, ref: string | null) => { const m = ref ? /-p(\d+)-r(\d+)$/.exec(ref) : null; return m ? `${runId}#${m[1]}:${m[2]}` : null; };

function classifyCandidates(ids: string[]): MatchClass { return ids.length === 0 ? 'no_exact_match' : ids.length === 1 ? 'exact_unique' : 'exact_ambiguous'; }

/** 全 PDF record を照合する。item を先に解決し、request は親の項が exact_unique のものだけ section 配下の jikou と照合する */
export function reconcile(population: PdfPopulationRecord[], sections: MofSection[], jikou: MofJikou[]): MatchResult[] {
  const sectionsByOrgName = new Map<string, MofSection[]>();
  const sectionsByOrg = new Map<string, MofSection[]>();
  const sectionsByName = new Map<string, MofSection[]>();
  for (const s of sections) {
    const o = normalizeKey(s.organization), n = normalizeKey(s.sectionName);
    for (const [m, k] of [[sectionsByOrgName, `${o}\x1f${n}`], [sectionsByOrg, o], [sectionsByName, n]] as const) m.set(k, [...(m.get(k) ?? []), s]);
  }
  const jikouBySection = new Map<string, MofJikou[]>();
  for (const j of jikou) jikouBySection.set(j.parentSectionId, [...(jikouBySection.get(j.parentSectionId) ?? []), j]);

  const base = (r: PdfPopulationRecord) => ({ runId: r.runId, canonicalUrl: r.canonicalUrl, sourceAuthority: r.sourceAuthority, page: r.page, logicalRowIndex: r.logicalRowIndex, recordKind: r.recordKind });
  const done = (r: PdfPopulationRecord, classification: MatchClass, reason: string | null, ids: string[], diagnostic: string | null): MatchResult =>
    ({ ...base(r), classification, reason, matchedId: classification === 'exact_unique' ? ids[0] : null, candidateIds: ids, diagnostic: classification === 'exact_unique' ? null : diagnostic });

  const results = new Map<string, MatchResult>();
  // ---- Stage 1: 項 ----
  for (const r of population.filter(x => x.recordKind === 'item')) {
    let res: MatchResult;
    if (r.accountType !== 'general') res = done(r, 'out_of_scope', null, [], 'out_of_scope');
    else if (!r.name) res = done(r, 'name_unavailable', null, [], 'pdf_name_unavailable');
    else if (!r.parentOrganization.name) res = done(r, 'parent_unresolved', 'organization_unresolved', [], 'parent_unresolved:organization_unresolved');
    else {
      const o = normalizeKey(r.parentOrganization.name.raw), n = normalizeKey(r.name.raw);
      const cands = (sectionsByOrgName.get(`${o}\x1f${n}`) ?? []).map(s => s.id);
      const cls = classifyCandidates(cands);
      let diag: string | null = null;
      if (cls === 'no_exact_match') diag = !sectionsByOrg.has(o) ? 'mof_organization_absent' : sectionsByName.has(n) ? 'item_in_other_organization' : 'item_name_differs_in_organization';
      else if (cls === 'exact_ambiguous') diag = 'unknown';
      res = done(r, cls, null, cands, diag);
    }
    results.set(locatorOf(r), res);
  }
  // ---- Stage 2: 事項（親の項が exact_unique のときだけ） ----
  for (const r of population.filter(x => x.recordKind === 'request')) {
    let res: MatchResult;
    if (r.accountType !== 'general') res = done(r, 'out_of_scope', null, [], 'out_of_scope');
    else if (!r.name) res = done(r, 'name_unavailable', null, [], 'pdf_name_unavailable');
    else {
      const p = r.parentItem;
      let reason: string | null = null;
      let parentSection: string | null = null;
      if (!p || p.status === 'not_observed') reason = 'parent_item_not_observed';
      else if (p.status !== 'resolved') reason = 'parent_item_unresolved';
      else if (p.recordKind !== 'item') reason = 'parent_item_not_item_kind';
      else if (!p.name) reason = 'parent_item_name_unavailable';
      else {
        const pr = results.get(anchorOfRef(r.runId, p.ref) ?? '');
        if (!pr || pr.recordKind !== 'item') reason = 'parent_item_unresolved';
        else if (pr.classification === 'no_exact_match') reason = 'parent_item_no_match';
        else if (pr.classification === 'exact_ambiguous') reason = 'parent_item_ambiguous';
        else if (pr.classification !== 'exact_unique') reason = 'parent_item_unresolved';
        else parentSection = pr.matchedId;
      }
      if (reason || !parentSection) res = done(r, 'parent_unresolved', reason, [], `parent_unresolved:${reason}`);
      else {
        const key = normalizeKey(r.name.raw);
        const under = jikouBySection.get(parentSection) ?? [];
        const cands = under.filter(j => normalizeKey(j.jikouName) === key).map(j => j.recordId);
        const cls = classifyCandidates(cands);
        let diag: string | null = null;
        if (cls === 'no_exact_match') {
          const longer = under.filter(j => { const m = normalizeKey(j.jikouName); return m.length > key.length && m.startsWith(key); });
          const shorter = under.filter(j => { const m = normalizeKey(j.jikouName); return m.length > 0 && m.length < key.length && key.startsWith(m); });
          diag = longer.length === 1 ? 'request_name_is_prefix_of_mof' : shorter.length === 1 ? 'mof_name_is_prefix_of_pdf' : 'request_name_differs_under_parent';
        } else if (cls === 'exact_ambiguous') diag = 'unknown';
        res = done(r, cls, null, cands, diag);
      }
    }
    results.set(locatorOf(r), res);
  }
  return population.map(r => results.get(locatorOf(r))!);
}

export interface Tally { total: number; byClass: Record<MatchClass, number>; exactUniqueRate: number }
const CLASSES: MatchClass[] = ['exact_unique', 'exact_ambiguous', 'no_exact_match', 'parent_unresolved', 'name_unavailable', 'out_of_scope'];
export function tally(rows: MatchResult[]): Tally {
  const byClass = Object.fromEntries(CLASSES.map(c => [c, rows.filter(r => r.classification === c).length])) as Record<MatchClass, number>;
  return { total: rows.length, byClass, exactUniqueRate: rows.length === 0 ? 0 : byClass.exact_unique / rows.length };
}

export type Decision = 'GO_TO_NEXT_DESIGN' | 'NEEDS_MORE_ISOLATION' | 'STOP';
/** preregistration §9: STOP = 一般会計・名称解決済みの比較可能 record が 0 / GO = 非 exact_unique の 90% 以上が unknown 以外に分類され、かつ 1 カテゴリが非 exact_unique の 30% 以上 */
export function decide(results: MatchResult[], comparableCount: number): { decision: Decision; nonExact: number; classifiedShare: number; topCategory: string | null; topShare: number } {
  const nonExact = results.filter(r => r.classification !== 'exact_unique');
  const counts = new Map<string, number>();
  for (const r of nonExact) counts.set(r.diagnostic ?? 'unknown', (counts.get(r.diagnostic ?? 'unknown') ?? 0) + 1);
  const classified = nonExact.filter(r => (r.diagnostic ?? 'unknown') !== 'unknown').length;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const classifiedShare = nonExact.length === 0 ? 1 : classified / nonExact.length;
  const topShare = nonExact.length === 0 || !top ? 0 : top[1] / nonExact.length;
  if (comparableCount === 0) return { decision: 'STOP', nonExact: nonExact.length, classifiedShare, topCategory: top?.[0] ?? null, topShare };
  const go = classifiedShare >= 0.9 && topShare >= 0.3;
  return { decision: go ? 'GO_TO_NEXT_DESIGN' : 'NEEDS_MORE_ISOLATION', nonExact: nonExact.length, classifiedShare, topCategory: top?.[0] ?? null, topShare };
}
