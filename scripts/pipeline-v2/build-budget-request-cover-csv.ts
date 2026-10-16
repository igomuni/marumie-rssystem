/**
 * 概算要求の表紙（Cover）を CSV にする。表紙＝文書の先頭の、所管・会計の見出し（`05 内閣所管（内閣官房）`）、表題（令和N年度歳出概算要求書）、
 * 目次の行（`1. …総表 … 1`、`2. …明細表 … 3`、`（組織）010 内閣官房 … 3` など）のページ。
 * 読み取りは凍結済みの Cover 構造 parser（lib/budget-request-cover-structure.ts、変更しない）。値の補完・推測はしない。
 * 表紙のページは、Cover／TOC の構造 inventory（tests/fixtures/budget-request-cover-toc-structure/{year}/structure-inventory.json）の COVER 分類を使う。
 * 名称の空白（均等割付）は除いて出力する（他の概算要求 CSV と同じ）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-cover-csv.ts <2024|2025|2026> [outDir] [inputDir]
 * 既定: inputDir = data/work/budget-request-plain-text/{year}、outDir = tests/fixtures/budget-request-csv/{year}/cover
 * 出力: sources/{slug}.csv、unclassified.csv（どの項目にも分類できなかった行）、summary.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseCoverPage, type CoverObservation } from './lib/budget-request-cover-structure';

const year = process.argv[2];
if (!/^20(24|25|26)$/.test(year ?? '')) throw new Error('usage: build-budget-request-cover-csv.ts <2024|2025|2026> [outDir] [inputDir]');
const outDir = process.argv[3] ?? path.join('tests', 'fixtures', 'budget-request-csv', year, 'cover');
const inputDir = process.argv[4] ?? path.join('data', 'work', 'budget-request-plain-text', year);
const INVENTORY = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', year, 'structure-inventory.json');
const sha256 = (v: Buffer | string) => crypto.createHash('sha256').update(v).digest('hex');
const cell = (v: unknown): string => { const s = String(v ?? ''); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const nospace = (parts: string[]) => parts.join('').replace(/[\s　]+/g, '');

interface Page { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierPageType: string }
const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')) as { pages: Page[] };
const covers = inv.pages.filter(p => p.classifierPageType === 'COVER');
const slugOf = (localPdfPath: string) => localPdfPath.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__');

const HEADER = ['source_page', 'entry_index', 'kind', 'ordinal', 'marker', 'code', 'name', 'page_ref', 'status'];
fs.mkdirSync(path.join(outDir, 'sources'), { recursive: true });
const bySource = new Map<string, { page: Page; obs: CoverObservation }[]>();
const unclassified: string[][] = [];
let textHashMatch = 0, textHashMismatch = 0;
for (const c of covers) {
  const slug = slugOf(c.localPdfPath);
  const file = path.join(inputDir, `${slug}.txt`);
  if (!fs.existsSync(file)) throw new Error(`plain text が無い: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const pages = text.split('\f'); if (text.endsWith('\f')) pages.pop();
  const pageText = pages[c.physicalPage - 1];
  if (pageText === undefined) throw new Error(`${slug} p${c.physicalPage} が無い`);
  if (sha256(pageText) === c.textSha256) textHashMatch++; else textHashMismatch++;
  const nonEmptyLines = pageText.split('\n').filter(l => l.trim() !== '').map(text => ({ text }));
  const obs = parseCoverPage({ filePath: c.localPdfPath, fileSha256: c.pdfSha256, physicalPage: c.physicalPage, textSha256: c.textSha256 }, nonEmptyLines);
  (bySource.get(slug) ?? bySource.set(slug, []).get(slug)!).push({ page: c, obs });
  for (const l of obs.unclassifiedLines) unclassified.push([slug, String(c.physicalPage), l.trim()]);
}
let rows = 0; const status: Record<string, number> = {}; const kinds: Record<string, number> = {};
for (const [slug, items] of [...bySource].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const out: string[][] = [];
  for (const { page, obs } of items.sort((a, b) => a.page.physicalPage - b.page.physicalPage)) {
    status[obs.status] = (status[obs.status] ?? 0) + 1;
    out.push([String(page.physicalPage), '0', 'HEADER', '', '', obs.header.codeRaw ?? '', nospace(obs.header.textRawParts), '', obs.header.status]);
    if (obs.header.titleRawParts.length) out.push([String(page.physicalPage), '0', 'TITLE', '', '', '', nospace(obs.header.titleRawParts), '', obs.header.status]);
    obs.entries.forEach((e, i) => {
      if (e.kind === 'SECTION_REFERENCE') out.push([String(page.physicalPage), String(i + 1), 'SECTION', e.ordinalRaw ?? '', '', '', nospace(e.labelRawParts), e.printedPageRefRaw ?? '', e.status]);
      else out.push([String(page.physicalPage), String(i + 1), 'SCOPE', '', (e.markerRaw ?? '').replace(/[\s　]+/g, ''), e.codeRaw ?? '', nospace(e.nameRawParts), e.printedPageRefRaw ?? '', e.status]);
    });
  }
  for (const r of out) kinds[r[2]] = (kinds[r[2]] ?? 0) + 1;
  rows += out.length;
  fs.writeFileSync(path.join(outDir, 'sources', `${slug}.csv`), [HEADER, ...out].map(r => r.map(cell).join(',')).join('\n') + '\n');
}
fs.writeFileSync(path.join(outDir, 'unclassified.csv'), [['source', 'source_page', 'text'], ...unclassified].map(r => r.map(cell).join(',')).join('\n') + '\n');
const summary = { year: Number(year), coverPages: covers.length, sources: bySource.size, rows, rowKinds: kinds, pageStatus: status, unclassifiedLines: unclassified.length, inventoryPageTextHash: { match: textHashMatch, mismatch: textHashMismatch } };
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
