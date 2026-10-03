/**
 * H1 independent human validation — human-validation status と AI/human agreement の凍結評価 CLI。
 * 入力は凍結済み artifact のみ（PDF・resolver は使わない）。順序: (1) human GT のみで件数と status を確定 (2) その後に AI 側 65 unit を読み、agreement を算出。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-incomplete-name-guard-h1-human.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { agreement, countLabels, humanValidationStatus } from './lib/budget-request-incomplete-name-guard-h1-evaluator';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const OUT = path.join(DIR, 'h1-human-validation-evaluation.json');
const HASHES: Record<string, string> = {
  'h1-human-validation-visual-gt.json': '25ca613a3f8fdfd806a60d7c6033109561bbb627719a5324ee3c16746cb514a4',
  'h1-human-validation-reviewer-response-H01.json': '3fa66693676aff229d61e90eb6be52612058a2bd3f0078c5361c7920fa1a8427',
  'h1-human-validation-reviewer-metadata.json': '42c5741e4ea086e936bb3754a82591ab5a78a6a62032b47318c90648fab2a124',
  'h1-human-validation-worklist.json': '3546e523b8982c863dad51b889d0cb07dd978a529e20bcc70a12ef5eb8226c69',
  'h1-scope-completion-visual-gt.json': '3cb9eb9a5825ba3739a560e17940f224633c62890243a846d0cc89920a1318b9',
  'visual-gt.json': 'dcca2625403f93d641cf06d62afaf1172431086670b13a1c70bc4efe7bc9efe2',
};
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as T;
const stop = (m: string) => { console.error(`STOP: ${m}`); process.exitCode = 1; };

function main() {
  for (const [f, h] of Object.entries(HASHES)) if (sha256(path.join(DIR, f)) !== h) return stop(`hash 不一致: ${f}`);
  const meta = readJson<{ blindnessCase: string; blindnessEvidenceStatus: string; declarationTiming: string; reviewerAuthoredDeclaration: boolean; protocolDeviation: boolean }>('h1-human-validation-reviewer-metadata.json');

  // (1) human GT のみ
  const wl = readJson<{ units: { unitId: string }[] }>('h1-human-validation-worklist.json').units.map(u => u.unitId);
  const hgt = readJson<{ units: { unitId: string; label: string; reviewerType: string }[] }>('h1-human-validation-visual-gt.json').units;
  const hIds = hgt.map(u => u.unitId);
  if (hgt.length !== 65 || new Set(hIds).size !== 65 || wl.some(i => !hIds.includes(i)) || hgt.some(u => u.reviewerType !== 'human')) return stop('human GT の integrity 不成立');
  const hc = countLabels(hgt.map(u => u.label));
  if (hc.complete + hc.incomplete + hc.unclear !== 65) return stop('human 件数合計が 65 でない');
  const status = humanValidationStatus(hc);
  console.log(JSON.stringify({ human: { H_complete: hc.complete, H_incomplete: hc.incomplete, H_unclear: hc.unclear, H_decisive: hc.decisive }, status }));

  // (2) AI 側 65 unit（frozen artifact のみ）。L27 = P3 評価で guard が発火した labeled unit、U38 = H1 AI Visual GT
  const p3 = readJson<{ units: { unitId: string; guardFired: boolean }[] }>('p3-evaluation.json');
  const l27 = p3.units.filter(u => u.guardFired).map(u => u.unitId);
  const gt367 = new Map(readJson<{ units: { unitId: string; visualLabel: string }[] }>('visual-gt.json').units.map(u => [u.unitId, u.visualLabel]));
  const u38 = readJson<{ units: { unitId: string; label: string }[] }>('h1-scope-completion-visual-gt.json').units;
  const ai = new Map<string, string>();
  for (const id of l27) { const l = gt367.get(id); if (l === undefined) return stop(`L27 の既存 Visual GT を unitId で引けない: ${id}`); ai.set(id, l); }
  const overlap = u38.filter(u => ai.has(u.unitId));
  for (const u of u38) ai.set(u.unitId, u.label);
  if (l27.length !== 27 || u38.length !== 38 || overlap.length || ai.size !== 65) return stop(`AI 65 unit の再構成が不成立（L27=${l27.length}, U38=${u38.length}, overlap=${overlap.length}, size=${ai.size}）`);
  const result = agreement(new Map(hgt.map(u => [u.unitId, u.label])), ai);

  const out = {
    schema: 'budget-request-incomplete-name-guard-h1-human-validation-evaluation/v0',
    evaluationType: 'frozen human GT (reviewer H01) status + AI/human agreement',
    frozenInputs: Object.fromEntries(Object.entries(HASHES).map(([f, h]) => [f, { path: path.join(DIR, f), sha256: h }])),
    blindness: { case: meta.blindnessCase, blindnessEvidenceStatus: meta.blindnessEvidenceStatus, declarationTiming: meta.declarationTiming, reviewerAuthoredDeclaration: meta.reviewerAuthoredDeclaration, protocolDeviation: meta.protocolDeviation },
    humanCounts: { population: 65, H_complete: hc.complete, H_incomplete: hc.incomplete, H_unclear: hc.unclear, H_decisive: hc.decisive },
    humanValidationStatus: { status, rule: 'VALIDATED: H_complete==0 && H_unclear==0 / CONTRADICTED: H_complete>=1 / INCONCLUSIVE: H_complete==0 && H_unclear>=1', note: 'status は事前登録規則の機械適用。blindness procedure compliance（Case B・protocolDeviation）とは別' },
    aiPopulation: { size: 65, L27: 27, U38: 38, aiLabelCounts: countLabels([...ai.values()]) },
    agreement: result,
  };
  nodeBudgetRequestFs.writeAtomic(OUT, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  console.log(JSON.stringify({ agreement: { exact: result.exactAgreementCount, rate: result.exactAgreementRate, confusion: result.confusion, disagreementCount: result.disagreementCount, disagreementUnitIds: result.disagreementUnitIds } }, null, 1));
  console.log(`wrote ${OUT} sha256=${sha256(OUT)}`);
}

main();
