/**
 * baseline freeze（変更前）: 前回 after（既存 8.6pt candidate + 内閣府 profile candidate）を同じ突合関数で再計算し、717 / 784 などを baseline.json に保存する。
 * protocol: docs/tasks/20261006_0640_Budget_Request_MEXT_Item_Name_Continuation_Protocol.md
 * 使い方: node --import tsx scripts/pipeline-v2/run-budget-request-mext-continuation-baseline.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const LA = `${FX}/budget-request-item-layout-anchor/2024`, R = `${FX}/budget-request-rule-8p6-rotate90/2024`, OUT = `${FX}/budget-request-mext-continuation/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const MEXT_PDF = 'data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface Cand { candidateId: string; localPath: string; account: string; nameNormalized: string | null; nameComplete: boolean }
const prev = readJson<{ beforeAfter: { exactCoveredMofRows: { after: number }; unmatchedMofRows: { after: number }; candidateRowsAll: { after: number }; distinctNormalizedNamesCovered: { after: number } }; unmatchedAfter: { byMinistry: Record<string, number>; mext: { items: { mofSectionId: string; sourceClass: string; name: string; code: string }[] } }; go: boolean }>(`${LA}/after-evaluation.json`);
if (!prev.go || prev.beforeAfter.exactCoveredMofRows.after !== 717 || prev.beforeAfter.unmatchedMofRows.after !== 67 || prev.unmatchedAfter.byMinistry['文部科学省'] !== 8) throw new Error('前回 after（717 / 67 / 文科省 8）を再現できない（STOP）');
const universe = readGz<Cand & { isCandidate: boolean }>(`${R}/phaseA-universe.jsonl.gz`).filter(r => r.isCandidate);
const profile = readGz<Cand>(`${LA}/profile-candidates.jsonl.gz`);
const cands: Cand[] = [...universe, ...profile];
const secMap = new Map<string, { id: string; code: string; name: string; norm: string; ministry: string }>();
for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !secMap.has(j.parentSectionId)) secMap.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry });
if (secMap.size !== 784) throw new Error('MOF 一般会計 784 でない（STOP）');
const byNorm = new Map<string, string[]>();
for (const s of secMap.values()) byNorm.set(s.norm, [...(byNorm.get(s.norm) ?? []), s.id]);
const covered = new Set<string>(), cls: Record<string, number> = {}, perPdfExact: Record<string, number> = {};
for (const c of cands.filter(x => x.account === 'general')) {
  if (!c.nameComplete || !c.nameNormalized) { inc(cls, 'name_unavailable'); continue; }
  const m = byNorm.get(normalizeKey(c.nameNormalized)) ?? [];
  if (m.length === 0) { inc(cls, 'no_exact_name_match'); continue; }
  inc(cls, m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous'); inc(perPdfExact, c.localPath);
  for (const i of m) covered.add(i);
}
const secs = [...secMap.values()].sort((a, b) => cmp(a.id, b.id));
if (covered.size !== 717 || cands.length !== prev.beforeAfter.candidateRowsAll.after) throw new Error(`baseline 再計算が前回と一致しない（STOP）: ${covered.size} / ${cands.length}`);
const unmatched = secs.filter(s => !covered.has(s.id));
const mextUnmatched = unmatched.filter(s => s.ministry === '文部科学省');
if (unmatched.length !== 67 || mextUnmatched.length !== 8) throw new Error('unmatched 67 / 文科省 8 を再現できない（STOP）');
const text = `${JSON.stringify(sortDeep({
  schema: 'budget-request-mext-continuation-baseline/v0', note: '変更前の baseline（前回 after）。before/after 比較の基準は 717 / 784',
  sourcePdf: { path: MEXT_PDF, sha256: fileSha(MEXT_PDF) },
  artifactHashes: { afterEvaluation: fileSha(`${LA}/after-evaluation.json`), profileCandidates: fileSha(`${LA}/profile-candidates.jsonl.gz`), universe: fileSha(`${R}/phaseA-universe.jsonl.gz`) },
  mofTotal: 784, exactCoveredMofRows: covered.size, unmatchedMofRows: unmatched.length, mextUnmatchedRows: mextUnmatched.length, candidateRows: cands.length, generalCandidateRows: cands.filter(c => c.account === 'general').length, candidateClassCounts: cls, perPdfExactCandidateRows: perPdfExact,
  distinctNormalizedNamesCovered: new Set([...covered].map(i => secMap.get(i)!.norm)).size, exactCoveredMofRowIds: [...covered].sort(),
  mextUnmatched: mextUnmatched.map(s => ({ mofSectionId: s.id, code: s.code, name: s.name, sourceClass: prev.unmatchedAfter.mext.items.find(i => i.mofSectionId === s.id)?.sourceClass })),
  unmatchedByMinistry: prev.unmatchedAfter.byMinistry,
}), null, 1)}\n`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/baseline.json`, text);
console.log(JSON.stringify({ sha: sha(text), covered: covered.size, candidates: cands.length, mext: mextUnmatched.length }));
