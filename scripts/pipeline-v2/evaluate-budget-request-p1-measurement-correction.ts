/**
 * P1 reconciliation の条件付き exact rate の measurement correction。frozen な population と result（上書きしない）から、
 * preregistration §7 の定義（親の項が exact_unique の request のうち exact_unique の割合）を parentItem.ref → item の照合結果で再計算する。
 * matcher・分類・frozen artifact は変更しない。full-corpus baseline の同じ指標も確認する。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-p1-measurement-correction.ts
 * 出力: tests/fixtures/budget-request-mof-reconciliation/2024/p1-measurement-correction.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { decide, type MatchClass, type MatchResult } from './lib/budget-request-mof-reconciliation';
import { measureParentExact, parentAnchor, type RequestMeasureRow } from './lib/budget-request-mof-reconciliation-measurement';

const P1_DIR = path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024');
const FC_DIR = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const OUT = path.join(P1_DIR, 'p1-measurement-correction.json');
const FROZEN: Record<string, string> = {
  [path.join(P1_DIR, 'p1-pdf-population.json')]: 'f726c81b203eb22398cb7fd4c051bd059f40fea6e018a2a78a9e4babdfbd94b6',
  [path.join(P1_DIR, 'p1-reconciliation-result.json')]: '66e8ba1d4cf16c298a7c7db083f482c6187b0a8c91ba4c4dc09fe6c607d42697',
  [path.join(FC_DIR, 'extraction-population.json')]: '3ec53c133117033ea0c8a8f23a3196f5b28ff18120957c7531c48c6df15fdbf8',
  [path.join(FC_DIR, 'reconciliation-result.json')]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
};
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
interface ParentRef { ref: string | null }
interface Rec { recordKind: 'item' | 'request'; page: number; logicalRowIndex: number; parentItem: ParentRef | null }

/** key = 同一 record を引くための anchor 用 runId と result の classification */
function measure(rows: { runId: string; page: number; logicalRowIndex: number; recordKind: 'item' | 'request'; parentRef: string | null; classification: MatchClass }[]) {
  const itemClass = new Map<string, MatchClass>();
  for (const r of rows) if (r.recordKind === 'item') itemClass.set(`${r.runId}#${r.page}:${r.logicalRowIndex}`, r.classification);
  const reqRows: RequestMeasureRow[] = rows.filter(r => r.recordKind === 'request').map(r => ({ ownClass: r.classification, parentItemClass: itemClass.get(parentAnchor(r.runId, r.parentRef) ?? '') ?? null }));
  return measureParentExact(reqRows);
}

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (sha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);

  // ---- P1 ----
  type P1Pop = Rec & { runId: string; accountType: string; name: unknown };
  const p1Pop = readJson<{ records: P1Pop[] }>(path.join(P1_DIR, 'p1-pdf-population.json')).records;
  const p1Res = readJson<{ requests: { parentExactUnique: number; conditionalExactRateGivenResolvedParent: number; byClass: Record<string, number> }; records: (MatchResult & { name: string | null })[]; decision: string; failureIsolation: { decision: string } }>(path.join(P1_DIR, 'p1-reconciliation-result.json'));
  if (p1Res.records.length !== p1Pop.length) throw new Error('P1 population と result の件数が違う（STOP）');
  const p1Rows = p1Pop.map((p, i) => ({ runId: p.runId, page: p.page, logicalRowIndex: p.logicalRowIndex, recordKind: p.recordKind, parentRef: p.parentItem?.ref ?? null, classification: p1Res.records[i].classification }));
  p1Pop.forEach((p, i) => { const r = p1Res.records[i]; if (r.runId !== p.runId || r.page !== p.page || r.logicalRowIndex !== p.logicalRowIndex || r.recordKind !== p.recordKind) throw new Error('P1 population と result の対応が崩れている（STOP）'); });
  const p1 = measure(p1Rows);
  const p1Decision = decide(p1Res.records, p1Pop.filter(p => p.accountType === 'general' && p.name !== null).length).decision;

  // ---- full-corpus ----
  type FcPop = Rec & { localPath: string; segment: [number, number]; accountType: string };
  const fcPop = readJson<{ population: FcPop[] }>(path.join(FC_DIR, 'extraction-population.json')).population;
  const fcRes = readJson<{ requests: { conditional: { comparable: number; exactUnique: number; rate: number } }; funnel: { pdfs: number; requestsGeneralParentMatchedExactUnique: number }; decision: { value: string; failedPdfs: number; comparableRequests: number }; records: { localPath: string; segment: [number, number]; page: number; logicalRowIndex: number; recordKind: 'item' | 'request'; classification: MatchClass }[] }>(path.join(FC_DIR, 'reconciliation-result.json'));
  const keyOf = (r: { localPath: string; segment: [number, number]; page: number; logicalRowIndex: number; recordKind: string }) => `${r.localPath}@${r.segment[0]}-${r.segment[1]}#${r.page}:${r.logicalRowIndex}:${r.recordKind}`;
  const resByKey = new Map(fcRes.records.map(r => [keyOf(r), r.classification]));
  if (resByKey.size !== fcRes.records.length) throw new Error('full-corpus result の key が重複（STOP）');
  const fcGeneral = fcPop.filter(p => p.accountType === 'general');
  const fcRows = fcGeneral.map(p => {
    const c = resByKey.get(keyOf(p));
    if (!c) throw new Error(`full-corpus result に record が無い（STOP）: ${keyOf(p)}`);
    return { runId: `${p.localPath}@${p.segment[0]}-${p.segment[1]}`, page: p.page, logicalRowIndex: p.logicalRowIndex, recordKind: p.recordKind, parentRef: p.parentItem?.ref ?? null, classification: c };
  });
  const fc = measure(fcRows);
  const fcThreshold = 30;
  const fcDecisionCorrected = fcRes.decision.failedPdfs >= Math.ceil(0.25 * fcRes.funnel.pdfs) || fc.parentExactUnique < fcThreshold ? 'NEEDS_BASELINE_INFRASTRUCTURE' : 'GO_TO_FAILURE_PRIORITIZATION';

  const out = {
    schema: 'budget-request-p1-measurement-correction/v0',
    scope: 'measurement / reporting correction のみ。matcher の規則・分類・frozen artifact は変更していない。原 artifact は上書きしない',
    definition: { document: 'docs/tasks/20261005_0608_Budget_Request_MOF_Reconciliation_P1_Preregistration.md', section: '§7', text: '条件付き exact rate = 親が exact_unique の request のうち exact_unique の割合。親は parentItem.ref → item の照合結果で判定（request 自身の classification から逆算しない）' },
    frozenInputs: Object.fromEntries(Object.entries(FROZEN).map(([p, h]) => [p, h])),
    rootCause: 'original の evaluator は request 自身の classification が parent_unresolved / name_unavailable / out_of_scope でない集合を「親が解決した request」の proxy とした。matcher の判定順は out_of_scope → name_unavailable → parent_unresolved → candidate のため、request が name_unavailable だが親の項が exact_unique の record が denominator から落ちる',
    p1: {
      original: { parentExactUnique: p1Res.requests.parentExactUnique, conditionalExactRateGivenResolvedParent: p1Res.requests.conditionalExactRateGivenResolvedParent, numerator: p1Res.requests.byClass.exact_unique },
      corrected: p1,
      decision: { original: p1Res.decision, recomputedFromFrozenRecords: p1Decision, unchanged: p1Res.decision === p1Decision, note: 'gate は classified share と top diagnostic category share（preregistration §9）。conditional rate は gate ではない' },
    },
    fullCorpus: {
      scope: 'accountType = general の request（full-corpus reconciliation の gReq と同じ集合）',
      original: { comparable: fcRes.requests.conditional.comparable, exactUnique: fcRes.requests.conditional.exactUnique, rate: fcRes.requests.conditional.rate },
      corrected: fc,
      correctionRequired: fcRes.requests.conditional.comparable !== fc.parentExactUnique,
      decision: {
        original: fcRes.decision.value,
        rule: 'failedPdfs が 25% 以上、または一般会計で比較可能な request が 30 件未満なら NEEDS_BASELINE_INFRASTRUCTURE（conditional rate は gate ではない）',
        originalComparableRequests: fcRes.decision.comparableRequests, correctedParentExactUnique: fc.parentExactUnique, threshold: fcThreshold,
        recomputed: fcDecisionCorrected, unchanged: fcDecisionCorrected === fcRes.decision.value,
        note: 'gate 入力の「比較可能な request」も同じ proxy で数えられていたが、corrected 値の方が大きく（≥ 30）、decision は変わらない',
      },
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ p1: out.p1, fullCorpus: out.fullCorpus }, null, 1));
  console.log(`wrote ${OUT} sha256=${sha(OUT)}`);
}

main();
