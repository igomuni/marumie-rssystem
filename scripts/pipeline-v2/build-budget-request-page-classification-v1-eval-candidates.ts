/**
 * Page Classification v1 evaluation design の GT candidate を、preregistration の凍結ルールだけから決定的に生成する。label は見ない・付けない。
 * v0 の classifier specification（matcher・継承規則）は変更せず、candidate selection のために機械適用する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-page-classification-v1-eval-candidates.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v1-eval-candidates.json（--freeze-fixture のときだけ）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { DIRECT_TITLES, INHERITABLE, directMatch, type DirectFamily, type DirectResult } from './lib/budget-request-page-classification-direct';

export const V1_SEED = 'budget-request-page-classification-v1-eval-20261007';
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PHASE_A = path.join(DIR, 'empty-page-failure-isolation.json');
const V0_CAND = path.join(DIR, 'page-classification-v0-candidates.json');
const V0_GT = path.join(DIR, 'page-classification-v0-visual-gt.json');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024');
const OUT = path.join(DIR, 'page-classification-v1-eval-candidates.json');
const FREEZE = process.argv.includes('--freeze-fixture');
const FROZEN_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';

const A_PER_FAMILY = 8;
const B_PER_BUCKET = 2;
const R_CAP = 24;
const R_PER_DOMAIN = 3;
const R3_MIN_DISTANCE = 20;
const R3_PER_FAMILY = 6;
const RANDOM_PAGES = 32;
const TITLE_SEARCH_LINES = [6, 20] as const; // 1-based, inclusive

type RawStatus = 'EXTRACTED' | 'EMPTY';
interface Doc { localPdfPath: string; pdfSha256: string; publisherDomain: string; logicalDocumentIndex: number; pageCount: number; status: string; artifactPath: string; pageTextSha256: string[] }
interface PageObs {
  page: number; rawStatus: RawStatus; textSha256: string; direct: DirectResult; titleInLines6to20: boolean;
  activeStateFamily: DirectFamily | null; distance: number | null; // NONE page のみ（state 無しなら distance null）
  emptyKind: 'NONE' | 'VISUALLY_BLANK' | 'RASTER' | 'UNRESOLVED_EMPTY';
  r2: boolean; r4: boolean; r5: boolean; r7: boolean;
}

const hashKey = (tag: string, p: string, page: number) => sha256Hex(`${V1_SEED}|${tag}|${p}|${page}`);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bucketOf = (d: number) => (d === 1 ? 'd1' : d === 2 ? 'd2' : d <= 5 ? 'd3-5' : 'd6+');

function titleInWindow(lines: { text: string }[]): boolean {
  return lines.slice(TITLE_SEARCH_LINES[0] - 1, TITLE_SEARCH_LINES[1]).some(l => { const w = l.text.replace(/\s/g, ''); return w.startsWith('令和') && DIRECT_TITLES.some(t => w.endsWith(t.title)); });
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_MANIFEST, 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: Doc[] };
  if (raw.frozenInput.corpusDigestSha256 !== FROZEN_DIGEST) throw new Error('raw text corpus digest mismatch');
  const phaseA = JSON.parse(fs.readFileSync(PHASE_A, 'utf8')) as { pages: { localPdfPath: string; physicalPage: number; isolationCategory: string }[] };
  const emptyKind = new Map(phaseA.pages.map(p => [`${p.localPdfPath}#${p.physicalPage}`, p.isolationCategory === 'VISUALLY_BLANK' ? 'VISUALLY_BLANK' : 'RASTER'] as const));
  const v0c = JSON.parse(fs.readFileSync(V0_CAND, 'utf8')) as { publisherAssignment: Record<string, string>; parameters: { seed: string } };
  const v0gt = JSON.parse(fs.readFileSync(V0_GT, 'utf8')) as { rows: { localPdfPath: string; physicalPage: number }[] };
  const v0Keys = new Set(v0gt.rows.map(r => `${r.localPdfPath}#${r.physicalPage}`));
  if (v0Keys.size !== 172) throw new Error('v0 GT keys != 172');
  const frozenDomains = new Set(Object.entries(v0c.publisherAssignment).filter(([, v]) => v === 'FROZEN_EVALUATION').map(([k]) => k));

  // 1. 全 page の machine observation（state 機械は v0 の frozen rule）
  const pagesByDoc = new Map<string, PageObs[]>();
  let textHashMismatch = 0;
  for (const d of raw.documents) {
    const infos: Omit<PageObs, 'activeStateFamily' | 'distance' | 'r2' | 'r4' | 'r5' | 'r7'>[] = [];
    if (d.status === 'EMPTY') {
      d.pageTextSha256.forEach((h, i) => infos.push({ page: i + 1, rawStatus: 'EMPTY', textSha256: h, direct: { kind: 'NONE' }, titleInLines6to20: false, emptyKind: 'UNRESOLVED_EMPTY' }));
    } else {
      const lines = fs.readFileSync(path.join(PAGES_DIR, d.artifactPath), 'utf8').split('\n').filter(l => l);
      if (lines.length !== d.pageCount) throw new Error(`page record count mismatch: ${d.localPdfPath}`);
      lines.forEach((l, i) => {
        const r = JSON.parse(l) as { page: number; text: string; textSha256: string; status: RawStatus; nonEmptyLines: { text: string }[] };
        if (r.page !== i + 1 || r.textSha256 !== d.pageTextSha256[i] || sha256Hex(r.text) !== r.textSha256) textHashMismatch++;
        const ek = r.status === 'EMPTY' ? (emptyKind.get(`${d.localPdfPath}#${r.page}`) ?? 'UNRESOLVED_EMPTY') : 'NONE';
        const dm = r.status === 'EXTRACTED' ? directMatch(r.nonEmptyLines) : ({ kind: 'NONE' } as DirectResult);
        infos.push({ page: r.page, rawStatus: r.status, textSha256: r.textSha256, direct: dm, titleInLines6to20: r.status === 'EXTRACTED' && dm.kind === 'NONE' && titleInWindow(r.nonEmptyLines), emptyKind: ek });
      });
    }
    // state machine（v0 preregistration §5）
    let state: DirectFamily | null = null;
    let dist = 0;
    let postReset = false;
    let blankSinceText = false;
    let sawText = false;
    const out: PageObs[] = infos.map(p => ({ ...p, activeStateFamily: null, distance: null, r2: false, r4: false, r5: false, r7: false }));
    out.forEach(p => {
      if (p.rawStatus === 'EMPTY') {
        if (p.emptyKind === 'VISUALLY_BLANK') { blankSinceText = true; return; }
        state = null; dist = 0; postReset = true; blankSinceText = false; return;
      }
      if (!sawText) { p.r7 = p.direct.kind === 'NONE'; sawText = true; }
      p.r5 = postReset; postReset = false;
      if (p.direct.kind === 'DIRECT') { state = INHERITABLE.includes(p.direct.family) ? p.direct.family : null; dist = 0; }
      else if (p.direct.kind === 'CONFLICT') { state = null; dist = 0; postReset = true; }
      else if (state) { dist++; p.activeStateFamily = state; p.distance = dist; }
      p.r4 = blankSinceText && p.direct.kind === 'NONE' && state !== null; // blank 前に active state があり、blank 後最初の TEXT page が NONE
      blankSinceText = false;
    });
    // R2: P(NONE, active state) の次の TEXT page Q（VISUALLY_BLANK は skip、その他の EMPTY で打ち切り）が DIRECT かつ family != state
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      if (p.rawStatus !== 'EXTRACTED' || p.direct.kind !== 'NONE' || !p.activeStateFamily) continue;
      for (let j = i + 1; j < out.length; j++) {
        const q = out[j];
        if (q.rawStatus === 'EMPTY') { if (q.emptyKind === 'VISUALLY_BLANK') continue; break; }
        if (q.direct.kind === 'DIRECT' && q.direct.family !== p.activeStateFamily) p.r2 = true;
        break;
      }
    }
    pagesByDoc.set(d.localPdfPath, out);
  }
  if (textHashMismatch) throw new Error(`text hash mismatch: ${textHashMismatch}`);

  const all = raw.documents.flatMap(d => pagesByDoc.get(d.localPdfPath)!.map(p => ({ d, p })));
  const textObservable = all.filter(x => x.p.rawStatus === 'EXTRACTED');
  if (all.length !== 9899 || textObservable.length !== 8968) throw new Error(`population mismatch ${all.length}/${textObservable.length}`);
  const pool = textObservable.filter(x => frozenDomains.has(x.d.publisherDomain) && !v0Keys.has(`${x.d.localPdfPath}#${x.p.page}`));
  const frozenTextObservable = textObservable.filter(x => frozenDomains.has(x.d.publisherDomain)).length;

  type Item = (typeof pool)[number];
  const keyOf = (x: Item) => `${x.d.localPdfPath}#${x.p.page}`;
  const byHash = (tag: string, list: Item[]) => [...list].sort((a, b) => cmp(hashKey(tag, a.d.localPdfPath, a.p.page), hashKey(tag, b.d.localPdfPath, b.p.page)));
  const rows = new Map<string, { x: Item; strata: string[]; detail: Record<string, unknown> }>();
  const add = (x: Item, stratum: string, detail: Record<string, unknown>) => {
    let r = rows.get(keyOf(x));
    if (!r) { r = { x, strata: [], detail: {} }; rows.set(keyOf(x), r); }
    r.strata.push(stratum); r.detail[stratum] = detail;
  };
  const poolSizes: Record<string, number> = {};

  // A. DIRECT_BALANCED
  for (const { family } of DIRECT_TITLES) {
    const c = pool.filter(x => x.p.direct.kind === 'DIRECT' && x.p.direct.family === family);
    poolSizes[`DIRECT_BALANCED|${family}`] = c.length;
    for (const x of byHash(`DIRECT_BALANCED/${family}`, c).slice(0, A_PER_FAMILY)) add(x, 'DIRECT_BALANCED', { family });
  }
  // B. CONTINUATION_BALANCED
  for (const family of INHERITABLE) for (const b of ['d1', 'd2', 'd3-5', 'd6+']) {
    const c = pool.filter(x => x.p.direct.kind === 'NONE' && x.p.activeStateFamily === family && bucketOf(x.p.distance!) === b);
    poolSizes[`CONTINUATION_BALANCED|${family}|${b}`] = c.length;
    for (const x of byHash(`CONTINUATION_BALANCED/${family}/${b}`, c).slice(0, B_PER_BUCKET)) add(x, 'CONTINUATION_BALANCED', { activeStateFamily: family, distanceBucket: b });
  }
  // R1〜R7（domain cap → 全体 hash 順 → 先頭 24）
  const riskCond: Record<string, (x: Item) => boolean> = {
    R1_NO_ACTIVE_STATE: x => x.p.direct.kind === 'NONE' && x.p.activeStateFamily === null,
    R2_PRE_DIRECT_TRANSITION: x => x.p.r2,
    R3_LONG_INHERITANCE_TAIL: x => x.p.direct.kind === 'NONE' && x.p.activeStateFamily !== null && (x.p.distance ?? 0) >= R3_MIN_DISTANCE,
    R4_POST_BLANK_BRIDGE: x => x.p.r4,
    R5_POST_RESET: x => x.p.r5,
    R6_TITLE_OUTSIDE_DIRECT_WINDOW: x => x.p.titleInLines6to20,
    R7_PDF_START_WITHOUT_DIRECT: x => x.p.r7,
  };
  for (const [stratum, cond] of Object.entries(riskCond)) {
    let c = pool.filter(cond);
    poolSizes[stratum] = c.length;
    if (stratum === 'R3_LONG_INHERITANCE_TAIL') c = [...new Set(INHERITABLE.flatMap(f => byHash(stratum, c.filter(x => x.p.activeStateFamily === f)).slice(0, R3_PER_FAMILY)))];
    const perDomain = new Map<string, Item[]>();
    for (const x of byHash(stratum, c)) { const l = perDomain.get(x.d.publisherDomain) ?? []; if (l.length < R_PER_DOMAIN) { l.push(x); perDomain.set(x.d.publisherDomain, l); } }
    for (const x of byHash(stratum, [...perDomain.values()].flat()).slice(0, R_CAP)) add(x, stratum, { activeStateFamily: x.p.activeStateFamily, distance: x.p.distance });
  }
  // C. CORPUS_RANDOM_V1
  const rest = pool.filter(x => !rows.has(keyOf(x)));
  poolSizes.CORPUS_RANDOM_V1 = rest.length;
  for (const x of byHash('CORPUS_RANDOM_V1', rest).slice(0, RANDOM_PAGES)) add(x, 'CORPUS_RANDOM_V1', {});

  const list = [...rows.values()].map(({ x, strata, detail }) => ({
    localPdfPath: x.d.localPdfPath, pdfSha256: x.d.pdfSha256, physicalPage: x.p.page, textSha256: x.p.textSha256,
    publisherDomain: x.d.publisherDomain, logicalDocumentIndex: x.d.logicalDocumentIndex,
    evaluationRole: 'FROZEN_EVALUATION_V1' as const,
    strata: [...strata].sort(), strataDetail: detail,
    samplingObservation: { directResult: x.p.direct, activeStateFamily: x.p.activeStateFamily, distanceInTextObservablePages: x.p.distance },
  })).sort((a, b) => cmp(a.localPdfPath, b.localPdfPath) || a.physicalPage - b.physicalPage);
  const tally = (f: (r: (typeof list)[number]) => string[]) => { const o: Record<string, number> = {}; for (const r of list) for (const k of f(r)) o[k] = (o[k] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b))); };
  const out = {
    schema: 'budget-request-page-classification-v1-eval-candidates/v0',
    scope: 'v1 evaluation design の GT candidate 凍結。label 未付与。classifier は未実装。v0 classifier specification は変更しない',
    generator: 'scripts/pipeline-v2/build-budget-request-page-classification-v1-eval-candidates.ts',
    frozenInput: {
      rawTextCorpusDigestSha256: FROZEN_DIGEST,
      v0CandidateFixtureSha256: sha256Hex(fs.readFileSync(V0_CAND)),
      v0VisualGtFixtureSha256: sha256Hex(fs.readFileSync(V0_GT)),
      phaseAFixtureSha256: sha256Hex(fs.readFileSync(PHASE_A)),
    },
    parameters: { seed: V1_SEED, hashRule: 'sha256("{seed}|{stratum}|{localPdfPath}|{physicalPage}") 昇順', aPerFamily: A_PER_FAMILY, bPerBucket: B_PER_BUCKET, riskCap: R_CAP, riskPerDomain: R_PER_DOMAIN, r3MinDistance: R3_MIN_DISTANCE, r3PerFamily: R3_PER_FAMILY, randomPages: RANDOM_PAGES, titleSearchLines: TITLE_SEARCH_LINES },
    publisherAssignmentSource: 'v0 candidate fixture の publisherAssignment をそのまま再利用',
    frozenPublishers: [...frozenDomains].sort(),
    population: { physicalPages: all.length, textObservable: textObservable.length, frozenTextObservable, v0GtExcluded: v0Keys.size, frozenPoolAfterV0Exclusion: pool.length },
    poolSizes,
    summary: {
      rows: list.length, duplicateKeys: 0, textHashMismatch, v0GtOverlap: list.filter(r => v0Keys.has(`${r.localPdfPath}#${r.physicalPage}`)).length,
      byStratum: tally(r => r.strata),
      byPublisher: tally(r => [r.publisherDomain]),
    },
    rows: list,
  };
  if (FREEZE) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`); }
  console.log(JSON.stringify({ population: out.population, poolSizes, summary: out.summary }, null, 1));
}
main();
