/** Generate byte-preserving plain text for the FY2024 physical budget-request PDFs. */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { localPathFor, DEFAULT_BASE_DIR } from './lib/budget-request-download';
import { assertUniqueSlugs, sha256, splitAndValidatePdfText } from './lib/budget-request-plain-text';

const OUT_ROOT = process.argv.find(a => a.startsWith('--out-root='))?.slice('--out-root='.length)
  ?? path.join('data', 'work', 'budget-request-plain-text', '2024');
const FROZEN = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
type FrozenDocument = { localPdfPath: string; pdfSha256: string; pageCount: number; pageTextSha256: string[] };
const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8')) as { documents: FrozenDocument[] };

function main(): void {
  const manifest = getBudgetRequestManifest(2024);
  const files: { localPdfPath: string; url: string }[] = [];
  for (const src of manifest.sources) for (const doc of src.logicalDocuments) for (const file of doc.files) {
    files.push({ localPdfPath: localPathFor(file.url, src.publisherDomain, DEFAULT_BASE_DIR).split(path.sep).join('/'), url: file.url });
  }
  const slugs = assertUniqueSlugs(files.map(f => f.localPdfPath));
  const frozenByPath = new Map(frozen.documents.map(d => [d.localPdfPath, d]));
  if (frozenByPath.size !== frozen.documents.length) throw new Error('duplicate localPdfPath in frozen manifest');
  if (files.length !== frozen.documents.length) throw new Error(`manifest has ${files.length} PDFs; frozen manifest has ${frozen.documents.length}`);
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  let pages = 0;
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
    fs.writeFileSync(path.join(OUT_ROOT, `${slugs.get(file.localPdfPath)}.txt`), result.stdout);
    pages += pageChunks.length;
  }
  console.log(JSON.stringify({ physicalPdfs: files.length, physicalPages: pages, outputRoot: OUT_ROOT }, null, 2));
}

main();
