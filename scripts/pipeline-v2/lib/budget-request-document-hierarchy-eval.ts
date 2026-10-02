/**
 * DocumentHierarchy PoC — 段階B（評価）。推論artifact（段階A）と評価専用のGround Truthを突き合わせる。
 * GTを読むのはこのモジュール（と呼び出し側CLI・テスト）だけ。推論側（budget-request-document-hierarchy.ts）はここを知らない。
 *
 * matching（推論nodeとGT nodeの対応づけ。評価側だけの処理）:
 * - detail: sourcePage == printedStartPage + offset かつ形（要求=request_no_then_code / それ以外=code3_then_text）とコード列が一致。
 * - summary: 形とコード列が一致し、printedPageRefCandidate == printedStartPage。
 * 候補が0件=not_found、2件以上=ambiguous_match（どちらも「見つからない」として数える。1つに決めない）。
 * ただし候補が2件以上のときだけ、見出し行のtext parts連結とGT名称の前方一致で絞る（nameTiebreak。評価側の照合の補助で、推論には使わない）。
 */
import type { DocumentHierarchyEdgeCandidate, DocumentHierarchyNodeObservation, DocumentHierarchyResult } from './budget-request-document-hierarchy';

export interface GtNode {
  key: string;
  depth: number;
  parent?: string;
  code: string;
  requestNo?: string;
  name: string;
  printedStartPage: number;
  set: 'development' | 'holdout' | 'test';
  inResearchGT?: boolean;
  /** 明細の走査範囲内か（範囲外の組織は明細viewの母数に入れない）。省略=範囲内 */
  inDetailRange?: boolean;
}

export type EdgeOutcome = 'exact' | 'false_parent' | 'unresolved' | 'child_not_found';

export interface EdgeEvaluation {
  childKey: string;
  gtParentKey: string;
  outcome: EdgeOutcome;
  childNodeId: string | null;
  predictedParentNodeId: string | null;
  predictedParentGtKey: string | null;
  status: string | null;
  note?: string;
}

export interface Counts {
  gtEdges: number;
  exact: number;
  falseParent: number;
  unresolved: number;
  childNotFound: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  ancestorExact: { x: number; n: number };
  depthExact: { x: number; matched: number; n: number };
  nodesMatched: { x: number; n: number };
}

const HYPHENS = /[‐-―−]/g;
const normCode = (s: string): string => s.replace(HYPHENS, '-').trim();
const ratio = (x: number, n: number): number | null => (n === 0 ? null : Math.round((x / n) * 1000) / 1000);

export interface MatchResult {
  matched: Map<string, DocumentHierarchyNodeObservation>;
  status: Map<string, 'matched' | 'not_found' | 'ambiguous_match'>;
}

const compact = (s: string): string => s.replace(/\s+/g, '');

/** 候補が複数のときだけの絞り込み（評価側）: 見出し行のtext partsを連結した文字列とGTの名称が前方一致の関係にあるもの */
function nameOnlyOf(n: DocumentHierarchyNodeObservation): string {
  const parts: string[] = [];
  for (const p of n.observedTextParts) {
    if (/\d/.test(p)) break;
    parts.push(p);
  }
  return compact(parts.join(''));
}
function nameCompatibleNameOnly(n: DocumentHierarchyNodeObservation, gtName: string): { ok: boolean; exact: boolean } {
  const a = nameOnlyOf(n);
  const g = compact(gtName);
  return { ok: a.length >= 2 && (a === g || g.startsWith(a)), exact: a === g };
}
function nameCompatible(n: DocumentHierarchyNodeObservation, gtName: string): boolean {
  const t = compact(n.observedTextParts.join(''));
  const g = compact(gtName);
  return t.startsWith(g) || g.startsWith(t);
}

/**
 * summaryMode: 'pageRef'（既定。MHLWと同じ: v1の頁数列の候補==印字開始頁）/ 'codeName'（形・コードが一致し、名称が前方一致する候補。
 * v1の頁数列の候補が4桁限定のため1–3桁の頁数を取れない文書用の、評価側だけの補助）。detail には影響しない。
 */
export type SummaryMatchMode = 'pageRef' | 'codeName';

/**
 * 事後診断用の照合オプション（既定は無効。MHLW・事前固定の評価の挙動は変わらない）。
 * nameOnly: 名称の比較を「見出し行のtext partsのうち最初の数字を含むtokenの手前まで」に限り、完全一致を優先する
 *   （組織名で始まる項名や、折返しで途中までしか印字されない名称で前方一致が曖昧になるのを避ける）。
 * ordinalTiebreak: 同じ（形・コード・要求番号・名称）のGT nodeが複数あり、推論側の候補数が同じとき、文書順の序数で対応づける（summaryのみ）。
 */
export interface MatchOptions {
  nameOnly?: boolean;
  ordinalTiebreak?: boolean;
}

export function matchGtNodes(result: DocumentHierarchyResult, gt: GtNode[], pageOffset: number, nameTiebreak = true, summaryMode: SummaryMatchMode = 'pageRef', opts: MatchOptions = {}): MatchResult {
  const matched = new Map<string, DocumentHierarchyNodeObservation>();
  const status = new Map<string, 'matched' | 'not_found' | 'ambiguous_match'>();
  for (const g of gt) {
    const wantShape = g.requestNo ? 'request_no_then_code' : 'code3_then_text';
    const cands = result.nodes.filter(n => {
      if (n.rowShape !== wantShape) return false;
      if (normCode(n.observedCodeParts.code) !== normCode(g.code)) return false;
      if (g.requestNo && n.observedCodeParts.requestNo !== g.requestNo) return false;
      if (result.view === 'detail') return n.sourcePage === g.printedStartPage + pageOffset;
      return summaryMode === 'codeName' ? true : n.structureEvidence.printedPageRefCandidate === String(g.printedStartPage);
    });
    let picked: DocumentHierarchyNodeObservation[];
    const useName = (cands.length > 1 && nameTiebreak) || (result.view === 'summary' && summaryMode === 'codeName');
    if (opts.nameOnly && useName) {
      const ok = cands.map(c => ({ c, r: nameCompatibleNameOnly(c, g.name) })).filter(x => x.r.ok);
      const exact = ok.filter(x => x.r.exact);
      picked = (exact.length > 0 ? exact : ok).map(x => x.c);
    } else picked = useName ? cands.filter(c => nameCompatible(c, g.name)) : cands;
    if (picked.length > 1 && opts.ordinalTiebreak && result.view === 'summary') {
      const sig = (x: GtNode): string => `${x.requestNo ?? ''}|${x.code}|${compact(x.name)}`;
      const dups = gt.filter(x => sig(x) === sig(g));
      if (dups.length === picked.length) picked = [picked[dups.indexOf(g)]];
    }
    if (picked.length === 1) {
      matched.set(g.key, picked[0]);
      status.set(g.key, 'matched');
    } else status.set(g.key, picked.length === 0 ? 'not_found' : 'ambiguous_match');
  }
  return { matched, status };
}

export function evaluateView(result: DocumentHierarchyResult, gt: GtNode[], pageOffset: number, nameTiebreak = true, summaryMode: SummaryMatchMode = 'pageRef', opts: MatchOptions = {}): { edges: EdgeEvaluation[]; match: MatchResult; nodeIdToGtKey: Map<string, string> } {
  const match = matchGtNodes(result, gt, pageOffset, nameTiebreak, summaryMode, opts);
  const nodeIdToGtKey = new Map<string, string>();
  for (const [k, n] of match.matched) nodeIdToGtKey.set(n.id, k);
  const edgeByChild = new Map<string, DocumentHierarchyEdgeCandidate>(result.edges.map(e => [e.childNodeId, e]));
  const edges: EdgeEvaluation[] = [];
  for (const g of gt) {
    if (!g.parent) continue;
    const child = match.matched.get(g.key);
    if (!child) {
      edges.push({ childKey: g.key, gtParentKey: g.parent, outcome: 'child_not_found', childNodeId: null, predictedParentNodeId: null, predictedParentGtKey: null, status: null, note: match.status.get(g.key) });
      continue;
    }
    const e = edgeByChild.get(child.id);
    const predictedParentGtKey = e?.parentNodeId ? (nodeIdToGtKey.get(e.parentNodeId) ?? null) : null;
    let outcome: EdgeOutcome;
    if (!e || e.status !== 'resolved_by_indent_sequence' || !e.parentNodeId) outcome = 'unresolved';
    else outcome = predictedParentGtKey === g.parent ? 'exact' : 'false_parent';
    edges.push({ childKey: g.key, gtParentKey: g.parent, outcome, childNodeId: child.id, predictedParentNodeId: e?.parentNodeId ?? null, predictedParentGtKey, status: e?.status ?? null, ...(outcome === 'false_parent' && !predictedParentGtKey ? { note: 'predicted parent is not a GT node' } : {}) });
  }
  return { edges, match, nodeIdToGtKey };
}

/** gtSubset: 集計対象のGT node（edgeはchildがこの集合に含まれるもの） */
export function summarize(result: DocumentHierarchyResult, gtAll: GtNode[], subsetKeys: Set<string>, ev: ReturnType<typeof evaluateView>): Counts {
  const gtByKey = new Map(gtAll.map(g => [g.key, g]));
  const edges = ev.edges.filter(e => subsetKeys.has(e.childKey));
  const exact = edges.filter(e => e.outcome === 'exact').length;
  const falseParent = edges.filter(e => e.outcome === 'false_parent').length;
  const unresolved = edges.filter(e => e.outcome === 'unresolved').length;
  const childNotFound = edges.filter(e => e.outcome === 'child_not_found').length;
  const precision = ratio(exact, exact + falseParent);
  const recall = ratio(exact, edges.length);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000 : null;

  const edgeByChild = new Map(result.edges.map(e => [e.childNodeId, e]));
  const gtAncestors = (key: string): string[] => {
    const out: string[] = [];
    for (let p = gtByKey.get(key)?.parent; p; p = gtByKey.get(p)?.parent) out.push(p);
    return out;
  };
  let ancX = 0;
  let ancN = 0;
  let depthX = 0;
  let depthMatched = 0;
  let depthN = 0;
  let nodesMatched = 0;
  for (const k of subsetKeys) {
    const g = gtByKey.get(k) as GtNode;
    depthN++;
    const m = ev.match.matched.get(k);
    if (m) {
      nodesMatched++;
      depthMatched++;
      if (m.xIndentEvidence.level === g.depth) depthX++;
    }
    if (!g.parent) continue; // 祖先を持つnodeだけ
    ancN++;
    if (!m) continue;
    // 推論側の祖先chain（resolvedな親edgeだけを辿る）をGT keyへ写して、GTの祖先集合と完全一致するか
    const chain: (string | null)[] = [];
    for (let cur = edgeByChild.get(m.id); cur; ) {
      if (!cur.parentNodeId) break; // root（親なし）
      if (cur.status !== 'resolved_by_indent_sequence') {
        chain.push('__broken__');
        break;
      }
      chain.push(ev.nodeIdToGtKey.get(cur.parentNodeId) ?? null);
      cur = edgeByChild.get(cur.parentNodeId);
    }
    const want = gtAncestors(k);
    if (chain.length === want.length && want.every(w => chain.includes(w)) && chain.every(c => c !== null && c !== '__broken__')) ancX++;
  }
  return { gtEdges: edges.length, exact, falseParent, unresolved, childNotFound, precision, recall, f1, ancestorExact: { x: ancX, n: ancN }, depthExact: { x: depthX, matched: depthMatched, n: depthN }, nodesMatched: { x: nodesMatched, n: subsetKeys.size } };
}

export type Verdict = 'SUCCESS' | 'PARTIAL' | 'FAIL' | 'EVALUATION BLOCKED';
/** 実験計画で固定した判定基準 */
export function verdictOf(c: Counts): Verdict {
  const n = c.nodesMatched.n;
  if (n === 0 || c.nodesMatched.x / n < 0.5) return 'EVALUATION BLOCKED';
  const exact = c.gtEdges ? c.exact / c.gtEdges : 0;
  const fals = c.gtEdges ? c.falseParent / c.gtEdges : 0;
  const depth = c.depthExact.n ? c.depthExact.x / c.depthExact.n : 0;
  if (exact >= 0.9 && fals <= 0.05 && depth >= 0.9) return 'SUCCESS';
  if (exact >= 0.5 && fals <= 0.1) return 'PARTIAL';
  return 'FAIL';
}
