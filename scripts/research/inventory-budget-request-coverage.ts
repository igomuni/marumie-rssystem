/**
 * 概算要求（歳出概算要求書）の PDF ごとに、年度・所管・会計と、TOC・総表・明細表の CSV が取得できたか（行数）を一覧にする（記述のみ）。
 *   npx tsx scripts/research/inventory-budget-request-coverage.ts <out-dir>
 * PDF の一覧は manifest（fy2024／fy2025-budget-request-manifest）、CSV は tests/fixtures/budget-request-csv/{year}/{cover,toc,total-table,detail-table}/sources/。
 * 所管＝その論理文書の logicalAuthority（なければ budgetJurisdiction、なければ配布元 publisherAuthority）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_BASE_DIR, localPathFor } from '../pipeline-v2/lib/budget-request-download';
import { getBudgetRequestManifest } from '../pipeline-v2/lib/budget-request-manifest';
import { readCsv } from '../pipeline-v2/lib/mof-budget-request-match';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: inventory-budget-request-coverage.ts <out-dir>');
const cell = (v: unknown): string => { const s = String(v ?? ''); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rd = (p: string) => (fs.existsSync(p) ? readCsv(fs.readFileSync(p, 'utf8')) : null);
const header = ['year', 'authority', 'account_type', 'account', 'role', 'slug', 'url', 'verification', 'plain_text', 'plain_text_nonblank_lines', 'cover', 'cover_scope', 'toc', 'toc_kou', 'toc_jikou', 'total', 'total_rows', 'detail', 'detail_rows', 'detail_has_context'];
const rows: (string | number)[][] = [];
for (const year of [2024, 2025]) {
  const m = getBudgetRequestManifest(year);
  const base = path.join('tests', 'fixtures', 'budget-request-csv', String(year));
  for (const src of m.sources) for (const doc of src.logicalDocuments) for (const f of doc.files) {
    const local = localPathFor(f.url, src.publisherDomain, DEFAULT_BASE_DIR);
    const slug = local.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__');
    const txtPath = path.join('data', 'work', 'budget-request-plain-text', String(year), `${slug}.txt`);
    const nonblank = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8').split('\n').filter(l => l.trim() !== '').length : null;
    const cover = rd(path.join(base, 'cover', 'sources', `${slug}.csv`));
    const toc = rd(path.join(base, 'toc', 'sources', `${slug}.csv`)), tot = rd(path.join(base, 'total-table', 'sources', `${slug}.csv`)), det = rd(path.join(base, 'detail-table', 'sources', `${slug}.csv`));
    rows.push([year, doc.logicalAuthority ?? doc.budgetJurisdiction ?? src.publisherAuthority, doc.accountType, doc.account, f.role ?? '', slug, f.url, f.verificationStatus,
      nonblank === null ? 'not_extracted' : nonblank === 0 ? 'no_text_layer' : 'text', nonblank ?? '',
      cover ? 'yes' : 'no', cover ? cover.filter(r => r['kind'] === 'SCOPE').length : '',
      toc ? 'yes' : 'no', toc ? toc.filter(r => /^（項）/.test(r['区分'])).length : '', toc ? toc.filter(r => (r['要求番号'] ?? '') !== '' && /^\d{2}[‐-―−－-]\d{2}/.test(r['区分'])).length : '',
      tot ? 'yes' : 'no', tot ? tot.length : '', det ? 'yes' : 'no', det ? det.length : '', det ? (det.some(r => r['row_type'] === 'CONTEXT') ? 'yes' : 'no') : '']);
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'pdfs.csv'), [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n');

// 所管ごとの集計（年度 × 所管 × 会計の種類）
const agg = new Map<string, { year: number; authority: string; account_type: string; pdfs: number; text: number; cover: number; cover_scope: number; toc: number; total: number; detail: number; toc_kou: number; total_rows: number; detail_rows: number }>();
for (const r of rows) {
  const k = `${r[0]}|${r[1]}|${r[2]}`;
  const a = agg.get(k) ?? { year: r[0] as number, authority: r[1] as string, account_type: r[2] as string, pdfs: 0, text: 0, cover: 0, cover_scope: 0, toc: 0, total: 0, detail: 0, toc_kou: 0, total_rows: 0, detail_rows: 0 };
  a.pdfs++; if (r[8] === 'text') a.text++; if (r[10] === 'yes') { a.cover++; a.cover_scope += Number(r[11]); } if (r[12] === 'yes') { a.toc++; a.toc_kou += Number(r[13]); } if (r[15] === 'yes') { a.total++; a.total_rows += Number(r[16]); } if (r[17] === 'yes') { a.detail++; a.detail_rows += Number(r[18]); }
  agg.set(k, a);
}
const h2 = ['year', 'authority', 'account_type', 'pdfs', 'with_text', 'with_cover', 'cover_scope', 'with_toc', 'toc_kou', 'with_total', 'total_rows', 'with_detail', 'detail_rows'];
fs.writeFileSync(path.join(OUT, 'by-authority.csv'), [h2, ...[...agg.values()].sort((a, b) => a.year - b.year || (a.authority < b.authority ? -1 : 1) || (a.account_type < b.account_type ? -1 : 1)).map(a => [a.year, a.authority, a.account_type, a.pdfs, a.text, a.cover, a.cover_scope, a.toc, a.toc_kou, a.total, a.total_rows, a.detail, a.detail_rows])].map(r => r.map(cell).join(',')).join('\n') + '\n');
const summary: Record<string, unknown> = {};
for (const y of [2024, 2025]) { const rs = rows.filter(r => r[0] === y); summary[y] = { pdfs: rs.length, text: rs.filter(r => r[8] === 'text').length, no_text_layer: rs.filter(r => r[8] === 'no_text_layer').length, not_extracted: rs.filter(r => r[8] === 'not_extracted').length, with_cover: rs.filter(r => r[10] === 'yes').length, with_toc: rs.filter(r => r[12] === 'yes').length, with_total: rs.filter(r => r[15] === 'yes').length, with_detail: rs.filter(r => r[17] === 'yes').length }; }
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
