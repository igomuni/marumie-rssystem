/**
 * measurement correction の訂正版（correction of the correction）。`parentExactUnique`（親の項が exact_unique。request 名の有無を問わない）と
 * `comparableRequests`（親が exact_unique かつ request 名があり、request 自身を照合できた件数）を別の指標として記録する。
 * - P1: preregistration §7 の条件付き exact rate は exact ÷ parentExactUnique（68）。comparable 内の exact rate（56/59）は別の指標。
 * - full-corpus: preregistration に「親が exact の条件付き rate」の定義はない。funnel / gate の「比較可能な request」は 101 のまま。exact ÷ parentExactUnique は参考値のみ。
 * 前版 `p1-measurement-correction.json`（commit 0b4fd07）は書き換えず、本 artifact で一部の記述を撤回する。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-p1-measurement-correction-v2.ts
 * 出力: tests/fixtures/budget-request-mof-reconciliation/2024/p1-measurement-correction-v2.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { decide, type MatchClass, type MatchResult } from './lib/budget-request-mof-reconciliation';
import { measureComparable, parentAnchor, type RequestMeasureRow } from './lib/budget-request-mof-reconciliation-measurement';

const P1_DIR = path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024');
const FC_DIR = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const OUT = path.join(P1_DIR, 'p1-measurement-correction-v2.json');
const PREV = path.join(P1_DIR, 'p1-measurement-correction.json');
const FROZEN: Record<string, string> = {
  [path.join(P1_DIR, 'p1-pdf-population.json')]: 'f726c81b203eb22398cb7fd4c051bd059f40fea6e018a2a78a9e4babdfbd94b6',
  [path.join(P1_DIR, 'p1-reconciliation-result.json')]: '66e8ba1d4cf16c298a7c7db083f482c6187b0a8c91ba4c4dc09fe6c607d42697',
  [path.join(FC_DIR, 'extraction-population.json')]: '3ec53c133117033ea0c8a8f23a3196f5b28ff18120957c7531c48c6df15fdbf8',
  [path.join(FC_DIR, 'reconciliation-result.json')]: '2f14d15c2a78d41f0b9669642b150637eeae6489ed8b7ac8a9d3a84e3e912904',
  [PREV]: '67dc1eea0ce727b23a4367a8238b7827b7ceed1ddae6f6e662a501d4055e9fbf',
};
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
type Row = { runId: string; page: number; logicalRowIndex: number; recordKind: 'item' | 'request'; parentRef: string | null; classification: MatchClass };

function measure(rows: Row[]) {
  const itemClass = new Map<string, MatchClass>();
  for (const r of rows) if (r.recordKind === 'item') itemClass.set(`${r.runId}#${r.page}:${r.logicalRowIndex}`, r.classification);
  return measureComparable(rows.filter(r => r.recordKind === 'request').map((r): RequestMeasureRow => ({ ownClass: r.classification, parentItemClass: itemClass.get(parentAnchor(r.runId, r.parentRef) ?? '') ?? null })));
}

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (sha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);

  type P1Pop = { runId: string; accountType: string; name: unknown; recordKind: 'item' | 'request'; page: number; logicalRowIndex: number; parentItem: { ref: string | null } | null };
  const p1Pop = readJson<{ records: P1Pop[] }>(path.join(P1_DIR, 'p1-pdf-population.json')).records;
  const p1Res = readJson<{ requests: { parentExactUnique: number; conditionalExactRateGivenResolvedParent: number }; records: MatchResult[]; decision: string }>(path.join(P1_DIR, 'p1-reconciliation-result.json'));
  const p1 = measure(p1Pop.map((p, i) => ({ runId: p.runId, page: p.page, logicalRowIndex: p.logicalRowIndex, recordKind: p.recordKind, parentRef: p.parentItem?.ref ?? null, classification: p1Res.records[i].classification })));
  const p1Decision = decide(p1Res.records, p1Pop.filter(p => p.accountType === 'general' && p.name !== null).length).decision;

  type FcPop = { localPath: string; segment: [number, number]; accountType: string; recordKind: 'item' | 'request'; page: number; logicalRowIndex: number; parentItem: { ref: string | null } | null };
  const fcPop = readJson<{ population: FcPop[] }>(path.join(FC_DIR, 'extraction-population.json')).population;
  const fcRes = readJson<{ requests: { conditional: { comparable: number; exactUnique: number; rate: number } }; funnel: { pdfs: number; requestsGeneralParentMatchedExactUnique: number }; decision: { value: string; failedPdfs: number; comparableRequests: number }; records: { localPath: string; segment: [number, number]; page: number; logicalRowIndex: number; recordKind: string; classification: MatchClass }[] }>(path.join(FC_DIR, 'reconciliation-result.json'));
  const keyOf = (r: { localPath: string; segment: [number, number]; page: number; logicalRowIndex: number; recordKind: string }) => `${r.localPath}@${r.segment[0]}-${r.segment[1]}#${r.page}:${r.logicalRowIndex}:${r.recordKind}`;
  const resByKey = new Map(fcRes.records.map(r => [keyOf(r), r.classification]));
  const fc = measure(fcPop.filter(p => p.accountType === 'general').map(p => {
    const c = resByKey.get(keyOf(p));
    if (!c) throw new Error(`full-corpus result に record が無い（STOP）: ${keyOf(p)}`);
    return { runId: `${p.localPath}@${p.segment[0]}-${p.segment[1]}`, page: p.page, logicalRowIndex: p.logicalRowIndex, recordKind: p.recordKind, parentRef: p.parentItem?.ref ?? null, classification: c };
  }));
  const threshold = 30;
  const fcGate = fcRes.decision.failedPdfs >= Math.ceil(0.25 * fcRes.funnel.pdfs) || fc.comparableRequests < threshold ? 'NEEDS_BASELINE_INFRASTRUCTURE' : 'GO_TO_FAILURE_PRIORITIZATION';

  const out = {
    schema: 'budget-request-p1-measurement-correction-v2/v0',
    supersedes: { artifact: PREV, sha256: FROZEN[PREV], commit: '0b4fd07', retractedClaims: ['full-corpus に P1 と同じ measurement bug があった', 'full-corpus 97.0% → 85.2% が補正', 'full-corpus gate の入力を 101 → 115 に補正'] },
    note: 'parentExactUnique と comparableRequests は別の指標。前者は request 名の有無を問わず親の項が exact_unique、後者は親が exact_unique かつ request 名があり request 自身を照合できた件数',
    frozenInputs: Object.fromEntries(Object.entries(FROZEN).map(([p, h]) => [p, h])),
    p1: {
      parentExactUnique: p1.parentExactUnique, comparableRequests: p1.comparableRequests, requestExactUnique: p1.requestExactUnique,
      exactRateWithinComparable: { value: p1.exactRateWithinComparable, note: 'original の 56/59 = 94.9%。この指標としては正しい（original は「親が exact_unique の条件付き rate」とラベルしていた）' },
      preregisteredConditionalExactRate: { value: p1.parentExactConditionalRate, definition: 'P1 preregistration §7: 親が exact_unique の request のうち exact_unique の割合（56/68）' },
      original: { parentExactUnique: p1Res.requests.parentExactUnique, conditionalExactRateGivenResolvedParent: p1Res.requests.conditionalExactRateGivenResolvedParent },
      decision: { original: p1Res.decision, recomputed: p1Decision, unchanged: p1Res.decision === p1Decision },
    },
    fullCorpus: {
      scope: 'accountType = general の request',
      parentExactUnique: fc.parentExactUnique, comparableRequests: fc.comparableRequests, requestExactUnique: fc.requestExactUnique,
      exactRateWithinComparable: { value: fc.exactRateWithinComparable, note: '98/101 = 97.0%。funnel 最終段の率として正しい（original の値のまま）' },
      preregisteredConditionalExactRate: null,
      referenceOnly: { parentExactConditionalRate: fc.parentExactConditionalRate, note: 'exact ÷ parentExactUnique。full-corpus の preregistration が定義した評価指標ではない（参考値）' },
      original: { comparable: fcRes.requests.conditional.comparable, exactUnique: fcRes.requests.conditional.exactUnique, rate: fcRes.requests.conditional.rate, measurementBug: false },
      originalMatchesRecomputed: fcRes.requests.conditional.comparable === fc.comparableRequests && fcRes.funnel.requestsGeneralParentMatchedExactUnique === fc.comparableRequests,
      decision: { original: fcRes.decision.value, gateInput: 'comparableRequests（preregistration §7 の funnel と §8 gate の「比較可能な request」）', gateComparableRequests: fc.comparableRequests, threshold, recomputed: fcGate, unchanged: fcGate === fcRes.decision.value },
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ p1: out.p1, fullCorpus: out.fullCorpus }, null, 1));
  console.log(`wrote ${OUT} sha256=${sha(OUT)}`);
}

main();
