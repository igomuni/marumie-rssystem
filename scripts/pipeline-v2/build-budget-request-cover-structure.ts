/**
 * Cover Structure v0 parser を Page Classification v0 が COVER と routing した全 page に適用する builder。parser は lib/budget-request-cover-structure.ts のみ。
 * GT・development fixture は読まない。入力: Raw Text manifest・data/work の Raw Text pages・Page Classification 出力。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-cover-structure.ts [--freeze-fixture]
 * 出力: data/work/budget-request-cover-structure/2024/cover-observations.jsonl（git 管理外）
 *       tests/fixtures/budget-request-cover-structure/2024/implementation-manifest.json（--freeze-fixture のとき）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { parseCoverPage, type CoverObservation } from './lib/budget-request-cover-structure';
import type { PageClassificationRecord } from './lib/budget-request-page-classification';

const FREEZE = process.argv.includes('--freeze-fixture');
const WORK = path.join('data', 'work', 'budget-request-cover-structure', '2024', 'cover-observations.jsonl');
const OUT = path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024', 'implementation-manifest.json');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const CLS = path.join('data', 'work', 'budget-request-page-classification', '2024', 'page-classification.jsonl');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024');
const RAW_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const CLS_DIGEST = '39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc';
const IMPL = ['scripts/pipeline-v2/lib/budget-request-cover-structure.ts', 'scripts/pipeline-v2/build-budget-request-cover-structure.ts'];

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_MANIFEST, 'utf8')) as { frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; artifactPath: string; pageTextSha256: string[] }[] };
  if (raw.frozenInput.corpusDigestSha256 !== RAW_DIGEST) throw new Error('raw text digest mismatch');
  const clsBody = fs.readFileSync(CLS, 'utf8');
  if (sha256Hex(clsBody) !== CLS_DIGEST) throw new Error('classification digest mismatch');
  const covers = clsBody.split('\n').filter(l => l).map(l => JSON.parse(l) as PageClassificationRecord).filter(r => r.classification.pageType === 'COVER');
  if (covers.length !== 69) throw new Error(`COVER population ${covers.length} != 69`);
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  const cache = new Map<string, { page: number; text: string; textSha256: string; nonEmptyLines: { text: string }[] }[]>();
  const obs: CoverObservation[] = [];
  let provenanceMismatch = 0;
  for (const c of covers) {
    const d = docs.get(c.localPdfPath)!;
    let pages = cache.get(c.localPdfPath);
    if (!pages) { pages = fs.readFileSync(path.join(PAGES_DIR, d.artifactPath), 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l)); cache.set(c.localPdfPath, pages); }
    const p = pages[c.physicalPage - 1];
    if (p.page !== c.physicalPage || p.textSha256 !== c.rawText.textSha256 || p.textSha256 !== d.pageTextSha256[c.physicalPage - 1] || d.pdfSha256 !== c.pdfSha256) provenanceMismatch++;
    obs.push(parseCoverPage({ filePath: c.localPdfPath, fileSha256: c.pdfSha256, physicalPage: c.physicalPage, textSha256: p.textSha256 }, p.nonEmptyLines));
  }
  if (provenanceMismatch) throw new Error(`provenance mismatch ${provenanceMismatch}`);
  const body = obs.map(o => JSON.stringify(o)).join('\n') + '\n';
  fs.mkdirSync(path.dirname(WORK), { recursive: true });
  fs.writeFileSync(WORK, body);
  const count = (f: (o: CoverObservation) => string) => { const m: Record<string, number> = {}; for (const o of obs) m[f(o)] = (m[f(o)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1))); };
  const manifest = {
    schema: 'budget-request-cover-structure-implementation-manifest/v0',
    scope: 'Cover Structure v0 parser の全 COVER page への適用結果 manifest。development / descriptive のみ（formal validation・held-out ではない）',
    frozenInput: { rawTextCorpusDigestSha256: RAW_DIGEST, pageClassificationCorpusDigestSha256: CLS_DIGEST },
    implementation: { files: Object.fromEntries(IMPL.map(f => [f, sha256Hex(fs.readFileSync(f))])), node: process.version },
    summary: {
      coverPages: obs.length, provenanceMismatch, parserErrors: 0,
      status: count(o => o.status), headerStatus: count(o => o.header.status),
      entryKindSequence: count(o => o.entries.map(e => (e.kind === 'SECTION_REFERENCE' ? 'S' : 'C')).join('')),
      multilineScopeNamePages: obs.filter(o => o.entries.some(e => e.kind === 'SCOPE_REFERENCE' && e.nameRawParts.length > 1)).length,
      pagesWithUnclassifiedLines: obs.filter(o => o.unclassifiedLines.length > 0).length,
      outputDigestSha256: sha256Hex(body),
    },
    partialOrUnresolved: obs.filter(o => o.status !== 'RESOLVED').map(o => ({ filePath: o.source.filePath, physicalPage: o.source.physicalPage, status: o.status, headerStatus: o.header.status, unclassifiedLines: o.unclassifiedLines })),
  };
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 1)}\n`); }
  console.log(JSON.stringify(manifest.summary, null, 1));
  console.log(JSON.stringify(manifest.partialOrUnresolved.slice(0, 5)));
}
main();
