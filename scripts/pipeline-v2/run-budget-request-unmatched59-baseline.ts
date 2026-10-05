/**
 * baseline（変更前）: 前回 after（既存 8.6pt candidate + 内閣府 profile candidate + continuation 発火の名称更新）を再計算し、exact 725 / unmatched 59 の identity を保存する。
 * protocol: docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const MC = `${FX}/budget-request-mext-continuation/2024`, LA = `${FX}/budget-request-item-layout-anchor/2024`, R = `${FX}/budget-request-rule-8p6-rotate90/2024`, OUT = `${FX}/budget-request-unmatched-59/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface Cand { candidateId: string; localPath: string; account: string; page: number; logicalRowIndex: number; nameRaw: string | null; nameNormalized: string | null; nameComplete: boolean; rowBBox?: { yMin: number; yMax: number } }
const prev = readJson<{ go: boolean; beforeAfter: { exactCoveredMofRows: { after: number }; unmatchedMofRows: { after: number }; mextUnmatched: { after: number } }; unmatchedAfter: { byMinistry: Record<string, number> } }>(`${MC}/after-evaluation.json`);
if (!prev.go || prev.beforeAfter.exactCoveredMofRows.after !== 725 || prev.beforeAfter.unmatchedMofRows.after !== 59 || prev.beforeAfter.mextUnmatched.after !== 5) throw new Error('前回 after（725 / 59 / 文科省 5）を再現できない（STOP）');
const universe = readGz<Cand & { isCandidate: boolean }>(`${R}/phaseA-universe.jsonl.gz`).filter(r => r.isCandidate);
const profile = readGz<Cand>(`${LA}/profile-candidates.jsonl.gz`);
const fired = new Map(readGz<{ candidateId: string; afterName: string; afterNameNormalized: string }>(`${MC}/continuation-fired.jsonl.gz`).map(f => [f.candidateId, f]));
const cands: Cand[] = [...universe, ...profile].map(c => { const f = fired.get(c.candidateId); return f ? { ...c, nameRaw: f.afterName, nameNormalized: f.afterNameNormalized, nameComplete: true } : c; });
const secMap = new Map<string, { id: string; code: string; name: string; norm: string; ministry: string; organization: string }>();
for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !secMap.has(j.parentSectionId)) secMap.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry, organization: j.organization });
if (secMap.size !== 784) throw new Error('MOF 一般会計 784 でない（STOP）');
const byNorm = new Map<string, string[]>();
for (const s of secMap.values()) byNorm.set(s.norm, [...(byNorm.get(s.norm) ?? []), s.id]);
const covered = new Set<string>();
for (const c of cands.filter(x => x.account === 'general')) if (c.nameComplete && c.nameNormalized) for (const i of byNorm.get(normalizeKey(c.nameNormalized)) ?? []) covered.add(i);
const secs = [...secMap.values()].sort((a, b) => cmp(a.id, b.id));
const unmatched = secs.filter(s => !covered.has(s.id));
const byMinistry: Record<string, number> = {}; for (const s of unmatched) inc(byMinistry, s.ministry);
if (covered.size !== 725 || unmatched.length !== 59 || JSON.stringify(sortDeep(byMinistry)) !== JSON.stringify(sortDeep(prev.unmatchedAfter.byMinistry))) throw new Error(`baseline を再現できない（STOP）: ${covered.size} / ${unmatched.length}`);
if (unmatched.some(s => s.name === '子ども・子育て支援年金特別会計へ繰入')) throw new Error('「子ども・子育て支援年金特別会計へ繰入」が unmatched に残っている（STOP）');
const text = `${JSON.stringify(sortDeep({
  schema: 'budget-request-unmatched59-baseline/v0', artifactHashes: { afterEvaluation: fileSha(`${MC}/after-evaluation.json`), continuationFired: fileSha(`${MC}/continuation-fired.jsonl.gz`), profileCandidates: fileSha(`${LA}/profile-candidates.jsonl.gz`), universe: fileSha(`${R}/phaseA-universe.jsonl.gz`) },
  mofTotal: 784, exactCovered: covered.size, unmatched: unmatched.length, unmatchedByMinistry: byMinistry, candidateRows: cands.length,
  exactCoveredMofRowIds: [...covered].sort(), unmatchedMof: unmatched.map(s => ({ mofSectionId: s.id, ministry: s.ministry, organization: s.organization, code: s.code, name: s.name, normalized: s.norm })),
}), null, 1)}\n`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/baseline.json`, text);
console.log(JSON.stringify({ sha: sha(text), covered: covered.size, unmatched: unmatched.length, byMinistry }));
