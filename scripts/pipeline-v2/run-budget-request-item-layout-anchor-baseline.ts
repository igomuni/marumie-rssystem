/**
 * baseline freeze（変更前）: 既存 Phase B の評価（8.6±3pt candidate vs MOF 名称 only exact）を、既存 artifact から再構成して baseline.json に保存する。
 * protocol: docs/tasks/20261005_2245_Budget_Request_Item_Layout_Anchor_Coverage_Protocol.md
 * 使い方: node --import tsx scripts/pipeline-v2/run-budget-request-item-layout-anchor-baseline.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';

const FX = 'tests/fixtures';
const R = `${FX}/budget-request-rule-8p6-rotate90/2024`, OUT = `${FX}/budget-request-item-layout-anchor/2024`;
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

const freeze = readJson<{ artifacts: Record<string, string> }>(`${R}/phaseA-freeze-manifest.json`);
for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact が freeze と不一致（STOP）: ${p}`);
const b = readJson<{ mof: { generalRows: number }; coverage: { mofRowsWithExactNameCandidate: number; distinctNormalizedNamesCovered: number; distinctNormalizedNameDenominator: number }; unmatchedMofRows: number; unmatchedByMinistry: Record<string, number>; unmatchedMof: unknown[]; perPdfExact: Record<string, unknown>; exactMatchesGzSha256: string; candidates: { generalCandidateRows: number } }>(`${R}/phaseB-diagnostic.json`);
if (fileSha(`${R}/phaseB-exact-matches.jsonl.gz`) !== b.exactMatchesGzSha256) throw new Error('Phase B の exact match artifact が一致しない（STOP）');
if (b.mof.generalRows !== 784 || b.coverage.mofRowsWithExactNameCandidate !== 661 || b.unmatchedMofRows !== 123 || b.unmatchedByMinistry['内閣府'] !== 66) throw new Error('baseline（784 / 661 / 123 / 内閣府 66）を再現できない（STOP）');
const universe = zlib.gunzipSync(fs.readFileSync(`${R}/phaseA-universe.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as { isCandidate: boolean; localPath: string; account: string; pdfSha256: string });
const cands = universe.filter(r => r.isCandidate);
const perPdfCandidates: Record<string, { candidates: number; account: string; pdfSha256: string }> = {};
for (const c of cands) { const e = (perPdfCandidates[c.localPath] ??= { candidates: 0, account: c.account, pdfSha256: c.pdfSha256 }); e.candidates++; }
const text = `${JSON.stringify(sortDeep({
  schema: 'budget-request-item-layout-anchor-baseline/v0',
  note: '変更前の baseline（既存 Phase B）。before/after 比較の基準は 661 / 784',
  artifactHashes: freeze.artifacts, phaseBDiagnosticSha256: fileSha(`${R}/phaseB-diagnostic.json`), exactMatchesGzSha256: b.exactMatchesGzSha256,
  mofTotal: b.mof.generalRows, exactCoveredMofRows: b.coverage.mofRowsWithExactNameCandidate, unmatchedMofRows: b.unmatchedMofRows, distinctNormalizedNamesCovered: b.coverage.distinctNormalizedNamesCovered, distinctNormalizedNameDenominator: b.coverage.distinctNormalizedNameDenominator,
  candidateRows: cands.length, generalCandidateRows: b.candidates.generalCandidateRows, unmatchedByMinistry: b.unmatchedByMinistry, perPdfCandidates, perPdfExact: b.perPdfExact, unmatchedMof: b.unmatchedMof,
}), null, 1)}\n`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/baseline.json`, text);
console.log(JSON.stringify({ sha: sha(text), candidateRows: cands.length, pdfsWithCandidates: Object.keys(perPdfCandidates).length }));
