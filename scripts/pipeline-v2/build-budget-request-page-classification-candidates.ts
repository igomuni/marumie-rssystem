/**
 * Page Classification v0 の GT candidate を、preregistration の凍結ルールだけから決定的に生成する。label は見ない・付けない。
 * 入力: PR-1 frozen fixture（digest・page text hash 検証）、Phase A fixture、data/work の Raw Text pages（git 管理外。fixture の text hash で検証）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-page-classification-candidates.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-page-classification/2024/page-classification-v0-candidates.json（--freeze-fixture のときだけ）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { DIRECT_TITLES, INHERITABLE, directMatch, type DirectFamily } from './lib/budget-request-page-classification-direct';

const SEED = 'budget-request-page-classification-v0-20261007';
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PHASE_A = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'empty-page-failure-isolation.json');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-candidates.json');
const FREEZE = process.argv.includes('--freeze-fixture');
const FROZEN_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';

const PER_DIRECT_FAMILY = 12;
const PER_DISTANCE_BUCKET = 3;
const RANDOM_PAGES = 64;
const DEV_PERCENT = 70;

type RawStatus = 'EXTRACTED' | 'EMPTY';
interface Doc { localPdfPath: string; pdfSha256: string; publisherDomain: string; logicalDocumentIndex: number; pageCount: number; status: string; artifactPath: string; pageTextSha256: string[] }
interface PageInfo { page: number; textSha256: string; rawStatus: RawStatus; direct: ReturnType<typeof directMatch> }
interface Row {
  localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; publisherDomain: string; logicalDocumentIndex: number;
  strata: string[]; strataDetail: Record<string, unknown>; evaluationRole: 'DEVELOPMENT' | 'FROZEN_EVALUATION';
}

const hashKey = (tag: string, p: string, page: number) => sha256Hex(`${SEED}|${tag}|${p}|${page}`);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bucketOf = (d: number) => (d === 1 ? 'd1' : d === 2 ? 'd2' : d <= 5 ? 'd3-5' : 'd6+');

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_MANIFEST, 'utf8')) as { frozenInput: { corpusDigestSha256: string; physicalPages: number }; documents: Doc[] };
  if (raw.frozenInput.corpusDigestSha256 !== FROZEN_DIGEST) throw new Error('raw text corpus digest mismatch');
  const phaseA = JSON.parse(fs.readFileSync(PHASE_A, 'utf8')) as { frozenInput: { targetPages: number }; summary: { physicalPdfs: number; logicalDocuments: number; byCategory: Record<string, number>; unresolved: number }; pages: { localPdfPath: string; physicalPage: number; isolationCategory: string }[] };
  const s = phaseA.summary;
  if (phaseA.frozenInput.targetPages !== 117 || s.physicalPdfs !== 47 || s.logicalDocuments !== 46 || s.byCategory.VISUALLY_BLANK !== 116 || s.byCategory.RASTER_OR_IMAGE_DOMINANT !== 1 || s.unresolved !== 0) throw new Error('Phase A fixture mismatch');
  const blank = new Set(phaseA.pages.filter(p => p.isolationCategory === 'VISUALLY_BLANK').map(p => `${p.localPdfPath}#${p.physicalPage}`));

  // 全 physical page を読み、text hash を frozen manifest と照合する
  const pagesByDoc = new Map<string, PageInfo[]>();
  let textHashMismatch = 0;
  for (const d of raw.documents) {
    const infos: PageInfo[] = [];
    if (d.status === 'EMPTY') {
      d.pageTextSha256.forEach((h, i) => infos.push({ page: i + 1, textSha256: h, rawStatus: 'EMPTY', direct: { kind: 'NONE' } }));
    } else {
      const lines = fs.readFileSync(path.join(PAGES_DIR, d.artifactPath), 'utf8').split('\n').filter(l => l);
      if (lines.length !== d.pageCount) throw new Error(`page record count mismatch: ${d.localPdfPath}`);
      lines.forEach((l, i) => {
        const r = JSON.parse(l) as { page: number; textSha256: string; status: RawStatus; nonEmptyLines: { text: string }[] };
        if (r.page !== i + 1 || r.textSha256 !== d.pageTextSha256[i] || sha256Hex(JSON.parse(l).text) !== r.textSha256) textHashMismatch++;
        infos.push({ page: r.page, textSha256: r.textSha256, rawStatus: r.status, direct: r.status === 'EXTRACTED' ? directMatch(r.nonEmptyLines) : { kind: 'NONE' } });
      });
    }
    pagesByDoc.set(d.localPdfPath, infos);
  }
  if (textHashMismatch) throw new Error(`text hash mismatch: ${textHashMismatch}`);
  const all = raw.documents.flatMap(d => pagesByDoc.get(d.localPdfPath)!.map(p => ({ d, p })));
  const textObservable = all.filter(x => x.p.rawStatus === 'EXTRACTED');
  if (all.length !== 9899 || textObservable.length !== 8968) throw new Error(`population mismatch ${all.length}/${textObservable.length}`);

  const splitOf = (domain: string) => (parseInt(sha256Hex(`${SEED}|split|${domain}`).slice(0, 8), 16) % 100 < DEV_PERCENT ? 'DEVELOPMENT' : 'FROZEN_EVALUATION') as Row['evaluationRole'];
  const rows = new Map<string, Row>();
  const add = (d: Doc, page: number, stratum: string, detail: Record<string, unknown>) => {
    const key = `${d.localPdfPath}#${page}`;
    let r = rows.get(key);
    if (!r) {
      r = { localPdfPath: d.localPdfPath, pdfSha256: d.pdfSha256, physicalPage: page, textSha256: d.pageTextSha256[page - 1], publisherDomain: d.publisherDomain, logicalDocumentIndex: d.logicalDocumentIndex, strata: [], strataDetail: {}, evaluationRole: splitOf(d.publisherDomain) };
      rows.set(key, r);
    }
    r.strata.push(stratum);
    r.strataDetail[stratum] = detail;
  };

  // A. DIRECT candidates
  const directPages = all.filter(x => x.p.direct.kind === 'DIRECT') as { d: Doc; p: PageInfo & { direct: { kind: 'DIRECT'; family: DirectFamily } } }[];
  const directCount: Record<string, number> = {};
  for (const { family } of DIRECT_TITLES) {
    const c = directPages.filter(x => x.p.direct.family === family).sort((a, b) => cmp(hashKey(`A-${family}`, a.d.localPdfPath, a.p.page), hashKey(`A-${family}`, b.d.localPdfPath, b.p.page)));
    directCount[family] = c.length;
    for (const x of c.slice(0, PER_DIRECT_FAMILY)) add(x.d, x.p.page, 'DIRECT', { family });
  }

  // B. CONTINUATION candidates: INHERITED rule が state を与えるはずの page を、direct start からの距離で bucket 化して sample
  const contCandidates: Record<string, { d: Doc; page: number; start: number; dist: number }[]> = {};
  for (const d of raw.documents) {
    const infos = pagesByDoc.get(d.localPdfPath)!;
    for (const start of infos) {
      if (start.direct.kind !== 'DIRECT' || !INHERITABLE.includes(start.direct.family)) continue;
      const family = start.direct.family;
      let dist = 0;
      for (let i = start.page; i < infos.length; i++) {
        const q = infos[i];
        if (q.rawStatus === 'EMPTY') { if (blank.has(`${d.localPdfPath}#${q.page}`)) continue; break; }
        if (q.direct.kind !== 'NONE') break;
        dist++;
        (contCandidates[`${family}|${bucketOf(dist)}`] ??= []).push({ d, page: q.page, start: start.page, dist });
      }
    }
  }
  const contCount: Record<string, number> = {};
  for (const [k, list] of Object.entries(contCandidates).sort(([a], [b]) => cmp(a, b))) {
    contCount[k] = list.length;
    const sorted = [...list].sort((a, b) => cmp(hashKey(`B-${k}`, a.d.localPdfPath, a.page), hashKey(`B-${k}`, b.d.localPdfPath, b.page)));
    for (const x of sorted.slice(0, PER_DISTANCE_BUCKET)) add(x.d, x.page, 'CONTINUATION', { stateFamily: k.split('|')[0], distanceBucket: k.split('|')[1], directStartPage: x.start, distanceInTextObservablePages: x.dist });
  }

  // C. CORPUS_RANDOM: A/B に含まれない TEXT_OBSERVABLE page
  const pool = textObservable.filter(x => !rows.has(`${x.d.localPdfPath}#${x.p.page}`)).sort((a, b) => cmp(hashKey('C', a.d.localPdfPath, a.p.page), hashKey('C', b.d.localPdfPath, b.p.page)));
  for (const x of pool.slice(0, RANDOM_PAGES)) add(x.d, x.p.page, 'CORPUS_RANDOM', {});

  const list = [...rows.values()].sort((a, b) => cmp(a.localPdfPath, b.localPdfPath) || a.physicalPage - b.physicalPage);
  if (list.length !== rows.size) throw new Error('duplicate key');
  const roleOf = (r: string) => list.filter(x => x.evaluationRole === r);
  const domainsBy = (r: string) => new Set(roleOf(r).map(x => x.publisherDomain));
  const overlap = [...domainsBy('DEVELOPMENT')].filter(x => domainsBy('FROZEN_EVALUATION').has(x));
  const tally = (f: (r: Row) => string[]) => { const o: Record<string, number> = {}; for (const r of list) for (const k of f(r)) o[k] = (o[k] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b))); };
  const publisherAssignment = Object.fromEntries([...new Set(raw.documents.map(d => d.publisherDomain))].sort().map(x => [x, splitOf(x)]));
  const out = {
    schema: 'budget-request-page-classification-v0-candidates/v0',
    scope: 'GT candidate の凍結。label は未付与。classifier は未実装',
    generator: 'scripts/pipeline-v2/build-budget-request-page-classification-candidates.ts',
    frozenInput: { rawTextCorpusDigestSha256: FROZEN_DIGEST, phaseAFixture: PHASE_A, phaseAFixtureSha256: sha256Hex(fs.readFileSync(PHASE_A)) },
    parameters: { seed: SEED, directWindow: 5, perDirectFamily: PER_DIRECT_FAMILY, perDistanceBucket: PER_DISTANCE_BUCKET, randomPages: RANDOM_PAGES, devPercent: DEV_PERCENT, hashRule: 'sha256("{seed}|{tag}|{localPdfPath}|{physicalPage}") 昇順' },
    population: { physicalPages: all.length, textObservable: textObservable.length, rawTextEmpty: all.length - textObservable.length, phaseAVisuallyBlank: blank.size, phaseAVisibleContentEmpty: 1, fullyEmptyUnresolved: raw.documents.filter(d => d.status === 'EMPTY').reduce((n, d) => n + d.pageCount, 0) },
    directCandidatePool: { ...directCount, conflictPages: all.filter(x => x.p.direct.kind === 'CONFLICT').length },
    continuationCandidatePool: contCount,
    summary: {
      rows: list.length, byStratum: tally(r => r.strata), duplicateKeys: 0,
      byRole: { DEVELOPMENT: roleOf('DEVELOPMENT').length, FROZEN_EVALUATION: roleOf('FROZEN_EVALUATION').length },
      publisherOverlap: overlap.length, textHashMismatch,
      directByFamilyAndRole: tally(r => r.strata.includes('DIRECT') ? [`${(r.strataDetail.DIRECT as { family: string }).family}|${r.evaluationRole}`] : []),
      continuationByFamilyAndRole: tally(r => r.strata.includes('CONTINUATION') ? [`${(r.strataDetail.CONTINUATION as { stateFamily: string }).stateFamily}|${r.evaluationRole}`] : []),
    },
    publisherAssignment,
    rows: list,
  };
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`); }
  console.log(JSON.stringify({ population: out.population, directCandidatePool: out.directCandidatePool, continuationCandidatePool: out.continuationCandidatePool, summary: out.summary }, null, 1));
}
main();
