/**
 * DocumentHierarchy A2 最終実験の評価側の設定と判定（GTを読む評価側。推論側はこのファイルを知らない）。
 * development / holdout / integration の判定は実験計画と指示書で事前に固定した基準を機械的に適用する。
 */
import type { Counts, GtNode, MatchOptions, SummaryMatchMode } from './budget-request-document-hierarchy-eval';

type Scope = (n: GtNode, rootOf: (k: string) => string) => boolean;
const all: Scope = () => true;
const inRange: Scope = n => n.inDetailRange !== false;
const subtree = (orgKey: string): Scope => (n, rootOf) => rootOf(n.key) === orgKey;

export interface A2EvalConfig {
  id: string;
  gtFile: string;
  scope: Scope;
  summaryMode: SummaryMatchMode;
}
export const A2_EVAL_CONFIGS: A2EvalConfig[] = [
  { id: 'meti-detail', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'env-detail', gtFile: 'env-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'maff-fukko-detail', gtFile: 'maff-fukko-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mlit-fukko-detail', gtFile: 'mlit-fukko-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mhlw-summary', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: all, summaryMode: 'pageRef' },
  { id: 'mhlw-detail', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: all, summaryMode: 'pageRef' },
  { id: 'meti-summary', gtFile: 'meti-toc-hierarchy-gt.json', scope: all, summaryMode: 'codeName' },
  { id: 'mext-summary', gtFile: 'mext-toc-hierarchy-gt.json', scope: all, summaryMode: 'codeName' },
  { id: 'mext-detail', gtFile: 'mext-toc-hierarchy-gt.json', scope: inRange, summaryMode: 'pageRef' },
  { id: 'meti-detail-pre-header', gtFile: 'meti-toc-hierarchy-gt.json', scope: n => n.printedStartPage + 4 <= 103, summaryMode: 'pageRef' },
  { id: 'meti-detail-narrow', gtFile: 'meti-toc-hierarchy-gt.json', scope: subtree('org-035'), summaryMode: 'pageRef' },
  { id: 'mext-detail-narrow', gtFile: 'mext-toc-hierarchy-gt.json', scope: subtree('org-030'), summaryMode: 'pageRef' },
  { id: 'mhlw-detail-narrow', gtFile: 'mhlw-toc-hierarchy-gt-extended.json', scope: subtree('org-070'), summaryMode: 'pageRef' },
  { id: 'mod-general-detail', gtFile: 'mod-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
  { id: 'cfa-general-detail', gtFile: 'cfa-toc-hierarchy-gt.json', scope: all, summaryMode: 'pageRef' },
];
export const A2_MATCHERS: { name: 'preregistered' | 'posthoc'; opts: MatchOptions }[] = [
  { name: 'preregistered', opts: {} },
  { name: 'posthoc', opts: { nameOnly: true, ordinalTiebreak: true } },
];

export const sigOf = (c: Counts): string => JSON.stringify([c.gtEdges, c.exact, c.falseParent, c.unresolved, c.childNotFound, c.ancestorExact, c.depthExact, c.nodesMatched]);
export const depthRate = (c: Counts): number => (c.depthExact.n ? c.depthExact.x / c.depthExact.n : 0);

export type HoldoutClass = 'INFORMATIVE-PASS' | 'INFORMATIVE-FAIL' | 'NON-INFORMATIVE' | 'NON-INFORMATIVE-FAIL';

/**
 * A2 holdout の分類（事前登録: INFORMATIVE = v1 の depth exact が 90% 未満）。
 * INFORMATIVE: A2 の depth >= 90%・false parent の増加 0・GT hierarchy node の誤除外 0・exact は v1 以上・除外された全ての行が3つの evidence を満たす → PASS。
 * NON-INFORMATIVE: v1 が壊れていない。A2 が v1 と同じ指標で GT node を除外しなければ NON-INFORMATIVE（成功とも失敗とも数えない）。
 *   A2 が false parent を増やす／GT node を除外する／exact・depth を v1 より下げる → NON-INFORMATIVE-FAIL（stop condition）。
 */
export function classifyHoldout(i: { v1: Counts; a2: Counts; gtExcluded: number; allExcludedHaveThreeEvidence: boolean }): { cls: HoldoutClass; informative: boolean; reasons: string[] } {
  const informative = depthRate(i.v1) < 0.9;
  const reasons: string[] = [];
  const falseUp = i.a2.falseParent > i.v1.falseParent;
  const worse = i.a2.exact < i.v1.exact || i.a2.depthExact.x < i.v1.depthExact.x;
  if (i.gtExcluded > 0) reasons.push(`GT hierarchy node excluded (${i.gtExcluded})`);
  if (falseUp) reasons.push('false parent increased');
  if (!i.allExcludedHaveThreeEvidence) reasons.push('an excluded row lacks one of the three evidence');
  if (informative) {
    if (depthRate(i.a2) < 0.9) reasons.push('A2 depth < 90% on an informative holdout');
    if (i.a2.exact < i.v1.exact) reasons.push('exact parent decreased');
    return reasons.length ? { cls: 'INFORMATIVE-FAIL', informative, reasons } : { cls: 'INFORMATIVE-PASS', informative, reasons: ['v1 depth < 90%; A2 depth >= 90%; no false-parent increase; no GT node excluded'] };
  }
  if (worse) reasons.push('A2 decreased exact or depth vs v1 on a non-informative holdout');
  if (reasons.length) return { cls: 'NON-INFORMATIVE-FAIL', informative, reasons };
  return { cls: 'NON-INFORMATIVE', informative, reasons: [sigOf(i.v1) === sigOf(i.a2) ? 'v1 not broken (depth >= 90%); A2 identical to v1' : 'v1 not broken (depth >= 90%); A2 changed metrics without regression'] };
}

/** A2 の最終判定（指示書 §15） */
export function a2Judgment(i: { developmentPassed: boolean; holdouts: HoldoutClass[] }): 'GO' | 'STOP' | 'INCONCLUSIVE' {
  if (!i.developmentPassed) return 'STOP';
  if (i.holdouts.some(h => h === 'INFORMATIVE-FAIL' || h === 'NON-INFORMATIVE-FAIL')) return 'STOP';
  return i.holdouts.some(h => h === 'INFORMATIVE-PASS') ? 'GO' : 'INCONCLUSIVE';
}

/**
 * B+A2 の統合確認（指示書 §16。A2 = GO のときだけ実行）。各実験で、B+A2 が単独の成分（v1・B・A2）の最良の exact・depth を下回らず、
 * false parent が v1 より増えず、GT node を除外しないこと。
 */
export function integrationOk(c: { v1: Counts; b: Counts; a2: Counts; ba2: Counts; gtExcluded: number }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const bestExact = Math.max(c.v1.exact, c.b.exact, c.a2.exact);
  const bestDepth = Math.max(c.v1.depthExact.x, c.b.depthExact.x, c.a2.depthExact.x);
  if (c.ba2.exact < bestExact) reasons.push(`exact ${c.ba2.exact} < best component ${bestExact}`);
  if (c.ba2.depthExact.x < bestDepth) reasons.push(`depth ${c.ba2.depthExact.x} < best component ${bestDepth}`);
  if (c.ba2.falseParent > c.v1.falseParent) reasons.push('false parent increased');
  if (c.gtExcluded > 0) reasons.push(`GT node excluded (${c.gtExcluded})`);
  return { ok: reasons.length === 0, reasons };
}
