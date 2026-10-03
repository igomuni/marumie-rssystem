/**
 * H1 scope-completion audit — P4 凍結評価 CLI（frozen AI Visual GT に基づく H1 evaluation）。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-incomplete-name-guard-h1.ts
 * 入力はすべて凍結済み artifact。PDF・resolver は使わない。出力は決定的（時刻・絶対パスなし）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { verifyFreeze } from './lib/budget-request-field-resolver-freeze';
import { countLabels, decideH1 } from './lib/budget-request-incomplete-name-guard-h1-evaluator';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const OUT = path.join(DIR, 'h1-scope-completion-p4-evaluation.json');
const WORKLIST_SHA = 'fa9a3abebad3452d0a4bfd761044f83b88427ba1eef2bc7069179155ce57028c';
const GT_SHA = '3cb9eb9a5825ba3739a560e17940f224633c62890243a846d0cc89920a1318b9';
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const stop = (m: string) => { console.error(`STOP: ${m}`); process.exitCode = 1; };

function main() {
  const wlPath = path.join(DIR, 'h1-scope-completion-worklist.json'), gtPath = path.join(DIR, 'h1-scope-completion-visual-gt.json'), p3Path = path.join(DIR, 'p3-evaluation.json');
  if (sha256(wlPath) !== WORKLIST_SHA) return stop('worklist hash 不一致');
  if (sha256(gtPath) !== GT_SHA) return stop('H1 Visual GT hash 不一致');
  const fv = verifyFreeze('3d00e16c9da64b79ddf6a4f0304972f1cde6a358', [wlPath, gtPath, 'docs/tasks/20261003_2001_FieldResolver_v0_H1_Scope_Completion_Audit_Preregistration.md', 'docs/tasks/20261003_2007_FieldResolver_v0_H1_Scope_Completion_Audit_Preregistration_Supplement.md']);
  if (!fv.allMatch) return stop('凍結成果物が 3d00e16 と一致しない');

  const wl = readJson<{ units: { unitId: string }[] }>(wlPath).units.map(u => u.unitId);
  const gt = readJson<{ units: { unitId: string; label: string }[] }>(gtPath).units;
  const gtIds = gt.map(u => u.unitId);
  const dup = (a: string[]) => a.length - new Set(a).size;
  const missing = wl.filter(i => !gtIds.includes(i)), extra = gtIds.filter(i => !wl.includes(i));
  if (wl.length !== 38 || gt.length !== 38 || dup(wl) || dup(gtIds) || missing.length || extra.length) return stop('38 件の unit 集合が一致しない');
  const primary = countLabels(gt.map(u => u.label));
  if (primary.complete + primary.incomplete + primary.unclear !== 38) return stop('件数合計が 38 でない');
  const decision = decideH1(primary);

  // secondary: 既存 27（P3 評価で guard が発火した labeled unit）を unitId の完全一致で結合
  const p3 = readJson<{ units: { unitId: string; visualGt: string; guardFired: boolean }[]; differential: { fired: number } }>(p3Path);
  const existing = p3.units.filter(u => u.guardFired);
  let secondary: Record<string, unknown>;
  const overlap = existing.filter(u => wl.includes(u.unitId));
  if (existing.length !== 27 || overlap.length || dup(existing.map(u => u.unitId)) || p3.differential.fired !== 65) {
    secondary = { status: 'not-computed', reason: `identity join 不一致（existing=${existing.length}, overlap=${overlap.length}, fired=${p3.differential.fired}）` };
  } else {
    const sec = countLabels([...existing.map(u => u.visualGt), ...gt.map(u => u.label)]);
    if (sec.complete + sec.incomplete + sec.unclear !== 65) return stop('secondary の件数合計が 65 でない');
    secondary = { status: 'computed', frozenGuardFirePopulationSize: 65, existingLabeledFiredUnits: 27, complete_total: sec.complete, incomplete_total: sec.incomplete, unclear_total: sec.unclear, descriptiveOnly: true, scope: 'observed classification within the frozen P3 guard-fire population（未知 population の precision 推定ではない）' };
  }

  const out = {
    schema: 'budget-request-incomplete-name-guard-h1-p4-evaluation/v0',
    researchPurpose: '#367 scope-completion audit',
    evaluationType: 'frozen AI Visual GT based H1 evaluation',
    frozenInputs: {
      worklist: { path: wlPath, sha256: WORKLIST_SHA, freezeCommit: 'caefc6206f85bf9217b307797ea7ae01b7c83bd3' },
      visualGt: { path: gtPath, sha256: GT_SHA, freezeCommit: '3d00e16c9da64b79ddf6a4f0304972f1cde6a358' },
      preregistrationCommit: '4ad66c4bbb915d5d8385d02a61702d5ad0b812df', supplementCommit: '2e7656e0e822b14083c3ac8165d151b8e6de8fcc',
      p3Evaluation: { path: p3Path, sha256: sha256(p3Path) },
    },
    integrity: { worklistCount: wl.length, gtCount: gt.length, duplicates: 0, missing: 0, extra: 0, labelsAllowed: true, freezeVerification: fv },
    primary: { populationSize: 38, N_complete: primary.complete, N_incomplete: primary.incomplete, N_unclear: primary.unclear, N_decisive: primary.decisive, rule: 'GO: N_complete==0 && N_unclear==0 / STOP: N_complete>=1 / INCONCLUSIVE: N_complete==0 && N_unclear>=1', decision },
    secondary,
    humanReview: { status: 'pending' },
  };
  nodeBudgetRequestFs.writeAtomic(OUT, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  console.log(JSON.stringify({ primary: out.primary, secondary }, null, 1));
  console.log(`wrote ${OUT} sha256=${sha256(OUT)}`);
}

main();
