/**
 * H1 independent human validation — reviewer 返却物（raw response）→ human GT の純粋な deterministic projection。
 * 構造検証（unit 集合・許可ラベル・reviewerType）のみを行い、ラベル件数の集計・AI GT の読み込み・比較は行わない。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-h1-human-validation-gt.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { H1_LABELS } from './lib/budget-request-incomplete-name-guard-h1-evaluator';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const RAW = path.join(DIR, 'h1-human-validation-reviewer-response-H01.json');
const WORKLIST = path.join(DIR, 'h1-human-validation-worklist.json');
const OUT = path.join(DIR, 'h1-human-validation-visual-gt.json');
export const HUMAN_GT_SCHEMA = 'budget-request-incomplete-name-guard-h1-human-validation-visual-gt/v0';
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stop = (m: string) => { console.error(`STOP: ${m}`); process.exitCode = 1; };

export interface RawResponse { reviewerId: string; units: { unitId: string; label: string; reviewerType: string }[] }

/** raw response の各 unit を unitId / label / reviewerType のまま、元の順序で転記する（変更・補正をしない） */
export function projectHumanGt(raw: RawResponse) {
  return raw.units.map(u => ({ unitId: u.unitId, label: u.label, reviewerType: u.reviewerType }));
}

/** 構造検証。問題の説明を返す（空なら pass）。ラベル件数は扱わない */
export function validateRaw(raw: RawResponse, worklistIds: string[]): string[] {
  const errs: string[] = [];
  if (raw.reviewerId !== 'H01') errs.push('reviewerId != H01');
  if (!Array.isArray(raw.units) || raw.units.length !== 65) return [...errs, 'units != 65'];
  const ids = raw.units.map(u => u.unitId);
  if (ids.length - new Set(ids).size) errs.push('duplicate unitId');
  if (worklistIds.some(i => !ids.includes(i))) errs.push('missing unitId');
  if (ids.some(i => !worklistIds.includes(i))) errs.push('extra unitId');
  for (const u of raw.units) {
    if (typeof u.unitId !== 'string' || typeof u.label !== 'string' || typeof u.reviewerType !== 'string') errs.push(`field 欠落: ${String(u.unitId)}`);
    else {
      if (!(H1_LABELS as readonly string[]).includes(u.label)) errs.push(`unknown label: ${u.unitId}`);
      if (u.reviewerType !== 'human') errs.push(`reviewerType != human: ${u.unitId}`);
    }
  }
  return errs;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8')) as RawResponse;
  const wl = (JSON.parse(fs.readFileSync(WORKLIST, 'utf8')) as { units: { unitId: string }[] }).units.map(u => u.unitId);
  const errs = validateRaw(raw, wl);
  if (errs.length) return stop(errs.join('; '));
  const out = {
    schema: HUMAN_GT_SCHEMA,
    reviewerId: raw.reviewerId,
    rawResponse: { path: RAW, sha256: sha256(RAW) },
    worklist: { path: WORKLIST, sha256: sha256(WORKLIST) },
    units: projectHumanGt(raw),
  };
  nodeBudgetRequestFs.writeAtomic(OUT, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  console.log(`structural validation: pass (65 units)\nhuman GT sha256=${sha256(OUT)}`);
}

if (require.main === module) main();
