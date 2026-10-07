/**
 * FY2024 概算要求 Page Classification v0 を frozen Raw Text corpus 全 9,899 page に適用する builder（frozen v0 specification の literal implementation）。
 * rule の追加・変更なし。GT（v0/v1/v2/v3）は読まない。入力: Raw Text manifest・data/work の Raw Text pages・Phase A EMPTY isolation fixture。
 * 加えて conformance として、v0/v1/v2 の candidate fixture に freeze 済みの machine observation（directResult / activeStateFamily）と実装出力を照合する（GT は読まない）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-page-classification.ts [--freeze-fixture]
 * 出力: data/work/budget-request-page-classification/2024/page-classification.jsonl（git 管理外）
 *       tests/fixtures/budget-request-page-classification/2024/page-classification-v0-implementation-manifest.json（--freeze-fixture のときだけ）
 *       tests/fixtures/budget-request-page-classification/2024/page-classification-v0-implementation-representative.json（同上）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { CLASSIFIER_SPEC_VERSION, classifyDocument, documentDigest, recordLine, verifyHashes, type ClassifierPageInput, type EmptyKind, type PageClassificationRecord } from './lib/budget-request-page-classification';

const FREEZE = process.argv.includes('--freeze-fixture');
const DIR = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PHASE_A = path.join(DIR, 'empty-page-failure-isolation.json');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024');
const WORK_OUT = path.join('data', 'work', 'budget-request-page-classification', '2024', 'page-classification.jsonl');
const MANIFEST_OUT = path.join(DIR, 'page-classification-v0-implementation-manifest.json');
const REP_OUT = path.join(DIR, 'page-classification-v0-implementation-representative.json');
const FROZEN_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const IMPL_FILES = ['scripts/pipeline-v2/lib/budget-request-page-classification.ts', 'scripts/pipeline-v2/lib/budget-request-page-classification-direct.ts', 'scripts/pipeline-v2/build-budget-request-page-classification.ts'];
const CANDIDATES = { v0: 'page-classification-v0-candidates.json', v1: 'page-classification-v1-eval-candidates.json', v2: 'page-classification-v2-candidates.json' } as const;

interface Doc { localPdfPath: string; pdfSha256: string; pageCount: number; status: string; artifactPath: string; pageTextSha256: string[] }
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const count = (rs: PageClassificationRecord[], f: (r: PageClassificationRecord) => string) => { const o: Record<string, number> = {}; for (const r of rs) o[f(r)] = (o[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };

function main() {
  const raw = readJson<{ frozenInput: { corpusDigestSha256: string }; documents: Doc[] }>(RAW_MANIFEST);
  if (raw.frozenInput.corpusDigestSha256 !== FROZEN_DIGEST) throw new Error('raw text corpus digest mismatch');
  const phaseA = readJson<{ pages: { localPdfPath: string; physicalPage: number; isolationCategory: string }[] }>(PHASE_A);
  const emptyKind = new Map(phaseA.pages.map(p => [`${p.localPdfPath}#${p.physicalPage}`, (p.isolationCategory === 'VISUALLY_BLANK' ? 'VISUALLY_BLANK' : 'RASTER') as EmptyKind]));

  const all: PageClassificationRecord[] = [];
  const perPdf: { localPdfPath: string; pageCount: number; classificationDigestSha256: string }[] = [];
  for (const d of raw.documents) {
    if (sha256Hex(fs.readFileSync(d.localPdfPath)) !== d.pdfSha256) throw new Error(`source pdf hash mismatch: ${d.localPdfPath}`);
    let pages: ClassifierPageInput[];
    if (d.status === 'EMPTY') {
      pages = d.pageTextSha256.map((h, i) => ({ physicalPage: i + 1, rawStatus: 'EMPTY' as const, textSha256: h, nonEmptyLines: [], emptyKind: 'UNRESOLVED_EMPTY' as const }));
    } else {
      const lines = fs.readFileSync(path.join(PAGES_DIR, d.artifactPath), 'utf8').split('\n').filter(l => l);
      const recs = lines.map(l => JSON.parse(l) as { page: number; text: string; textSha256: string; status: 'EXTRACTED' | 'EMPTY'; nonEmptyLines: { text: string }[] });
      verifyHashes(d.localPdfPath, { expectedPdfSha256: d.pdfSha256, actualPdfSha256: d.pdfSha256, expectedPageTextSha256: d.pageTextSha256, actualPageTextSha256: recs.map(r => sha256Hex(r.text)) });
      pages = recs.map(r => ({ physicalPage: r.page, rawStatus: r.status, textSha256: r.textSha256, nonEmptyLines: r.nonEmptyLines, emptyKind: r.status === 'EMPTY' ? (emptyKind.get(`${d.localPdfPath}#${r.page}`) ?? 'UNRESOLVED_EMPTY') : 'NONE' }));
    }
    const rs = classifyDocument(d.localPdfPath, d.pdfSha256, pages, d.pageCount);
    all.push(...rs);
    perPdf.push({ localPdfPath: d.localPdfPath, pageCount: d.pageCount, classificationDigestSha256: documentDigest(rs) });
  }
  const keys = new Set(all.map(r => `${r.localPdfPath}#${r.physicalPage}`));
  if (all.length !== 9899 || keys.size !== all.length) throw new Error(`page loss/duplicate: ${all.length}/${keys.size}`);

  // conformance: frozen candidate fixture の machine observation と一致（GT は読まない）
  const byKey = new Map(all.map(r => [`${r.localPdfPath}#${r.physicalPage}`, r]));
  const conformance: Record<string, { directChecked: number; directMismatch: number; stateChecked: number; stateMismatch: number }> = {};
  for (const [v, f] of Object.entries(CANDIDATES)) {
    const rows = readJson<{ rows: { localPdfPath: string; physicalPage: number; strata: string[]; strataDetail?: Record<string, Record<string, unknown>>; samplingObservation?: { directResult?: unknown; activeStateFamily?: string | null } }[] }>(path.join(DIR, f)).rows;
    const c = { directChecked: 0, directMismatch: 0, stateChecked: 0, stateMismatch: 0 };
    for (const r of rows) {
      const rec = byKey.get(`${r.localPdfPath}#${r.physicalPage}`);
      if (!rec) throw new Error(`candidate page missing from classification: ${r.localPdfPath}#${r.physicalPage}`);
      // frozen observation の取り出し（v0: strataDetail、v1: directResult object、v2: string）
      let direct: string | null | undefined;
      let state: string | null | undefined;
      if (v === 'v0') { direct = r.strata.includes('DIRECT') ? (r.strataDetail?.DIRECT?.family as string) : undefined; state = r.strata.includes('CONTINUATION') ? (r.strataDetail?.CONTINUATION?.stateFamily as string) : undefined; }
      else { const d = r.samplingObservation?.directResult; direct = d === undefined || d === null ? undefined : typeof d === 'string' ? (d === 'NONE' || d === 'CONFLICT' ? undefined : d) : (d as { kind?: string; family?: string }).kind === 'DIRECT' ? (d as { family: string }).family : undefined; state = r.samplingObservation?.activeStateFamily ?? undefined; }
      if (direct !== undefined) { c.directChecked++; if (!(rec.classification.source === 'DIRECT' && rec.classification.pageType === direct)) c.directMismatch++; }
      if (state !== undefined) { c.stateChecked++; if (!(rec.classification.source === 'INHERITED' && rec.classification.pageType === state && rec.stateObservation.activeFamilyBefore === state)) c.stateMismatch++; }
    }
    conformance[v] = c;
  }
  const mismatches = Object.values(conformance).reduce((n, c) => n + c.directMismatch + c.stateMismatch, 0);

  fs.mkdirSync(path.dirname(WORK_OUT), { recursive: true });
  const body = all.map(recordLine).join('\n') + '\n';
  fs.writeFileSync(WORK_OUT, body);
  const manifest = {
    schema: 'budget-request-page-classification-v0-implementation-manifest/v0',
    scope: 'frozen v0 specification の literal implementation の full-corpus 出力 manifest。rule 変更・GT 由来の調整なし。open-set safety は NOT EVALUATED',
    specVersion: CLASSIFIER_SPEC_VERSION,
    frozenInput: { rawTextCorpusDigestSha256: FROZEN_DIGEST, phaseAFixtureSha256: sha256Hex(fs.readFileSync(PHASE_A)) },
    implementation: { files: Object.fromEntries(IMPL_FILES.map(f => [f, sha256Hex(fs.readFileSync(f))])), node: process.version, platform: `${process.platform}-${process.arch}` },
    summary: {
      totalPages: all.length,
      rawStatus: count(all, r => r.rawText.status),
      classificationStatus: count(all, r => r.classification.status),
      pageType: count(all, r => String(r.classification.pageType)),
      source: count(all, r => String(r.classification.source)),
      unresolvedReason: count(all.filter(r => r.classification.status === 'UNRESOLVED'), r => String(r.classification.reason).replace(/:.*/, '')),
      noTextReason: count(all.filter(r => r.classification.status === 'NO_TEXT'), r => String(r.classification.reason)),
      resetCounts: count(all.filter(r => r.stateObservation.resetReason), r => String(r.stateObservation.resetReason)),
      bridgedBlankPages: all.filter(r => r.classification.reason === 'NO_TEXT_VISUALLY_BLANK' && r.stateObservation.activeFamilyBefore !== null).length,
      pageLossOrDuplicate: 0,
      corpusClassificationDigestSha256: sha256Hex(body),
    },
    conformance: { ...conformance, totalMismatch: mismatches },
    perPdf,
  };
  if (mismatches !== 0) { console.log(JSON.stringify({ conformance, mismatches })); throw new Error(`conformance mismatch: ${mismatches}`); }
  if (FREEZE) {
    fs.writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 1)}\n`);
    // representative: 各 (status, pageType, source) の組から hash 順で先頭 2 page（内容の良し悪しでは選ばない）
    const groups = new Map<string, PageClassificationRecord[]>();
    for (const r of all) { const k = `${r.classification.status}|${r.classification.pageType}|${r.classification.source}|${r.classification.reason?.replace(/:.*/, '') ?? ''}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    const reps = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([k, rs]) => rs.sort((a, b) => { const ha = sha256Hex(`rep|${a.localPdfPath}|${a.physicalPage}`); const hb = sha256Hex(`rep|${b.localPdfPath}|${b.physicalPage}`); return ha < hb ? -1 : 1; }).slice(0, 2).map(r => ({ group: k, ...r })));
    fs.writeFileSync(REP_OUT, `${JSON.stringify({ schema: 'budget-request-page-classification-v0-implementation-representative/v0', records: reps }, null, 1)}\n`);
  }
  console.log(JSON.stringify({ summary: manifest.summary, conformance: manifest.conformance }, null, 1));
}
main();
