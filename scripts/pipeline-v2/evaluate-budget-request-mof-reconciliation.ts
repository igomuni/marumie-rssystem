/**
 * 概算要求PDF × MOF V2 事項 照合 P1 — frozen evaluation。preregistration（commit 7f527af）の規則を機械的に適用する。
 * 入力: frozen PDF population（SHA-256 を確認）と #371 の budget-jikou.jsonl（SHA-256 を integration evaluation の記録と照合）。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-mof-reconciliation.ts
 * 出力: tests/fixtures/budget-request-mof-reconciliation/2024/p1-reconciliation-result.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl } from './lib/jsonl';
import { decide, reconcile, tally, type MatchResult, type MofJikou, type MofSection, type PdfPopulationRecord } from './lib/budget-request-mof-reconciliation';
import type { MofBudgetJikouRecord } from './types';

const DIR = path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024');
const POPULATION = path.join(DIR, 'p1-pdf-population.json');
const POPULATION_SHA = 'f726c81b203eb22398cb7fd4c051bd059f40fea6e018a2a78a9e4babdfbd94b6';
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const JIKOU_EVAL = path.join('tests', 'fixtures', 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json');
const OUT = path.join(DIR, 'p1-reconciliation-result.json');
const PREREGISTRATION_COMMIT = '7f527af7c4757229b99b08f634dd039e8ae15591';
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function main() {
  if (sha(POPULATION) !== POPULATION_SHA) throw new Error('PDF population の hash が frozen 値と一致しない（INCONCLUSIVE）');
  const jikouSha = sha(JIKOU);
  const expectedJikouSha = (JSON.parse(fs.readFileSync(JIKOU_EVAL, 'utf8')) as { output: { sha256: string } }).output.sha256;
  if (jikouSha !== expectedJikouSha) throw new Error('budget-jikou.jsonl が #371 の integration evaluation の記録と一致しない（INCONCLUSIVE）');

  const population = (JSON.parse(fs.readFileSync(POPULATION, 'utf8')) as { records: PdfPopulationRecord[] }).records;
  const jikouRows = readJsonl<MofBudgetJikouRecord>(JIKOU);
  const sectionMap = new Map<string, MofSection>();
  for (const j of jikouRows) if (!sectionMap.has(j.parentSectionId)) sectionMap.set(j.parentSectionId, { id: j.parentSectionId, organization: j.organization, sectionName: j.sectionName });
  const sections = [...sectionMap.values()];
  const jikou: MofJikou[] = jikouRows.map(j => ({ parentSectionId: j.parentSectionId, jikouName: j.jikouName, recordId: j.recordId }));

  const results = reconcile(population, sections, jikou);
  const items = results.filter(r => r.recordKind === 'item');
  const requests = results.filter(r => r.recordKind === 'request');
  const parentExact = (rs: MatchResult[]) => rs.filter(r => r.classification !== 'parent_unresolved' && r.classification !== 'name_unavailable' && r.classification !== 'out_of_scope');
  const requestTally = tally(requests);
  const resolvedParent = parentExact(requests);
  const conditional = resolvedParent.length === 0 ? 0 : resolvedParent.filter(r => r.classification === 'exact_unique').length / resolvedParent.length;
  const count = (rows: MatchResult[], f: (r: MatchResult) => string) => { const m = new Map<string, number>(); rows.forEach(r => m.set(f(r), (m.get(f(r)) ?? 0) + 1)); return Object.fromEntries([...m.entries()].sort(([a], [b]) => cmp(a, b))); };
  const comparable = population.filter(p => p.accountType === 'general' && p.name !== null).length;
  const dec = decide(results, comparable);

  const out = {
    schema: 'budget-request-mof-reconciliation-p1-result/v0',
    scope: '既存の PDF 抽出 population（item 44 / request 123）× MOF V2 FY2024 一般会計 当初予算の section / jikou。deterministic exact 照合のみ（金額・コード・fuzzy は不使用）',
    preregistration: { document: 'docs/tasks/20261005_0608_Budget_Request_MOF_Reconciliation_P1_Preregistration.md', commit: PREREGISTRATION_COMMIT },
    frozenInputs: { pdfPopulation: { path: POPULATION, sha256: POPULATION_SHA }, mofJikou: { path: JIKOU, sha256: jikouSha, records: jikouRows.length, sections: sections.length } },
    items: { ...tally(items), byDiagnostic: count(items.filter(r => r.classification !== 'exact_unique'), r => r.diagnostic ?? 'unknown') },
    requests: {
      ...requestTally,
      parentExactUnique: items.length === 0 ? 0 : requests.filter(r => r.classification === 'exact_unique' || r.classification === 'exact_ambiguous' || r.classification === 'no_exact_match').length,
      conditionalExactRateGivenResolvedParent: conditional,
      parentUnresolvedByReason: count(requests.filter(r => r.classification === 'parent_unresolved'), r => r.reason ?? 'none'),
      byDiagnostic: count(requests.filter(r => r.classification !== 'exact_unique'), r => r.diagnostic ?? 'unknown'),
    },
    bySource: Object.fromEntries([...new Set(results.map(r => r.sourceAuthority))].sort(cmp).map(s => [s, { items: tally(items.filter(r => r.sourceAuthority === s)), requests: tally(requests.filter(r => r.sourceAuthority === s)) }])),
    byRun: Object.fromEntries([...new Set(results.map(r => r.runId))].sort(cmp).map(s => [s, { items: tally(items.filter(r => r.runId === s)).byClass, requests: tally(requests.filter(r => r.runId === s)).byClass }])),
    failureIsolation: { overall: count(results.filter(r => r.classification !== 'exact_unique'), r => r.diagnostic ?? 'unknown'), ...dec },
    decision: dec.decision,
    rule: 'preregistration §9',
    records: results.map((r, i) => ({ ...r, name: population[i].name?.raw ?? null, parentItemName: population[i].parentItem?.name?.raw ?? null, parentOrganizationName: population[i].parentOrganization.name?.raw ?? null })),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ decision: dec, items: out.items, requests: out.requests, bySource: Object.fromEntries(Object.entries(out.bySource).map(([k, v]) => [k, { i: (v as any).items.byClass, r: (v as any).requests.byClass }])), failureIsolation: out.failureIsolation.overall }, null, 1));
  console.log(`wrote ${OUT} sha256=${sha(OUT)}`);
}

main();
