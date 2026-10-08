/**
 * TOC A 層 failure isolation の post-hoc 補助分析（visual 観察の後）。「左 row の page 参照の後ろに右 row が始まる」行について、
 * 右 row の開始 character index を row 種別（request-number / marker）ごとに page 内で集計し、jitter（page 内の最大差）と種別間 offset を測る。
 * display width（全角 2 cell）換算の開始位置との分散比較も記録する。観測量であり rule・threshold ではない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-physical-row-boundary-band.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-toc-physical-row/2024/boundary-band-evidence.json（--freeze-fixture のとき）
 */
import * as fs from 'fs';
import * as path from 'path';

const FREEZE = process.argv.includes('--freeze-fixture');
const DIR = path.join('tests', 'fixtures', 'budget-request-toc-physical-row', '2024');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const inv = readJson<{ pages: { localPdfPath: string; physicalPage: number; textSha256: string }[] }>(path.join(DIR, 'candidate-inventory.json'));
const raw = readJson<{ documents: { localPdfPath: string; artifactPath: string }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
const RIGHT = /(\d{1,4})(\s+)((?:\d{1,3}\s+\d{2}[‐‑-]\d{2})|[（(]\S+[）)]\s*\d+)/;
// East Asian Width の W / F を 2 cell とみなす近似（wide 文字の主要 block のみ。解析 hint）
const wide = (c: string) => { const x = c.codePointAt(0)!; return (x >= 0x1100 && x <= 0x115f) || (x >= 0x2e80 && x <= 0xa4cf) || (x >= 0xac00 && x <= 0xd7a3) || (x >= 0xf900 && x <= 0xfaff) || (x >= 0xfe30 && x <= 0xfe6f) || (x >= 0xff00 && x <= 0xff60) || (x >= 0xffe0 && x <= 0xffe6); };
const cells = (s: string, idx: number) => [...s.slice(0, idx)].reduce((n, c) => n + (wide(c) ? 2 : 1), 0);
const cache = new Map<string, { nonEmptyLines: { text: string }[]; textSha256: string }[]>();
const pages = inv.pages.map(p => {
  let P = cache.get(p.localPdfPath);
  if (!P) { P = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p.localPdfPath)!.artifactPath), 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l)); cache.set(p.localPdfPath, P); }
  const rp = P[p.physicalPage - 1];
  if (rp.textSha256 !== p.textSha256) throw new Error('hash mismatch');
  const idx: Record<'req' | 'marker', Set<number>> = { req: new Set(), marker: new Set() };
  const cel: Record<'req' | 'marker', Set<number>> = { req: new Set(), marker: new Set() };
  let minGap = Infinity;
  for (const l of rp.nonEmptyLines) {
    const m = RIGHT.exec(l.text);
    if (!m) continue;
    const start = m.index + m[1].length + m[2].length;
    const k = /^[（(]/.test(m[3]) ? 'marker' : 'req';
    idx[k].add(start); cel[k].add(cells(l.text, start));
    minGap = Math.min(minGap, m[2].length);
  }
  const spread = (s: Set<number>) => (s.size ? Math.max(...s) - Math.min(...s) : null);
  return {
    localPdfPath: p.localPdfPath, physicalPage: p.physicalPage,
    hasRightRow: idx.req.size + idx.marker.size > 0,
    indexSpread: { req: spread(idx.req), marker: spread(idx.marker) },
    displayCellSpread: { req: spread(cel.req), marker: spread(cel.marker) },
    markerMinusRequestMinIndex: idx.req.size && idx.marker.size ? Math.min(...idx.marker) - Math.min(...idx.req) : null,
    minWhitespaceBetweenLeftRefAndRightStart: Number.isFinite(minGap) ? minGap : null,
  };
});
const withRight = pages.filter(p => p.hasRightRow);
const tally = (xs: (number | null)[]) => { const o: Record<string, number> = {}; for (const x of xs) if (x !== null) o[String(x)] = (o[String(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => Number(a) - Number(b))); };
const out = {
  schema: 'budget-request-toc-physical-row-boundary-band-evidence/v0',
  scope: 'post-hoc 補助分析。観測量のみ（rule・threshold ではない）',
  summary: {
    pagesWithRightRow: withRight.length,
    indexSpreadWithinPagePerKind: tally(withRight.flatMap(p => [p.indexSpread.req, p.indexSpread.marker])),
    displayCellSpreadWithinPagePerKind: tally(withRight.flatMap(p => [p.displayCellSpread.req, p.displayCellSpread.marker])),
    markerMinusRequestMinIndex: tally(withRight.map(p => p.markerMinusRequestMinIndex)),
    minWhitespaceBetweenLeftRefAndRightStart: tally(withRight.map(p => p.minWhitespaceBetweenLeftRefAndRightStart)),
  },
  pages,
};
if (FREEZE) fs.writeFileSync(path.join(DIR, 'boundary-band-evidence.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.summary, null, 1));
