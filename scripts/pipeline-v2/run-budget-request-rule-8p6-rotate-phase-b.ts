/**
 * Phase B（MOF 名称 only exact）。Phase A freeze 後にのみ MOF を読む。candidate rule・band は変更しない。
 * protocol: docs/tasks/20261005_2115_Budget_Request_8p6pt_Full_Corpus_With_Rotate90_Protocol.md
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-rule-8p6-rotate-phase-b.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const A = `${FX}/budget-request-rule-8p6-rotate90/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const FROZEN: Record<string, string> = {
  [JIKOU]: 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e',
  'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts': 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  'docs/tasks/20261005_2115_Budget_Request_8p6pt_Full_Corpus_With_Rotate90_Protocol.md': 'e56d6038feb53741549a3c9df12a9d887d3c00bfbcb267a6f9fa8dadd5453645',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface Row { candidateId: string; isCandidate: boolean; localPath: string; filename: string; rotate: number; rawRowText: string; ministry: string; account: string; page: number; logicalRowIndex: number; code: string; codeX: number; nameRaw: string | null; nameNormalized: string | null; nameComplete: boolean; nameClass: string; ruleStatus: string; ruleX: number | null; deltaX: number | null }
interface Sec { id: string; code: string; name: string; norm: string; ministry: string; organization: string }

function loadMof(): Sec[] {
  const m = new Map<string, Sec>();
  for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !m.has(j.parentSectionId)) m.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry, organization: j.organization });
  if (m.size !== 784) throw new Error(`MOF 一般会計の項が 784 でない（STOP）: ${m.size}`);
  return [...m.values()].sort((a, b) => cmp(a.id, b.id));
}
function guard() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${A}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact / script が freeze と不一致（STOP）: ${p}`);
  return freeze;
}

function main() {
  const freeze = guard();
  const secs = loadMof();
  const byNorm = new Map<string, Sec[]>();
  for (const s of secs) { if (!byNorm.has(s.norm)) byNorm.set(s.norm, []); byNorm.get(s.norm)!.push(s); }
  const rows = readGz<Row>(`${A}/phaseA-universe.jsonl.gz`);
  const cands = rows.filter(r => r.isCandidate && r.account === 'general');
  const cls: Record<string, number> = {}, perPdf: Record<string, { candidates: number; exactRows: number; distinctMofRows: Set<string> }> = {};
  const matches: string[] = [], coveredRows = new Set<string>(), coveredNorms = new Set<string>();
  let exactCandidateRows = 0;
  for (const c of cands) {
    const p = (perPdf[c.localPath] ??= { candidates: 0, exactRows: 0, distinctMofRows: new Set() });
    p.candidates++;
    if (!c.nameComplete || c.nameNormalized === null) { inc(cls, 'name_unavailable'); continue; }
    const m = byNorm.get(normalizeKey(c.nameNormalized)) ?? [];
    if (m.length === 0) { inc(cls, 'no_exact_name_match'); continue; }
    inc(cls, m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous');
    exactCandidateRows++; p.exactRows++;
    for (const s of m) { coveredRows.add(s.id); coveredNorms.add(s.norm); p.distinctMofRows.add(s.id); matches.push(JSON.stringify({ mofSectionId: s.id, mofMinistry: s.ministry, mofCode: s.code, mofName: s.name, localPath: c.localPath, filename: c.filename, page: c.page, rotate: c.rotate, logicalRowIndex: c.logicalRowIndex, pdfCode: c.code, pdfRawName: c.nameRaw, normalizedName: c.nameNormalized, ruleX: c.ruleX, codeX: c.codeX, deltaX: c.deltaX, candidateNameClass: m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous', codeMatchesMof: s.code === c.code })); }
  }
  const absent = secs.filter(s => !coveredRows.has(s.id));
  const byMinistry: Record<string, number> = {}; for (const s of absent) inc(byMinistry, s.ministry);
  const gz = zlib.gzipSync(Buffer.from(matches.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${A}/phaseB-exact-matches.jsonl.gz`, gz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-8p6-rotate90-phaseB/v0',
    note: 'Phase A freeze 後の MOF 名称 only exact diagnostic。MOF は candidate 生成・band に使っていない。code は診断のみ。precision / recall ではない',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), phaseAFreeze: freeze.artifacts, exactMatchesGzSha256: sha(gz),
    mof: { generalRows: secs.length, distinctNormalizedNames: byNorm.size },
    candidates: { generalCandidateRows: cands.length, classCounts: cls, exactMatchCandidateRows: exactCandidateRows },
    coverage: { mofRowsWithExactNameCandidate: coveredRows.size, mofRowDenominator: secs.length, mofRowCoveragePercent: Math.round((coveredRows.size / secs.length) * 10000) / 100, distinctNormalizedNamesCovered: coveredNorms.size, distinctNormalizedNameDenominator: byNorm.size },
    unmatchedMofRows: absent.length, unmatchedByMinistry: Object.fromEntries(Object.entries(byMinistry).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))),
    unmatchedMof: absent.map(s => ({ mofSectionId: s.id, ministry: s.ministry, organization: s.organization, code: s.code, name: s.name })),
    perPdfExact: Object.fromEntries(Object.entries(perPdf).filter(([, v]) => v.exactRows > 0).sort().map(([k, v]) => [k, { candidates: v.candidates, exactRows: v.exactRows, distinctMofRows: v.distinctMofRows.size }])),
  }), null, 1)}\n`;
  fs.writeFileSync(`${A}/phaseB-diagnostic.json`, text);
  console.log(JSON.stringify({ sha: sha(text), cls, coverage: [coveredRows.size, secs.length, coveredNorms.size, byNorm.size], absent: absent.length, byMinistry, exactRows: exactCandidateRows, pdfsWithExact: Object.values(perPdf).filter(v => v.exactRows > 0).length }, null, 1));
}
main();
