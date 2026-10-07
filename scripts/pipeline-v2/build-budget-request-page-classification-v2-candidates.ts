/**
 * Page Classification v2（closed-scope）の GT candidate を、preregistration の凍結ルールだけから決定的に生成する。label は見ない・付けない。
 * v0 classifier specification（matcher・継承規則・blank bridge・reset）は変更せず、candidate selection のために機械適用する。
 * prior GT（v0・v1）は key exclusion のためにだけ読む。semantic label は sampling に使わない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-page-classification-v2-candidates.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v2-candidates.json（--freeze-fixture のときだけ）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { DIRECT_TITLES, INHERITABLE, directMatch, type DirectFamily, type DirectResult } from './lib/budget-request-page-classification-direct';

export const V2_SEED = 'budget-request-page-classification-v2-closed-scope-20261007';
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PHASE_A = path.join(DIR, 'empty-page-failure-isolation.json');
const V0_GT = path.join(DIR, 'page-classification-v0-visual-gt.json');
const V1_GT = path.join(DIR, 'page-classification-v1-eval-visual-gt.json');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024');
const OUT = path.join(DIR, 'page-classification-v2-candidates.json');
const FREEZE = process.argv.includes('--freeze-fixture');
const FROZEN_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';

const A_PER_FAMILY = 12;
const B_PER_BUCKET = 4;
const C_CAP = 12;
const RANDOM_PAGES = 48;
const BUCKETS = ['D1', 'D2_5', 'D6_20', 'D21_PLUS'] as const;

type RawStatus = 'EXTRACTED' | 'EMPTY';
interface Doc { localPdfPath: string; pdfSha256: string; publisherDomain: string; logicalDocumentIndex: number; pageCount: number; status: string; artifactPath: string; pageTextSha256: string[] }
interface PageObs {
  page: number; rawStatus: RawStatus; textSha256: string; direct: DirectResult;
  activeStateFamily: DirectFamily | null; distance: number | null;
  emptyKind: 'NONE' | 'VISUALLY_BLANK' | 'RASTER' | 'UNRESOLVED_EMPTY';
  c2: boolean; c3: boolean; c4: boolean;
}

const hashKey = (stratum: string, family: string, bucket: string, p: string, page: number) => sha256Hex(`${V2_SEED}|${stratum}|${family}|${bucket}|${p}|${page}`);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const bucketOf = (d: number) => (d === 1 ? 'D1' : d <= 5 ? 'D2_5' : d <= 20 ? 'D6_20' : 'D21_PLUS');

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_MANIFEST, 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: Doc[] };
  if (raw.frozenInput.corpusDigestSha256 !== FROZEN_DIGEST) throw new Error('raw text corpus digest mismatch');
  const phaseA = JSON.parse(fs.readFileSync(PHASE_A, 'utf8')) as { pages: { localPdfPath: string; physicalPage: number; isolationCategory: string }[] };
  const emptyKind = new Map(phaseA.pages.map(p => [`${p.localPdfPath}#${p.physicalPage}`, p.isolationCategory === 'VISUALLY_BLANK' ? 'VISUALLY_BLANK' : 'RASTER'] as const));
  const keysOf = (f: string) => (JSON.parse(fs.readFileSync(f, 'utf8')) as { rows: { localPdfPath: string; physicalPage: number }[] }).rows.map(r => `${r.localPdfPath}#${r.physicalPage}`);
  const v0Rows = keysOf(V0_GT);
  const v1Rows = keysOf(V1_GT);
  if (v0Rows.length !== 172 || v1Rows.length !== 89) throw new Error(`prior GT rows ${v0Rows.length}/${v1Rows.length}`);
  const exclusion = new Set([...v0Rows, ...v1Rows]);

  // 全 page の machine observation（v0 の frozen state machine）
  const pagesByDoc = new Map<string, PageObs[]>();
  let textHashMismatch = 0;
  for (const d of raw.documents) {
    const infos: Omit<PageObs, 'activeStateFamily' | 'distance' | 'c2' | 'c3' | 'c4'>[] = [];
    if (d.status === 'EMPTY') {
      d.pageTextSha256.forEach((h, i) => infos.push({ page: i + 1, rawStatus: 'EMPTY', textSha256: h, direct: { kind: 'NONE' }, emptyKind: 'UNRESOLVED_EMPTY' }));
    } else {
      const lines = fs.readFileSync(path.join(PAGES_DIR, d.artifactPath), 'utf8').split('\n').filter(l => l);
      if (lines.length !== d.pageCount) throw new Error(`page record count mismatch: ${d.localPdfPath}`);
      lines.forEach((l, i) => {
        const r = JSON.parse(l) as { page: number; text: string; textSha256: string; status: RawStatus; nonEmptyLines: { text: string }[] };
        if (r.page !== i + 1 || r.textSha256 !== d.pageTextSha256[i] || sha256Hex(r.text) !== r.textSha256) textHashMismatch++;
        const ek = r.status === 'EMPTY' ? (emptyKind.get(`${d.localPdfPath}#${r.page}`) ?? 'UNRESOLVED_EMPTY') : 'NONE';
        infos.push({ page: r.page, rawStatus: r.status, textSha256: r.textSha256, direct: r.status === 'EXTRACTED' ? directMatch(r.nonEmptyLines) : ({ kind: 'NONE' } as DirectResult), emptyKind: ek });
      });
    }
    let state: DirectFamily | null = null;
    let dist = 0;
    let postReset = false;
    let sawText = false;
    const out: PageObs[] = infos.map(p => ({ ...p, activeStateFamily: null, distance: null, c2: false, c3: false, c4: false }));
    out.forEach(p => {
      if (p.rawStatus === 'EMPTY') {
        if (p.emptyKind === 'VISUALLY_BLANK') return;
        state = null; dist = 0; postReset = true; return;
      }
      if (!sawText) { p.c3 = p.direct.kind === 'NONE'; sawText = true; }
      p.c2 = postReset; postReset = false;
      if (p.direct.kind === 'DIRECT') { state = INHERITABLE.includes(p.direct.family) ? p.direct.family : null; dist = 0; }
      else if (p.direct.kind === 'CONFLICT') { state = null; dist = 0; postReset = true; }
      else if (state) { dist++; p.activeStateFamily = state; p.distance = dist; }
    });
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      if (p.rawStatus !== 'EXTRACTED' || p.direct.kind !== 'NONE' || !p.activeStateFamily) continue;
      for (let j = i + 1; j < out.length; j++) {
        const q = out[j];
        if (q.rawStatus === 'EMPTY') { if (q.emptyKind === 'VISUALLY_BLANK') continue; break; }
        if (q.direct.kind === 'DIRECT' && q.direct.family !== p.activeStateFamily) p.c4 = true;
        break;
      }
    }
    pagesByDoc.set(d.localPdfPath, out);
  }
  if (textHashMismatch) throw new Error(`text hash mismatch: ${textHashMismatch}`);

  const all = raw.documents.flatMap(d => pagesByDoc.get(d.localPdfPath)!.map(p => ({ d, p })));
  const textObservable = all.filter(x => x.p.rawStatus === 'EXTRACTED');
  if (all.length !== 9899 || textObservable.length !== 8968) throw new Error(`population mismatch ${all.length}/${textObservable.length}`);
  const pool = textObservable.filter(x => !exclusion.has(`${x.d.localPdfPath}#${x.p.page}`));

  type Item = (typeof pool)[number];
  const keyOf = (x: Item) => `${x.d.localPdfPath}#${x.p.page}`;
  const byHash = (stratum: string, family: string, bucket: string, list: Item[]) => [...list].sort((a, b) => cmp(hashKey(stratum, family, bucket, a.d.localPdfPath, a.p.page), hashKey(stratum, family, bucket, b.d.localPdfPath, b.p.page)));
  const rows = new Map<string, { x: Item; strata: string[] }>();
  const add = (x: Item, stratum: string) => { const r = rows.get(keyOf(x)) ?? { x, strata: [] }; r.strata.push(stratum); rows.set(keyOf(x), r); };
  const poolSizes: Record<string, number> = {};

  // A. DIRECT_BALANCED_V2
  for (const { family } of DIRECT_TITLES) {
    const c = pool.filter(x => x.p.direct.kind === 'DIRECT' && x.p.direct.family === family);
    poolSizes[`DIRECT_BALANCED_V2|${family}`] = c.length;
    for (const x of byHash('DIRECT_BALANCED_V2', family, '', c).slice(0, A_PER_FAMILY)) add(x, 'DIRECT_BALANCED_V2');
  }
  // B. CONTINUATION_BALANCED_V2
  for (const family of INHERITABLE) for (const b of BUCKETS) {
    const c = pool.filter(x => x.p.direct.kind === 'NONE' && x.p.activeStateFamily === family && bucketOf(x.p.distance!) === b);
    poolSizes[`CONTINUATION_BALANCED_V2|${family}|${b}`] = c.length;
    for (const x of byHash('CONTINUATION_BALANCED_V2', family, b, c).slice(0, B_PER_BUCKET)) add(x, 'CONTINUATION_BALANCED_V2');
  }
  // C. KNOWN_COVERAGE_RISK_V2
  const risk: Record<string, (x: Item) => boolean> = {
    NO_ACTIVE_STATE: x => x.p.direct.kind === 'NONE' && x.p.activeStateFamily === null,
    POST_RESET: x => x.p.c2,
    PDF_START_WITHOUT_DIRECT: x => x.p.c3,
    PRE_DIRECT_TRANSITION: x => x.p.c4,
  };
  for (const [name, cond] of Object.entries(risk)) {
    const c = pool.filter(cond);
    poolSizes[`KNOWN_COVERAGE_RISK_V2:${name}`] = c.length;
    for (const x of byHash(`KNOWN_COVERAGE_RISK_V2:${name}`, '', '', c).slice(0, C_CAP)) add(x, `KNOWN_COVERAGE_RISK_V2:${name}`);
  }
  // D. CORPUS_RANDOM_V2
  const rest = pool.filter(x => !rows.has(keyOf(x)));
  poolSizes.CORPUS_RANDOM_V2 = rest.length;
  for (const x of byHash('CORPUS_RANDOM_V2', '', '', rest).slice(0, RANDOM_PAGES)) add(x, 'CORPUS_RANDOM_V2');

  const list = [...rows.values()].map(({ x, strata }) => ({
    localPdfPath: x.d.localPdfPath, pdfSha256: x.d.pdfSha256, physicalPage: x.p.page, textSha256: x.p.textSha256,
    publisherDomain: x.d.publisherDomain, logicalDocumentIndex: x.d.logicalDocumentIndex,
    evaluationRole: 'FROZEN_EVALUATION_V2' as const,
    strata: [...strata].sort(),
    samplingObservation: {
      directResult: x.p.direct.kind === 'DIRECT' ? x.p.direct.family : x.p.direct.kind === 'CONFLICT' ? 'CONFLICT' : x.p.rawStatus === 'EXTRACTED' ? 'NONE' : null,
      activeStateFamily: x.p.activeStateFamily,
      distanceBucket: x.p.distance === null ? null : bucketOf(x.p.distance),
    },
  })).sort((a, b) => cmp(a.localPdfPath, b.localPdfPath) || a.physicalPage - b.physicalPage);
  const tally = (f: (r: (typeof list)[number]) => string[]) => { const o: Record<string, number> = {}; for (const r of list) for (const k of f(r)) o[k] = (o[k] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b))); };
  const out = {
    schema: 'budget-request-page-classification-v2-candidates/v0',
    scope: 'v2 closed-scope evaluation の GT candidate 凍結。label 未付与。classifier は未実装。v0 classifier specification は変更しない',
    generator: 'scripts/pipeline-v2/build-budget-request-page-classification-v2-candidates.ts',
    frozenInput: {
      rawTextCorpusDigestSha256: FROZEN_DIGEST,
      v0VisualGtFixtureSha256: sha256Hex(fs.readFileSync(V0_GT)),
      v1VisualGtFixtureSha256: sha256Hex(fs.readFileSync(V1_GT)),
      phaseAFixtureSha256: sha256Hex(fs.readFileSync(PHASE_A)),
    },
    parameters: { seed: V2_SEED, hashRule: 'sha256("{seed}|{stratum}|{family}|{bucket}|{localPdfPath}|{physicalPage}") 昇順（該当しない field は空文字）', directPerFamily: A_PER_FAMILY, continuationPerFamilyBucket: B_PER_BUCKET, riskCap: C_CAP, randomPages: RANDOM_PAGES, distanceBuckets: { D1: '1', D2_5: '2..5', D6_20: '6..20', D21_PLUS: '>=21' } },
    priorGtExclusion: { v0Rows: v0Rows.length, v1Rows: v1Rows.length, uniqueKeys: exclusion.size },
    population: { physicalPages: all.length, textObservable: textObservable.length, poolAfterPriorGtExclusion: pool.length },
    poolSizes,
    summary: {
      rows: list.length, duplicateKeys: 0, textHashMismatch, priorGtOverlap: list.filter(r => exclusion.has(`${r.localPdfPath}#${r.physicalPage}`)).length,
      byStratum: tally(r => r.strata),
      byPublisher: tally(r => [r.publisherDomain]),
    },
    rows: list,
  };
  if (FREEZE) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`); }
  console.log(JSON.stringify({ priorGtExclusion: out.priorGtExclusion, population: out.population, poolSizes, summary: out.summary }, null, 1));
}
main();
