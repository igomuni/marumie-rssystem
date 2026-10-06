/**
 * FY2024 概算要求 full-corpus baseline — MOF V2 FY2024 一般会計 当初予算との deterministic な照合（P1 の matcher を無修正で使用）。
 * 入力: extraction-only baseline（凍結済みの population）と #371 の budget-jikou.jsonl。会計は manifest の accountType（既存 metadata）だけで決める。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-corpus-baseline-reconciliation.ts
 * 出力: tests/fixtures/budget-request-full-corpus-baseline/2024/reconciliation-result.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl } from './lib/jsonl';
import { reconcile, tally, decide, type MatchResult, type MofJikou, type MofSection, type PdfPopulationRecord } from './lib/budget-request-mof-reconciliation';
import type { MofBudgetJikouRecord } from './types';

const DIR = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const POP = path.join(DIR, 'extraction-population.json');
const EXTRACTION = path.join(DIR, 'extraction-baseline.json');
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const JIKOU_EVAL = path.join('tests', 'fixtures', 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json');
const P1_RESULT = path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024', 'p1-reconciliation-result.json');
const OUT = path.join(DIR, 'reconciliation-result.json');
const MATCHER = 'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts';
const FROZEN: Record<string, string> = {
  [POP]: '3ec53c133117033ea0c8a8f23a3196f5b28ff18120957c7531c48c6df15fdbf8', [EXTRACTION]: '89b28cbea73c9b7384e80cd2927c3c6ee35eabc4baf0f042730943657be4069f',
  [MATCHER]: 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
};
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortObj = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b)));

interface PopRec { localPath: string; segment: [number, number]; mode: string; sourceAuthority: string; accountType: string; page: number; logicalRowIndex: number; recordKind: 'item' | 'request'; rawCode: string | null; nameStatus: string; nameReason: string | null; name: { raw: string; normalized: string | null } | null; parentOrganization: PdfPopulationRecord['parentOrganization']; parentItem: PdfPopulationRecord['parentItem'] }

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (sha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const jikouSha = sha(JIKOU);
  if (jikouSha !== (JSON.parse(fs.readFileSync(JIKOU_EVAL, 'utf8')) as { output: { sha256: string } }).output.sha256) throw new Error('budget-jikou.jsonl が #371 の記録と一致しない（STOP）');
  const pop = (JSON.parse(fs.readFileSync(POP, 'utf8')) as { population: PopRec[] }).population;
  const extraction = JSON.parse(fs.readFileSync(EXTRACTION, 'utf8')) as { document: { totalPdfs: number; status: Record<string, number> }; byMinistry: Record<string, Record<string, number>>; failureDistribution: { C_nameResolution: Record<string, Record<string, number>>; D_hierarchy: Record<string, number>; B_recordDetection: { unclassifiedRecords: number } } };

  const jikouRows = readJsonl<MofBudgetJikouRecord>(JIKOU);
  const sectionMap = new Map<string, MofSection>();
  for (const j of jikouRows) if (!sectionMap.has(j.parentSectionId)) sectionMap.set(j.parentSectionId, { id: j.parentSectionId, organization: j.organization, sectionName: j.sectionName });
  const sections = [...sectionMap.values()];
  const jikou: MofJikou[] = jikouRows.map(j => ({ parentSectionId: j.parentSectionId, jikouName: j.jikouName, recordId: j.recordId }));

  // 会計は manifest の accountType のみ。general / special 以外は account_scope_unresolved（matcher には渡さない）
  const unresolvedAccount = pop.filter(p => p.accountType !== 'general' && p.accountType !== 'special');
  const inScopeOrSpecial = pop.filter(p => p.accountType === 'general' || p.accountType === 'special');
  const toP = (p: PopRec): PdfPopulationRecord => ({ runId: `${p.localPath}@${p.segment[0]}-${p.segment[1]}`, canonicalUrl: p.localPath, sourceAuthority: p.sourceAuthority, accountType: p.accountType, page: p.page, logicalRowIndex: p.logicalRowIndex, recordKind: p.recordKind, rawCode: p.rawCode, nameStatus: p.nameStatus, name: p.name, parentOrganization: p.parentOrganization, parentItem: p.parentItem });
  const results = reconcile(inScopeOrSpecial.map(toP), sections, jikou);
  const items = results.filter(r => r.recordKind === 'item');
  const requests = results.filter(r => r.recordKind === 'request');
  const general = (r: MatchResult, i: number) => inScopeOrSpecial[i].accountType === 'general';
  void general;
  const withScope = results.map((r, i) => ({ r, p: inScopeOrSpecial[i] }));
  const gItems = withScope.filter(x => x.p.recordKind === 'item' && x.p.accountType === 'general');
  const gReq = withScope.filter(x => x.p.recordKind === 'request' && x.p.accountType === 'general');
  const t = (rows: { r: MatchResult }[]) => tally(rows.map(x => x.r));
  const reachedStage = (x: { r: MatchResult }) => ['exact_unique', 'exact_ambiguous', 'no_exact_match'].includes(x.r.classification);
  const cond = (rows: { r: MatchResult }[]) => { const d = rows.filter(reachedStage); return { comparable: d.length, exactUnique: d.filter(x => x.r.classification === 'exact_unique').length, rate: d.length === 0 ? null : d.filter(x => x.r.classification === 'exact_unique').length / d.length }; };

  // 省庁別
  const byMinistry: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(extraction.byMinistry)) byMinistry[k] = { ...v, comparableItems: 0, itemsExactUnique: 0, itemsNoExactMatch: 0, comparableRequests: 0, requestsExactUnique: 0, requestsNoExactMatch: 0 };
  for (const x of withScope) {
    if (x.p.accountType !== 'general') continue;
    const m = byMinistry[`${x.p.sourceAuthority}|${x.p.accountType}`];
    if (!m || !reachedStage(x)) continue;
    if (x.p.recordKind === 'item') { m.comparableItems++; if (x.r.classification === 'exact_unique') m.itemsExactUnique++; if (x.r.classification === 'no_exact_match') m.itemsNoExactMatch++; }
    else { m.comparableRequests++; if (x.r.classification === 'exact_unique') m.requestsExactUnique++; if (x.r.classification === 'no_exact_match') m.requestsNoExactMatch++; }
  }

  // funnel（request。denominator を段階ごとに明記）
  const reqAll = pop.filter(p => p.recordKind === 'request');
  const funnel = {
    pdfs: extraction.document.totalPdfs, pdfsExtractedSuccessfully: extraction.document.status.success ?? 0,
    pdfsWithItemOrRequest: new Set(pop.map(p => p.localPath)).size,
    requestsExtracted: reqAll.length,
    requestsGeneralAccount: reqAll.filter(p => p.accountType === 'general').length,
    requestsOutOfScopeSpecialAccount: reqAll.filter(p => p.accountType === 'special').length,
    requestsAccountScopeUnresolved: unresolvedAccount.filter(p => p.recordKind === 'request').length,
    requestsGeneralNameAvailable: reqAll.filter(p => p.accountType === 'general' && p.name !== null).length,
    requestsGeneralParentItemKindResolved: reqAll.filter(p => p.accountType === 'general' && p.name !== null && p.parentItem?.status === 'resolved' && p.parentItem.recordKind === 'item').length,
    requestsGeneralParentMatchedExactUnique: gReq.filter(reachedStage).length,
    requestsExactUnique: gReq.filter(x => x.r.classification === 'exact_unique').length,
  };

  const diag = (rows: { r: MatchResult }[]) => { const o: Record<string, number> = {}; rows.filter(x => x.r.classification !== 'exact_unique').forEach(x => inc(o, x.r.diagnostic ?? 'unknown')); return sortObj(o); };
  const outOfScope = (rows: MatchResult[]) => rows.filter(r => r.classification === 'out_of_scope').length;
  const comparableRequests = gReq.filter(reachedStage).length;
  const dec = decide(gReq.map(x => x.r), gReq.filter(x => x.p.name !== null).length);
  const failedPdfs = (extraction.document.status.hard_failure ?? 0) + (extraction.document.status.exception ?? 0);
  const decision = failedPdfs >= Math.ceil(0.25 * extraction.document.totalPdfs) || comparableRequests < 30 ? 'NEEDS_BASELINE_INFRASTRUCTURE' : 'GO_TO_FAILURE_PRIORITIZATION';

  // 次の候補（preregistration §9: 影響 record 数（降順）→ 影響 PDF 数（降順））。分類間で record が重なり得る
  const C = extraction.failureDistribution.C_nameResolution;
  const sumReason = (reason: string) => Object.values(C).reduce((n, k) => n + (k[reason] ?? 0), 0);
  const cand = [
    { failureClass: 'B: recordKind が unclassified（item / organization を hierarchy 無しでは判別できない）', stage: 'hierarchy / record detection', records: extraction.failureDistribution.B_recordDetection.unclassifiedRecords },
    { failureClass: 'C: name.status=ambiguous / continuation_ambiguous', stage: 'FieldResolver（名称の継続）', records: sumReason('continuation_ambiguous') },
    { failureClass: 'C: name.status=unresolved / column_layout_unobserved', stage: 'FieldResolver（column layout）', records: sumReason('column_layout_unobserved') },
    { failureClass: 'D: request の親の項が not_observed（hierarchy 入力なし）', stage: 'hierarchy 入力の契約', records: extraction.failureDistribution.D_hierarchy.requestsParentItemNotObserved },
    { failureClass: 'C: name.status=unresolved / no_name_token', stage: 'FieldResolver（名称 token）', records: sumReason('no_name_token') },
    { failureClass: 'A: ページの rotate=90 による hard_failure（PDF 単位。record 数は測れない）', stage: 'PDF page extraction（SourceToken 前段）', records: null as number | null, pdfsAffected: failedPdfs },
  ].sort((a, b) => (b.records ?? -1) - (a.records ?? -1));

  const p1 = JSON.parse(fs.readFileSync(P1_RESULT, 'utf8')) as { items: { total: number; byClass: Record<string, number> }; requests: { total: number; byClass: Record<string, number>; conditionalExactRateGivenResolvedParent: number } };
  const out = {
    schema: 'budget-request-full-corpus-baseline-reconciliation/v0',
    scope: '現行 pipeline の無修正 baseline（82 PDF）の項・事項 × MOF V2 FY2024 一般会計 当初予算。P1 の deterministic exact 照合（金額・コード・fuzzy は不使用）',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, sha(p)])), mofJikouSha256: jikouSha, p1Matcher: { commit: '8691dc44560eed2d6bcde8d04853df061db14580', sha256: FROZEN[MATCHER] } },
    accountScope: { rule: 'manifest の accountType（既存 metadata）のみ。general → 比較対象、special → out_of_scope_mof_general_account、それ以外 → account_scope_unresolved', generalRecords: pop.filter(p => p.accountType === 'general').length, outOfScopeMofGeneralAccount: pop.filter(p => p.accountType === 'special').length, accountScopeUnresolved: unresolvedAccount.length },
    items: { extracted: pop.filter(p => p.recordKind === 'item').length, generalAccount: gItems.length, outOfScope: outOfScope(items.filter((_r, i) => inScopeOrSpecial.filter(p => p.recordKind === 'item')[i].accountType === 'special')), ...t(gItems), conditional: cond(gItems), diagnostics: diag(gItems) },
    requests: { extracted: reqAll.length, generalAccount: gReq.length, ...t(gReq), parentResolvedToMofSection: gReq.filter(reachedStage).length, conditional: cond(gReq), exactUniqueRateOverAllExtracted: reqAll.length === 0 ? 0 : gReq.filter(x => x.r.classification === 'exact_unique').length / reqAll.length, exactUniqueRateOverGeneral: gReq.length === 0 ? 0 : gReq.filter(x => x.r.classification === 'exact_unique').length / gReq.length, diagnostics: diag(gReq) },
    funnel,
    byMinistry: sortObj(byMinistry),
    failureDistribution: { extraction: { A: 'hard_failure（rotate=90）8 PDF', B: extraction.failureDistribution.B_recordDetection, C: C, D: extraction.failureDistribution.D_hierarchy }, reconciliation: { items: diag(gItems), requests: diag(gReq) } },
    comparisonWithP1: { note: 'P1 は評価用に選んだ 11 run の sample。代表性は仮定しない。率の違いだけで regression と断定しない', p1: { items: { total: p1.items.total, exactUnique: p1.items.byClass.exact_unique }, requests: { total: p1.requests.total, exactUnique: p1.requests.byClass.exact_unique, conditionalRateGivenResolvedParent: p1.requests.conditionalExactRateGivenResolvedParent } } },
    decision: { value: decision, rule: 'preregistration §8: 失敗 PDF が 25% 以上、または一般会計で比較可能な request が 30 件未満なら NEEDS_BASELINE_INFRASTRUCTURE。それ以外は GO_TO_FAILURE_PRIORITIZATION', failedPdfs, comparableRequests, reconciliationDecisionHelper: dec },
    nextCandidates: cand.slice(0, 3), allCandidatesRanked: cand,
    records: withScope.map(({ r, p }) => ({ localPath: p.localPath, segment: p.segment, mode: p.mode, sourceAuthority: p.sourceAuthority, accountType: p.accountType, page: p.page, logicalRowIndex: p.logicalRowIndex, recordKind: p.recordKind, classification: r.classification, reason: r.reason, matchedId: r.matchedId, candidates: r.candidateIds.length, diagnostic: r.diagnostic })),
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(OUT, text);
  console.log(JSON.stringify({ sha: crypto.createHash('sha256').update(text).digest('hex'), accountScope: out.accountScope, items: { ...out.items, diagnostics: out.items.diagnostics }, requests: out.requests, funnel, decision: out.decision, next: out.nextCandidates }, null, 1));
}

main();
