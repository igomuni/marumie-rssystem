/**
 * PR-3B: Cover Structure v0 の frozen evaluation candidate を決定的に生成する。
 * 母集団 = Page Classification v0 が COVER と routing した page 全て − PR-3A の development-explored COVER page。
 * label・render・Raw Text 本文は読まない（page key と hash のみ）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-cover-structure-candidates.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-cover-structure/2024/frozen-candidates.json（--freeze-fixture のとき）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageClassificationRecord } from './lib/budget-request-page-classification';

const FREEZE = process.argv.includes('--freeze-fixture');
const CLS = path.join('data', 'work', 'budget-request-page-classification', '2024', 'page-classification.jsonl');
const CLS_MANIFEST = path.join('tests', 'fixtures', 'budget-request-page-classification', '2024', 'page-classification-v0-implementation-manifest.json');
const LEDGER = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024', 'development-explored-pages.json');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const OUT = path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024', 'frozen-candidates.json');
const RAW_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const CLS_DIGEST = '39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc';
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

function main() {
  const raw = readJson<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(RAW_MANIFEST);
  if (raw.frozenInput.corpusDigestSha256 !== RAW_DIGEST) throw new Error('raw text digest mismatch');
  const body = fs.readFileSync(CLS, 'utf8');
  if (sha256Hex(body) !== CLS_DIGEST || readJson<{ summary: { corpusClassificationDigestSha256: string } }>(CLS_MANIFEST).summary.corpusClassificationDigestSha256 !== CLS_DIGEST) throw new Error('classification digest mismatch');
  const covers = body.split('\n').filter(l => l).map(l => JSON.parse(l) as PageClassificationRecord).filter(r => r.classification.pageType === 'COVER');
  const explored = readJson<{ pages: { localPdfPath: string; physicalPage: number; classifierPageType: string }[] }>(LEDGER).pages.filter(p => p.classifierPageType === 'COVER');
  const exploredKeys = new Set(explored.map(key));
  if (exploredKeys.size !== explored.length) throw new Error('duplicate explored key');
  const allKeys = new Set(covers.map(key));
  if (allKeys.size !== covers.length) throw new Error('duplicate COVER key');
  for (const k of exploredKeys) if (!allKeys.has(k)) throw new Error(`explored key not in COVER population: ${k}`);
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  let hashMismatch = 0;
  const rows = covers.filter(r => !exploredKeys.has(key(r))).map(r => {
    const d = docs.get(r.localPdfPath)!;
    if (d.pdfSha256 !== r.pdfSha256 || d.pageTextSha256[r.physicalPage - 1] !== r.rawText.textSha256) hashMismatch++;
    return { filePath: r.localPdfPath, fileSha256: r.pdfSha256, physicalPage: r.physicalPage, textSha256: r.rawText.textSha256, classifierPageType: 'COVER', evaluationRole: 'FROZEN_EVALUATION' };
  }).sort((a, b) => cmp(a.filePath, b.filePath) || a.physicalPage - b.physicalPage);
  if (hashMismatch) throw new Error(`hash mismatch: ${hashMismatch}`);
  const overlap = rows.filter(r => exploredKeys.has(`${r.filePath}#${r.physicalPage}`)).length;
  const out = {
    schema: 'budget-request-cover-structure-frozen-candidates/v0',
    scope: 'Cover Structure v0 の frozen evaluation candidate。Page Classification v0 の COVER から PR-3A development-explored COVER を除いた全 page。label・render・Raw Text 本文は含まない',
    generator: 'scripts/pipeline-v2/build-budget-request-cover-structure-candidates.ts',
    frozenInput: { rawTextCorpusDigestSha256: RAW_DIGEST, pageClassificationCorpusDigestSha256: CLS_DIGEST, exploredLedgerSha256: sha256Hex(fs.readFileSync(LEDGER)) },
    population: { allCover: covers.length, developmentExploredCover: explored.length, frozenCandidates: rows.length, overlapWithExplored: overlap, duplicateKeys: 0, hashMismatch },
    candidateDigestSha256: sha256Hex(rows.map(r => `${r.filePath} ${r.fileSha256} ${r.physicalPage} ${r.textSha256}`).join('\n')),
    candidates: rows,
  };
  if (FREEZE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`); }
  console.log(JSON.stringify({ population: out.population, candidateDigestSha256: out.candidateDigestSha256 }, null, 1));
}
main();
