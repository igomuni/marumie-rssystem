/**
 * Phase B: candidate universe（frozen）の P1〜P5 の比較と判定（事前登録 Label_Shaped_Predicate_Ambiguity_Protocol）。membership は変更しない。
 * 使い方: npx tsx scripts/pipeline-v2/compare-budget-request-label-candidates.ts
 * 出力: tests/fixtures/budget-request-label-candidate/2024/comparison-decision.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { compareFeatures, decideAmbiguity, type FeatureTable } from './lib/budget-request-label-candidate';

const OUT = path.join('tests', 'fixtures', 'budget-request-label-candidate', '2024');
const UNIVERSE = path.join(OUT, 'candidate-universe.json.gz');
const UNIVERSE_GZ_SHA = '429ad6c01c2e962c8a9eea65bcaac2c40fefed54cf941f6d08e90c00a26cb776';
const PROTOCOL = 'docs/tasks/20261005_1200_Budget_Request_Label_Shaped_Predicate_Ambiguity_Protocol.md';
const PROTOCOL_SHA = '0d1e4bc8a6c0976e3903522c152a2ce32dfe76952acba3f67424917d1cd800cd';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };

interface Cand { id: string; localPath: string; page: number; logicalRowIndex: number; tokenIndexes: number[]; raw: string; normalized: string; frozen: { population: string; pageAmbiguous: boolean; relativePosition: string; candidateCountOnPage: number }; features: FeatureTable; projection: { shapes: { firstShapeStage: string; digitRemovalDependent: boolean } } }

function main() {
  const gz = fs.readFileSync(UNIVERSE);
  if (sha(gz) !== UNIVERSE_GZ_SHA) throw new Error('candidate universe が frozen 値と一致しない（STOP）');
  if (sha(fs.readFileSync(PROTOCOL)) !== PROTOCOL_SHA) throw new Error('protocol が frozen 値と一致しない（STOP）');
  const u = JSON.parse(zlib.gunzipSync(gz).toString('utf8')) as { accounting: { evaluablePages: number; ambiguousPages: number; candidateRows: number; uniqueIds: number; byPopulation: Record<string, number>; candidatePages: number }; candidates: Cand[] };
  const by = (p: string) => u.candidates.filter(c => c.frozen.population === p);
  const P1 = by('P1_projected_same_row'), P2 = by('P2_ambiguity_additional_after_code'), P3 = by('P3_nonambiguous_additional_after_code'), P4 = by('P4_before_first_code'), P5 = by('P5_other');
  const pages = (rs: Cand[]) => new Set(rs.map(c => `${c.localPath}|${c.page}`)).size;
  const provenanceMissing = u.candidates.filter(c => !c.localPath || !c.page || c.tokenIndexes.length === 0 || c.logicalRowIndex === undefined).length;
  const accountingOk = u.candidates.length === u.accounting.candidateRows && new Set(u.candidates.map(c => c.id)).size === u.candidates.length && P1.length + P2.length + P3.length + P4.length + P5.length === u.candidates.length;
  const knownOk = P1.length === 2532 && P2.length === 1786 && u.accounting.ambiguousPages === 1123 && u.accounting.evaluablePages === 9145;
  const results = compareFeatures(P1.map(c => c.features), P2.map(c => c.features));
  const decision = decideAmbiguity(accountingOk && knownOk, provenanceMissing, results);
  const rowLocalDisjoint = results.filter(r => r.group === 'row_local' && r.disjoint).map(r => r.feature);
  const contextDisjoint = results.filter(r => r.group === 'projection_context' && r.disjoint).map(r => r.feature);
  const rowLocalHighTvd = results.filter(r => r.group === 'row_local' && !r.disjoint && r.tvd >= 0.5).map(r => ({ feature: r.feature, tvd: r.tvd }));
  const rowLocalOverlap = results.filter(r => r.group === 'row_local' && !r.disjoint).sort((a, b) => b.tvd - a.tvd).slice(0, 15).map(r => ({ feature: r.feature, tvd: r.tvd, p1: r.p1Values, p2: r.p2Values }));
  // A4 normalization dependency
  const norm = (rs: Cand[]) => { const path: Record<string, number> = {}; let dep = 0; for (const c of rs) { inc(path, c.projection.shapes.firstShapeStage); if (c.projection.shapes.digitRemovalDependent) dep++; } return { rows: rs.length, digitRemovalDependent: dep, firstShapeStage: path }; };
  // candidate/page 分布
  const perPage: Record<string, number> = {};
  const pageCount = new Map<string, number>();
  for (const c of u.candidates) pageCount.set(`${c.localPath}|${c.page}`, (pageCount.get(`${c.localPath}|${c.page}`) ?? 0) + 1);
  for (const n of pageCount.values()) inc(perPage, n >= 11 ? '11+' : String(n));
  // P2 の lexical / normalization class（post-freeze inspection 用のクラス別件数）
  const p2Class: Record<string, number> = {};
  for (const c of P2) inc(p2Class, `${c.projection.shapes.firstShapeStage}|digitDep=${c.projection.shapes.digitRemovalDependent}`);
  const p2Pages = pages(P2);
  const out = sortDeep({
    schema: 'budget-request-label-candidate-comparison/v0', note: 'universe の membership は変更していない。manual contract・MOF・existing ON kind・組織名辞書・human label は未使用。separator は projection context と row-local を分けて報告',
    frozen: { universeGzSha256: UNIVERSE_GZ_SHA, protocolSha256: PROTOCOL_SHA },
    accounting: { evaluablePages: u.accounting.evaluablePages, candidateRows: u.candidates.length, candidatePages: u.accounting.candidatePages, candidatesPerPageDistribution: perPage, populations: { P1: { rows: P1.length, pages: pages(P1) }, P2: { rows: P2.length, pages: p2Pages }, P3: { rows: P3.length, pages: pages(P3) }, P4: { rows: P4.length, pages: pages(P4) }, P5: { rows: P5.length, pages: pages(P5) } }, ambiguousPages: u.accounting.ambiguousPages, provenanceMissing, accountingComplete: accountingOk, knownValuesReproduced: knownOk },
    A3_separators: { projectionContextDisjoint: contextDisjoint, rowLocalDisjoint, rowLocalTvdAtLeast0_5: rowLocalHighTvd },
    A2_rowLocalTopOverlap: rowLocalOverlap, A4_normalization: { P1: norm(P1), P2: norm(P2), P3: norm(P3), P4: norm(P4) }, P2ClassCounts: p2Class,
    unresolved5: { reference: 'primary-evaluation の C2_unresolved（2023_fukkochougaisansaisyutsu.pdf の 5 page。最初の code row が request 行）。今回の mechanism とは独立のまま・参照のみ' },
    features: results, decision,
  });
  const text = `${JSON.stringify(out, null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'comparison-decision.json'), text);
  console.log(JSON.stringify({ sha: sha(text), accounting: (out as { accounting: unknown }).accounting, contextDisjoint, rowLocalDisjoint, rowLocalHighTvd, norm: (out as { A4_normalization: unknown }).A4_normalization, p2Class, decision }, null, 1));
}
main();
