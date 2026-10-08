/**
 * TOC A 層 row assembly preregistration の held-out candidate 母集団と sample membership を決定的に生成する（machine inventory のみを使用。render・目視・parser は使わない）。
 * 母集団 = TOC 82 − PR-3A explored − #389 explored − #390 NEW_DEVELOPMENT（RECHECK は #389 explored に含まれる）。
 * 選定 rule は preregistration の一部であり、parser 実装前に freeze する。GT / 評価結果を見て変更しない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-toc-row-assembly-heldout-candidates.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-toc-row-assembly/2024/heldout-candidates.json（--freeze-fixture のとき）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const FREEZE = process.argv.includes('--freeze-fixture');
const PHYS = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024', 'heldout-candidates.json');
export const HELDOUT_SEED = 'budget-request-toc-row-assembly-heldout-20261008';
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface Pg { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string; publisherDomain: string; bodyLineCount: number; h_a1: { rightRowLineCount: number }; h_a2: { leftFragmentLines: number; rightFragmentLines: number; simultaneousFragmentLines: number }; explored: { pr3aExplored: boolean; issue389Explored: boolean } }
function main() {
  const inv = readJson<{ frozenInput: { rawTextCorpusDigestSha256: string; pageClassificationCorpusDigestSha256: string }; pages: Pg[] }>(path.join(PHYS, 'candidate-inventory.json'));
  const band = readJson<{ pages: { localPdfPath: string; physicalPage: number; hasRightRow: boolean; indexSpread: { req: number | null; marker: number | null } }[] }>(path.join(PHYS, 'boundary-band-evidence.json'));
  const led = readJson<{ pages: { localPdfPath: string; physicalPage: number; role: string }[] }>(path.join(PHYS, 'development-explored-pages.json'));
  const bmap = new Map(band.pages.map(b => [key(b), b]));
  const explored390 = new Set(led.pages.map(key));
  const excluded = (p: Pg) => p.explored.pr3aExplored || p.explored.issue389Explored || explored390.has(key(p));
  if (inv.pages.length !== 82) throw new Error('TOC population mismatch');
  const pool = inv.pages.filter(p => !excluded(p));
  const strata: Record<string, { rule: (p: Pg) => boolean; take: number }> = {
    'right-column-used(right-row evidence)': { rule: p => p.h_a1.rightRowLineCount > 0, take: 6 },
    'no-right-row-evidence & body>=15': { rule: p => p.h_a1.rightRowLineCount === 0 && p.bodyLineCount >= 15, take: 4 },
    'no-right-row-evidence & body<15': { rule: p => p.h_a1.rightRowLineCount === 0 && p.bodyLineCount < 15, take: 2 },
    'wrapped-fragment(right column line>=1)': { rule: p => p.h_a2.rightFragmentLines >= 1, take: 3 },
    'wrapped-fragment(left column line>=1)': { rule: p => p.h_a2.leftFragmentLines >= 1, take: 2 },
    'asymmetric(right-row lines<30% of body)': { rule: p => p.h_a1.rightRowLineCount > 0 && p.h_a1.rightRowLineCount < 0.3 * p.bodyLineCount, take: 2 },
    'INHERITED': { rule: p => p.classifierSource === 'INHERITED', take: 3 },
    'DIRECT': { rule: p => p.classifierSource === 'DIRECT', take: 3 },
  };
  // pool 0 の stratum は存在するものとして扱わない（記録のみ）
  const zeroPool: Record<string, number> = {
    'marker-only right column (right-row evidence without request-number kind)': pool.filter(p => { const b = bmap.get(key(p))!; return b.hasRightRow && b.indexSpread.req === null; }).length,
    'simultaneous left/right fragment on one raw line (machine candidate)': pool.filter(p => p.h_a2.simultaneousFragmentLines > 0).length,
    'OTHER_CODE row (indented 3-digit code sub row; machine regex)': 0,
  };
  const hk = (s: string, p: Pg) => sha256Hex(`${HELDOUT_SEED}|${s}|${p.localPdfPath}|${p.physicalPage}`);
  const picked = new Map<string, { p: Pg; strata: string[] }>();
  const poolSizes: Record<string, number> = {};
  for (const [s, { rule, take }] of Object.entries(strata)) {
    const c = pool.filter(rule);
    poolSizes[s] = c.length;
    const sorted = [...c].sort((a, b) => cmp(hk(s, a), hk(s, b)));
    const chosen: Pg[] = []; const pubs = new Set<string>();
    for (const p of sorted) if (chosen.length < take && !pubs.has(p.publisherDomain)) { chosen.push(p); pubs.add(p.publisherDomain); }
    for (const p of sorted) if (chosen.length < take && !chosen.includes(p)) chosen.push(p);
    for (const p of chosen) { const e = picked.get(key(p)) ?? { p, strata: [] }; e.strata.push(s); picked.set(key(p), e); }
  }
  const pages = [...picked.values()].map(({ p, strata: st }) => ({ localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierPageType: 'TOC', classifierSource: p.classifierSource, publisherDomain: p.publisherDomain, evaluationRole: 'HELDOUT_CANDIDATE', selectionStratum: st.sort() }))
    .sort((a, b) => cmp(a.localPdfPath, b.localPdfPath) || a.physicalPage - b.physicalPage);
  const out = {
    schema: 'budget-request-toc-row-assembly-heldout-candidates/v0',
    scope: 'held-out candidate membership（machine inventory のみから決定。render・目視・GT・parser は未使用）。development explored page は全て除外。GT は次工程で作る',
    generator: 'scripts/pipeline-v2/build-budget-request-toc-row-assembly-heldout-candidates.ts',
    frozenInput: { rawTextCorpusDigestSha256: inv.frozenInput.rawTextCorpusDigestSha256, pageClassificationCorpusDigestSha256: inv.frozenInput.pageClassificationCorpusDigestSha256, candidateInventorySha256: sha256Hex(fs.readFileSync(path.join(PHYS, 'candidate-inventory.json'))), boundaryBandEvidenceSha256: sha256Hex(fs.readFileSync(path.join(PHYS, 'boundary-band-evidence.json'))) },
    seed: HELDOUT_SEED, hashRule: 'sha256("{seed}|{stratum}|{localPdfPath}|{physicalPage}") 昇順。publisher 重複を避けて先頭 take 件、足りなければ hash 順で補う',
    population: { toc: 82, excludedExplored: inv.pages.length - pool.length, pool: pool.length },
    strata: Object.fromEntries(Object.entries(strata).map(([s, v]) => [s, { take: v.take, pool: poolSizes[s] }])),
    zeroPoolStrata: zeroPool,
    sampleSize: pages.length, byClassifierSource: { DIRECT: pages.filter(p => p.classifierSource === 'DIRECT').length, INHERITED: pages.filter(p => p.classifierSource === 'INHERITED').length },
    membershipDigestSha256: sha256Hex(pages.map(p => `${p.localPdfPath} ${p.pdfSha256} ${p.physicalPage} ${p.textSha256}`).join('\n')),
    pages,
  };
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`); }
  console.log(JSON.stringify({ population: out.population, strata: out.strata, zeroPoolStrata: out.zeroPoolStrata, sampleSize: out.sampleSize, bySource: out.byClassifierSource, digest: out.membershipDigestSha256 }, null, 1));
}
main();
