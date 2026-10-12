/**
 * H1 GT freeze: validate the final human review and write the frozen GT fixtures (no resolver, no re-adjudication).
 *
 *   npx tsx scripts/pipeline-v2/freeze-budget-request-total-table-h1-gt.ts <submission1.csv,submission2.csv,...> [workDir] [fixtureDir]
 *
 * The LAST submission is the final human review; earlier ones are preserved byte-identically as history. Submissions are
 * file names under <workDir>/review/. GT = human decision for every unit with a review reason (disagreement, audit,
 * context audit, escalation); the remaining units (both annotators agreed, not audited) keep the consensus candidate.
 * The script throws instead of repairing: nothing is corrected, completed or normalized beyond reading the pasted row
 * number out of a free-text parent cell (only when the final cell is not already in row:N / N;N form, which it must be).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCsv, sha256 } from './lib/budget-request-total-table-h1-gt-sampling';

const [submissionArg, workDirArg, fixtureDirArg] = process.argv.slice(2);
if (!submissionArg) throw new Error('usage: <submission1.csv,...,final.csv> [workDir] [fixtureDir]');
const workDir = workDirArg ?? 'data/work/budget-request-total-table-h1-gt/2024';
const fixtureDir = fixtureDirArg ?? 'tests/fixtures/budget-request-total-table-h1-gt/2024';
const submissions = submissionArg.split(',');
const AMOUNTS = ['previous_general', 'previous_other', 'previous_total', 'request_general', 'request_other', 'request_total', 'difference'];
const HUMAN = ['human_decision', 'human_parent_or_scope', 'human_notes', 'human_review_status'];
const REL_DECISIONS = new Set(['RESOLVED', 'AMBIGUOUS', 'NO_PARENT', 'NOT_APPLICABLE']);
const TOTAL_DECISIONS = new Set(['RESOLVED', 'AMBIGUOUS']);

const readWork = (rel: string) => fs.readFileSync(path.join(workDir, rel), 'utf8');
const original = parseCsv(readWork('review/human-review.csv'));
const units = new Map(parseCsv(readWork('annotation-input/units.csv')).map(u => [u.sample_id, u]));
const submitted = submissions.map(name => ({ name, text: readWork(`review/${name}`), rows: parseCsv(readWork(`review/${name}`)) }));
const final = submitted[submitted.length - 1];
const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

// 1. shape: same units, same order, non-human columns untouched except the escalation reason added by the review aid
if (final.rows.length !== original.length || final.rows.some((r, i) => r.sample_id !== original[i].sample_id)) fail('unit ids/order differ from review/human-review.csv');
const escalationAdded = new Set<string>();
for (const [i, r] of final.rows.entries()) {
  for (const c of Object.keys(original[i])) {
    if (HUMAN.includes(c)) continue;
    if (r[c] === original[i][c]) continue;
    if (c === 'review_required_reason' && original[i][c] === '' && r[c] === 'ESCALATION') { escalationAdded.add(r.sample_id); continue; }
    fail(`${r.sample_id}: non-human column ${c} was changed`);
  }
}

// 2. every unit that needs review has a valid, complete human decision; escalated strata are reviewed in full
const blockRows = new Map<string, Map<number, Record<string, string>>>();
const rowsOf = (sampleId: string) => {
  const key = units.get(sampleId)!.block_files.replace(/\.\*$/u, '');
  if (!blockRows.has(key)) blockRows.set(key, new Map(parseCsv(readWork(`annotation-input/${key}.rows.csv`)).map(r => [Number(r.row_index), r])));
  return blockRows.get(key)!;
};
const REL_REF = /^(context|row:\d+)$/u;
const TOTAL_REF = /^\d+(;\d+)*$/u;
for (const r of final.rows) {
  const needs = r.review_required_reason !== '';
  const reviewed = r.human_review_status === 'REVIEWED';
  if (needs && !reviewed) fail(`${r.sample_id}: review required (${r.review_required_reason}) but not REVIEWED`);
  if (!reviewed) continue;
  const isTotal = r.unit_kind === 'TOTAL_SCOPE';
  if (!(isTotal ? TOTAL_DECISIONS : REL_DECISIONS).has(r.human_decision)) fail(`${r.sample_id}: invalid decision ${r.human_decision}`);
  if (r.human_decision !== 'RESOLVED') { if (r.human_parent_or_scope) fail(`${r.sample_id}: non-RESOLVED decision carries a parent/scope`); continue; }
  if (!(isTotal ? TOTAL_REF : REL_REF).test(r.human_parent_or_scope)) { fail(`${r.sample_id}: parent/scope not in canonical form: ${JSON.stringify(r.human_parent_or_scope)}`); continue; }
  const target = Number(units.get(r.sample_id)!.target_row_index);
  const rows = rowsOf(r.sample_id);
  if (isTotal) {
    const ids = r.human_parent_or_scope.split(';').map(Number);
    if (new Set(ids).size !== ids.length) fail(`${r.sample_id}: duplicate child rows`);
    if (ids.some(i => !rows.has(i) || i >= target)) fail(`${r.sample_id}: a child row is missing or not before the TOTAL row`);
    else if (!AMOUNTS.every(c => ids.reduce((s, i) => s + Number(rows.get(i)![c]), 0) === Number(rows.get(target)![c]))) fail(`${r.sample_id}: the 7 amount cells of the chosen children do not sum to the TOTAL row`);
  } else if (r.human_parent_or_scope !== 'context') {
    const parent = Number(r.human_parent_or_scope.slice(4));
    if (!rows.has(parent) || parent >= target) fail(`${r.sample_id}: parent row is missing or not before the target row`);
  }
}
const escalatedStrata = [...new Set(final.rows.filter(r => r.review_required_reason === 'ESCALATION').map(r => r.stratum))].sort();
for (const r of final.rows) if (escalatedStrata.includes(r.stratum) && r.human_review_status !== 'REVIEWED') fail(`${r.sample_id}: stratum ${r.stratum} was escalated but the unit is not reviewed`);

// 3. audit result of each submission against the annotators' consensus (history; not a validation)
const labelOf = (r: Record<string, string>) => {
  if (r.human_decision !== 'RESOLVED') return r.human_decision;
  const ref = r.human_parent_or_scope.split('\t')[0].trim();
  const value = /^\d+$/u.test(ref) ? ref : r.human_parent_or_scope;
  return r.unit_kind === 'TOTAL_SCOPE' ? `RESOLVED [${value}]` : /^\d+$/u.test(ref) ? `RESOLVED row:${ref}` : `RESOLVED ${value}`;
};
const auditHistory = submitted.map(s => {
  const audited = s.rows.filter(r => r.review_required_reason === 'AGREEMENT_AUDIT' && r.human_review_status === 'REVIEWED');
  const mismatches = audited.filter(r => labelOf(r) !== r.consensus_candidate).map(r => r.sample_id);
  return { file: s.name, sha256: sha256(s.text), reviewedUnits: s.rows.filter(r => r.human_review_status === 'REVIEWED').length, auditedUnits: audited.length, auditMismatches: mismatches };
});

if (errors.length) throw new Error(`GT freeze validation failed:\n${errors.join('\n')}`);

// 4. GT: human decision where a review reason exists, otherwise the annotators' consensus candidate
const parseConsensus = (r: Record<string, string>) => {
  const c = r.consensus_candidate;
  if (!c) throw new Error(`${r.sample_id}: no human review and no consensus candidate`);
  if (r.unit_kind === 'TOTAL_SCOPE') return c.startsWith('RESOLVED') ? { status: 'RESOLVED', ref: c.replace(/^RESOLVED \[|\]$/gu, '') } : { status: c, ref: '' };
  return c.startsWith('RESOLVED') ? { status: 'RESOLVED', ref: c.slice('RESOLVED '.length) } : { status: c, ref: '' };
};
const csv = (rows: Record<string, string>[]) => {
  const cols = Object.keys(rows[0]);
  const cell = (v: string) => (/[",\n]/u.test(v) ? `"${v.replace(/"/gu, '""')}"` : v);
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';
};
const relation: Record<string, string>[] = [];
const total: Record<string, string>[] = [];
for (const r of final.rows) {
  const u = units.get(r.sample_id)!;
  const human = r.human_review_status === 'REVIEWED';
  const g = human ? { status: r.human_decision, ref: r.human_parent_or_scope } : parseConsensus(r);
  const source = human ? 'HUMAN' : 'CONSENSUS_UNAUDITED';
  if (r.unit_kind === 'TOTAL_SCOPE') total.push({ sample_id: r.sample_id, stratum: r.stratum, table_block_id: u.table_block_id, target_row_index: u.target_row_index, scope_status: g.status, direct_child_row_indices: g.ref, gt_source: source });
  else relation.push({ sample_id: r.sample_id, unit_kind: r.unit_kind, stratum: r.stratum, table_block_id: u.table_block_id, target_row_index: u.target_row_index, status: g.status, parent_ref: g.ref, gt_source: source });
}

fs.mkdirSync(fixtureDir, { recursive: true });
const files: Record<string, string> = {};
const put = (name: string, content: string) => { fs.writeFileSync(path.join(fixtureDir, name), content); files[name] = sha256(content); };
submitted.forEach((s, i) => put(`human-review-submission-${i + 1}${i === submitted.length - 1 ? '-final' : ''}.csv`, s.text));
put('sample-manifest.csv', readWork('review/sample-manifest.csv'));
put('gt-relation.csv', csv(relation));
put('gt-total-scope.csv', csv(total));
const count = (xs: Record<string, string>[], key: string) => Object.fromEntries([...new Set(xs.map(x => x[key]))].sort().map(k => [k, xs.filter(x => x[key] === k).length]));
const manifest = {
  state: 'GT_FROZEN',
  units: final.rows.length,
  gtSource: count([...relation, ...total], 'gt_source'),
  relationStatus: count(relation, 'status'),
  totalScopeStatus: count(total, 'scope_status'),
  escalatedStrata,
  escalationUnitsAdded: [...escalationAdded].sort(),
  submissions: auditHistory,
  workDirHashes: { 'review/package-manifest.json': sha256(readWork('review/package-manifest.json')), 'prepare-manifest.json': sha256(readWork('prepare-manifest.json')) },
  files,
};
fs.writeFileSync(path.join(fixtureDir, 'gt-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ...manifest, gtManifestSha256: sha256(fs.readFileSync(path.join(fixtureDir, 'gt-manifest.json'), 'utf8')) }, null, 2));
