/**
 * Generate byte-preserving plain text for the physical budget-request PDFs of one fiscal year.
 *   npx tsx scripts/pipeline-v2/build-budget-request-plain-text.ts [--year=2024] [--out-root=<dir>]
 * The PDF set is the frozen PDF corpus record (tests/fixtures/budget-request-pdf-corpus/{year}/pdf-corpus-freeze.json). PDF hash and page count are validated
 * against it, and plain-text-manifest.json (per-page text hashes) is written next to the text files, to be frozen
 * (tests/fixtures/budget-request-plain-text/{year}/plain-text-manifest.json).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { assertUniqueSlugs, sha256, splitAndValidatePdfText } from './lib/budget-request-plain-text';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const YEAR = Number(arg('year') ?? '2024');
if (!/^\d{4}$/.test(String(YEAR))) throw new Error(`--year must be a 4-digit fiscal year: ${arg('year')}`);
const OUT_ROOT = arg('out-root') ?? path.join('data', 'work', 'budget-request-plain-text', String(YEAR));
const FROZEN = path.join('tests', 'fixtures', 'budget-request-pdf-corpus', String(YEAR), 'pdf-corpus-freeze.json');
type FrozenDocument = { localPdfPath: string; pdfSha256: string; pageCount: number; pageTextSha256?: string[] };
const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8')) as { documents: FrozenDocument[] };

function main(): void {
  const files: { localPdfPath: string; url: string }[] = [];
  for (const d of frozen.documents as (FrozenDocument & { sourceUrl: string })[]) files.push({ localPdfPath: d.localPdfPath, url: d.sourceUrl });
  const slugs = assertUniqueSlugs(files.map(f => f.localPdfPath));
  const frozenByPath = new Map(frozen.documents.map(d => [d.localPdfPath, d]));
  if (frozenByPath.size !== frozen.documents.length) throw new Error('duplicate localPdfPath in frozen manifest');
  if (files.length !== frozen.documents.length) throw new Error(`manifest has ${files.length} PDFs; frozen manifest has ${frozen.documents.length}`);
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  let pages = 0;
  const produced: { localPdfPath: string; textFile: string; pdfSha256: string; pageCount: number; status: 'EXTRACTED' | 'EMPTY'; textSha256: string; pageTextSha256: string[] }[] = [];
  for (const file of files) {
    const record = frozenByPath.get(file.localPdfPath);
    if (!record) throw new Error(`PDF missing from frozen manifest: ${file.localPdfPath}`);
    const before = sha256(fs.readFileSync(file.localPdfPath));
    if (before !== record.pdfSha256) throw new Error(`source PDF SHA-256 differs from frozen record: ${file.localPdfPath}`);
    const info = execFileSync('pdfinfo', [file.localPdfPath], { encoding: 'utf8' });
    const match = /^Pages:\s+(\d+)/m.exec(info);
    if (!match) throw new Error(`pdfinfo did not report page count: ${file.localPdfPath}`);
    const pageCount = Number(match[1]);
    if (pageCount !== record.pageCount) throw new Error(`pdfinfo page count differs from frozen record: ${file.localPdfPath}`);
    const result = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', file.localPdfPath, '-'], { encoding: null, maxBuffer: 1 << 30 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`pdftotext failed for ${file.localPdfPath}: ${result.stderr?.toString('utf8') ?? ''}`);
    if (!Buffer.isBuffer(result.stdout)) throw new Error('pdftotext stdout was not captured as Buffer');
    const pageChunks = splitAndValidatePdfText(result.stdout, pageCount, record.pageTextSha256);
    const after = sha256(fs.readFileSync(file.localPdfPath));
    if (after !== before || after !== record.pdfSha256) throw new Error(`source PDF changed during extraction: ${file.localPdfPath}`);
    const textFile = `${slugs.get(file.localPdfPath)}.txt`;
    fs.writeFileSync(path.join(OUT_ROOT, textFile), result.stdout);
    pages += pageChunks.length;
    produced.push({
      localPdfPath: file.localPdfPath, textFile, pdfSha256: before, pageCount,
      status: pageChunks.every(c => c.toString('utf8').trim() === '') ? 'EMPTY' : 'EXTRACTED',
      textSha256: sha256(result.stdout), pageTextSha256: pageChunks.map(c => sha256(c)),
    });
  }
  {
    fs.writeFileSync(path.join(OUT_ROOT, 'plain-text-manifest.json'), JSON.stringify({
      schema: 'budget-request-plain-text-manifest/v0',
      fiscalYear: YEAR,
      frozenPdfCorpus: { path: FROZEN, sha256: sha256(fs.readFileSync(FROZEN)) },
      extraction: { tool: spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).stderr.split('\n')[0], args: ['-layout', '-enc', 'UTF-8'] },
      physicalPdfs: produced.length,
      physicalPages: pages,
      documents: produced,
    }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ fiscalYear: YEAR, physicalPdfs: files.length, physicalPages: pages, outputRoot: OUT_ROOT }, null, 2));
}

main();
