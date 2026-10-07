/**
 * TOC column failure isolation の post-hoc 補助分析（visual 観察の後に、観察された failure を machine でどこまで再現できるかを測る。parser でも rule でもない）。
 * 「右 column の row が左 row の page 参照の後ろに並ぶ」行（page 参照の数字 + 空白 + request-number row または （marker）row の開始）の有無と開始 column、
 * および header の 2 つ目の `要求` の column との差を page ごとに記録する。固定 column index・threshold は作らない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-column-boundary-evidence.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-toc-column-structure/2024/column-boundary-evidence.json（--freeze-fixture のとき）
 */
import * as fs from 'fs';
import * as path from 'path';

const FREEZE = process.argv.includes('--freeze-fixture');
const DIR = path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024');
const OUT = path.join(DIR, 'column-boundary-evidence.json');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const inv = readJson<{ pages: { localPdfPath: string; physicalPage: number; textSha256: string; publisherDomain: string }[] }>(path.join(DIR, 'machine-inventory.json'));
const raw = readJson<{ documents: { localPdfPath: string; artifactPath: string }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
const cache = new Map<string, { page: number; textSha256: string; nonEmptyLines: { text: string }[] }[]>();
const RIGHT_ROW = /\d{1,4}(\s+)((?:\d{1,3}\s+\d{2}[‐‑-]\d{2})|[（(]\S+[）)]\s*\d+)/;

const pages = inv.pages.map(p => {
  let P = cache.get(p.localPdfPath);
  if (!P) { P = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p.localPdfPath)!.artifactPath), 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l)); cache.set(p.localPdfPath, P); }
  const rp = P[p.physicalPage - 1];
  if (rp.textSha256 !== p.textSha256) throw new Error('hash mismatch');
  const lines = rp.nonEmptyLines.map(l => l.text);
  const header = lines.find(l => /ページ/.test(l)) ?? null;
  const yokyu = header ? [...header.matchAll(/要求/g)].map(m => m.index!) : [];
  const starts = lines.map(l => RIGHT_ROW.exec(l)).filter((m): m is RegExpExecArray => m !== null).map(m => m.index + m[0].length - m[2].length);
  return {
    localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, publisherDomain: p.publisherDomain,
    headerLine2ndYokyuuColumn: yokyu.length >= 2 ? yokyu[1] : null,
    rightRowLineCount: starts.length,
    rightRowStartColumns: [...new Set(starts)].sort((a, b) => a - b),
    startOffsetsFromHeader2ndYokyuu: yokyu.length >= 2 ? [...new Set(starts.map(s => s - yokyu[1]))].sort((a, b) => a - b) : null,
  };
});
const count = <T,>(xs: T[], f: (x: T) => string) => { const o: Record<string, number> = {}; for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };
const out = {
  schema: 'budget-request-toc-column-boundary-evidence/v0',
  scope: 'post-hoc 補助分析（visual 観察後）。観測量のみで、column 検出 rule・threshold ではない',
  summary: {
    pages: pages.length,
    pagesWithRightRowLine: pages.filter(p => p.rightRowLineCount > 0).length,
    pagesWithoutRightRowLine: pages.filter(p => p.rightRowLineCount === 0).length,
    headerLacks2ndYokyuuToken: pages.filter(p => p.headerLine2ndYokyuuColumn === null).length,
    pagesWithRightRowAndHeaderToken: pages.filter(p => p.rightRowLineCount > 0 && p.headerLine2ndYokyuuColumn !== null).length,
    startOffsetDistribution: count(pages.flatMap(p => p.startOffsetsFromHeader2ndYokyuu ?? []), String),
    pagesWithMultipleRightStartColumns: pages.filter(p => p.rightRowStartColumns.length > 1).length,
    distinctRightStartColumnsAcrossPages: new Set(pages.flatMap(p => p.rightRowStartColumns)).size,
  },
  pages,
};
if (FREEZE) fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.summary, null, 1));
