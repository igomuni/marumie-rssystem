/**
 * 概算要求PDFの目次(TOC)ページ → CSV（PDF-native v0）のランナー。仕様・限界は docs/budget-request-toc-pdf-native-csv.md。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/build-budget-request-toc-pdf-native-csv.ts --source-root=<data/download の場所> --out-dir=<出力先>
 *     [--inventory=<structure-inventory.json>]
 *
 * 入力は凍結済みの目次ページ集合（既定: tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json の
 * classifierPageType=TOC。localPdfPath の `data/download/` を --source-root に読み替える）。PDF は読み取り専用で、
 * SHA-256 が inventory と一致しなければ停止する。出力先は source-root の外でなければならない。
 * 経過時間は標準出力にのみ出し、成果物には入れない（再実行でバイト一致させるため）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { deterministicPdfSlug } from './lib/budget-request-plain-text';
import {
  convertTocPage,
  DEFAULT_TOC_PARAMS,
  extractionOptionsId,
  renderCsv,
  renderMainCsv,
  TOC_PDF_NATIVE_SCHEMA,
  type AuditKind,
  type PageResult,
  type TocEntry,
} from './lib/budget-request-toc-pdf-native-csv';

const DEFAULT_INVENTORY = 'tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json';
const USAGE = `usage: build-budget-request-toc-pdf-native-csv.ts --source-root=<dir> --out-dir=<dir> [--inventory=<json>]
  --source-root=  inventory の localPdfPath の先頭 "data/download/" に相当するディレクトリ（読み取り専用）
  --out-dir=      出力先（source-root の外）。既存ファイルのうちこのツールの成果物名のものだけ上書きする
  --inventory=    既定: ${DEFAULT_INVENTORY}`;

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

type InventoryPage = { localPdfPath: string; pdfSha256: string; physicalPage: number; classifierPageType: string; classifierSource: string };

function parseArgs(argv: string[]): { sourceRoot: string; outDir: string; inventory: string } {
  const opt = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = argv.filter(a => !/^--(source-root|out-dir|inventory)=/.test(a));
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown.join(' ')}\n${USAGE}`);
  const sourceRoot = opt('source-root');
  const outDir = opt('out-dir');
  if (!sourceRoot || !outDir) throw new Error(`--source-root と --out-dir は必須です\n${USAGE}`);
  return { sourceRoot: path.resolve(sourceRoot), outDir: path.resolve(outDir), inventory: path.resolve(opt('inventory') ?? DEFAULT_INVENTORY) };
}

const csvFile = (headers: string[], rows: (string | number | null)[][]) => renderCsv(headers, rows);

async function main(): Promise<void> {
  const { sourceRoot, outDir, inventory } = parseArgs(process.argv.slice(2));
  const rel = path.relative(sourceRoot, outDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`out-dir は source-root の外にしてください: ${outDir}`);
  if (!fs.statSync(sourceRoot).isDirectory()) throw new Error(`source-root がディレクトリではありません: ${sourceRoot}`);

  const inventoryBytes = fs.readFileSync(inventory);
  const pages = (JSON.parse(inventoryBytes.toString('utf8')) as { pages: InventoryPage[] }).pages
    .filter(p => p.classifierPageType === 'TOC')
    .sort((a, b) => a.localPdfPath.localeCompare(b.localPdfPath) || a.physicalPage - b.physicalPage);
  const keys = pages.map(p => `${p.localPdfPath}\u0000${p.physicalPage}`);
  if (new Set(keys).size !== keys.length) throw new Error('inventory に重複した (PDF, page) があります');
  const byPdf = new Map<string, InventoryPage[]>();
  for (const p of pages) byPdf.set(p.localPdfPath, [...(byPdf.get(p.localPdfPath) ?? []), p]);
  console.log(`TOC pages=${pages.length} pdfs=${byPdf.size}`);

  const t0 = Date.now();
  const results = new Map<string, PageResult[]>(); // localPdfPath → PageResult[]（page 昇順）
  const pdfVersion = await pdfjsVersion();
  const sourceErrors: { localPdfPath: string; message: string }[] = [];
  for (const [localPdfPath, pdfPages] of byPdf) {
    const abs = path.join(sourceRoot, localPdfPath.replace(/^data\/download\//, ''));
    try {
      const bytes = fs.readFileSync(abs);
      const digest = sha256(bytes);
      for (const p of pdfPages) if (p.pdfSha256 !== digest) throw new Error(`PDF SHA-256 が inventory と一致しない: ${digest} != ${p.pdfSha256}`);
      const out: PageResult[] = [];
      for (const p of pdfPages) {
        const ex = await extractPageTokens(abs, p.physicalPage);
        out.push(convertTocPage({ pdfSha256: digest, physicalPage: p.physicalPage, meta: ex.page, tokens: ex.tokens }));
      }
      results.set(localPdfPath, out);
    } catch (e) {
      sourceErrors.push({ localPdfPath, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (sourceErrors.length > 0) {
    for (const e of sourceErrors) console.error(`[source error] ${e.localPdfPath}: ${e.message}`);
    throw new Error(`${sourceErrors.length} 個の PDF を処理できませんでした。成果物は書きません`);
  }

  // ---- 出力 ----
  const files = new Map<string, string>();
  const sourceRows: (string | number | null)[][] = [];
  const provenanceRows: (string | number | null)[][] = [];
  const auditRows: (string | number | null)[][] = [];
  const ledgerRows: (string | number | null)[][] = [];
  const pageRows: (string | number | null)[][] = [];
  const reasonCounts: Record<string, number> = {};
  const shapeCounts: Record<string, number> = {};
  const totals = { tokens: 0, blank: 0, headerZone: 0, entryTokens: 0, unresolvedTokens: 0, entries: 0, audits: 0, geometricRowsLeft: 0, geometricRowsRight: 0, pagesWithColumnEvidence: 0 };
  const optionsId = extractionOptionsId(pdfVersion);
  const joinIdx = (xs: number[]) => xs.join(';');

  for (const [localPdfPath, pdfResults] of results) {
    const slug = deterministicPdfSlug(localPdfPath);
    const sha = pdfResults[0].pdfSha256;
    const all: TocEntry[] = [];
    for (const r of pdfResults) {
      all.push(...r.entries);
      totals.tokens += r.tokenCount;
      totals.geometricRowsLeft += r.geometricRows.left;
      totals.geometricRowsRight += r.geometricRows.right;
      if (r.columnEvidence.available) totals.pagesWithColumnEvidence++;
      for (const l of r.ledger) {
        if (l.disposition === 'BLANK') totals.blank++;
        else if (l.disposition === 'HEADER_ZONE') totals.headerZone++;
        else if (l.disposition === 'ENTRY') totals.entryTokens++;
        else totals.unresolvedTokens++;
        ledgerRows.push([slug, sha, r.physicalPage, l.tokenIndex, l.disposition, l.reason, l.ref, l.side, l.rawText]);
      }
      for (const a of r.audits) {
        reasonCounts[a.kind] = (reasonCounts[a.kind] ?? 0) + 1;
        auditRows.push([a.auditId, slug, localPdfPath, sha, r.physicalPage, a.kind, a.side, a.rowId, a.candidateOwnerRowId, a.candidateOwnerEntryId, joinIdx(a.tokenIndexes), JSON.stringify(a.rawTexts), a.detail]);
      }
      totals.audits += r.audits.length;
      const ent = r.entries;
      for (const e of ent) shapeCounts[e.shape] = (shapeCounts[e.shape] ?? 0) + 1;
      pageRows.push([
        slug, sha, r.physicalPage, r.tokenCount, r.columnEvidence.available ? 'YES' : 'NO',
        r.columnEvidence.available ? r.columnEvidence.boundaryX.toFixed(3) : '', r.columnEvidence.available ? '' : r.columnEvidence.reason,
        r.geometricRows.left, r.geometricRows.right, ent.length, r.audits.length,
        r.ledger.filter(l => l.disposition === 'BLANK').length, r.ledger.filter(l => l.disposition === 'HEADER_ZONE').length,
        r.ledger.filter(l => l.disposition === 'ENTRY').length, r.ledger.filter(l => l.disposition === 'UNRESOLVED').length,
      ]);
    }
    totals.entries += all.length;
    files.set(`sources/${slug}.csv`, renderMainCsv(all));
    all.forEach((e, i) => {
      const page = pdfResults.find(r => r.entries.includes(e))!.physicalPage;
      provenanceRows.push([e.entryId, slug, localPdfPath, i + 1, sha, page, pdfVersion, optionsId, e.side, e.rowId, e.shape, joinIdx(e.requestNumberTokenIndexes), joinIdx(e.labelTokenIndexes), joinIdx(e.pageRefTokenIndexes)]);
    });
    sourceRows.push([slug, localPdfPath, sha, pdfResults.length, pdfResults.map(r => r.physicalPage).join(';'), all.length, pdfResults.reduce((n, r) => n + r.audits.length, 0)]);
  }

  files.set('sources.csv', csvFile(['source_slug', 'source_pdf', 'pdf_sha256', 'toc_pages', 'physical_pages', 'entries', 'audit_records'], sourceRows));
  files.set('entry-provenance.csv', csvFile(['entry_id', 'source_slug', 'source_pdf', 'csv_row', 'pdf_sha256', 'physical_page', 'pdfjs_version', 'extraction_options_id', 'side', 'row_id', 'shape', 'request_number_item_indexes', 'label_item_indexes', 'page_ref_item_indexes'], provenanceRows));
  files.set('unresolved.csv', csvFile(['audit_id', 'source_slug', 'source_pdf', 'pdf_sha256', 'physical_page', 'kind', 'side', 'row_id', 'candidate_owner_row_id', 'candidate_owner_entry_id', 'item_indexes', 'raw_texts_json', 'detail'], auditRows));
  files.set('token-ledger.csv', csvFile(['source_slug', 'pdf_sha256', 'physical_page', 'item_index', 'disposition', 'reason', 'ref', 'side', 'raw_text'], ledgerRows));
  files.set('page-summary.csv', csvFile(['source_slug', 'pdf_sha256', 'physical_page', 'items', 'column_evidence', 'boundary_x', 'no_evidence_reason', 'geometric_rows_left', 'geometric_rows_right', 'entries', 'audit_records', 'blank_items', 'header_zone_items', 'entry_items', 'unresolved_items'], pageRows));

  if (totals.tokens !== totals.blank + totals.headerZone + totals.entryTokens + totals.unresolvedTokens) throw new Error('item accounting が合わない');
  const inputs = [...byPdf.entries()].map(([localPdfPath, ps]) => ({ source_pdf: localPdfPath, pdf_sha256: ps[0].pdfSha256, toc_pages: ps.map(p => p.physicalPage) }));
  const codeFiles = ['scripts/pipeline-v2/lib/budget-request-toc-pdf-native-csv.ts', 'scripts/pipeline-v2/build-budget-request-toc-pdf-native-csv.ts'];
  const summary = {
    schema: TOC_PDF_NATIVE_SCHEMA,
    extraction: { library: 'pdfjs-dist', version: pdfVersion, optionsId },
    parameters: DEFAULT_TOC_PARAMS,
    population: { tocPages: pages.length, pdfs: byPdf.size, pagesWithColumnEvidence: totals.pagesWithColumnEvidence, pagesWithoutColumnEvidence: pages.length - totals.pagesWithColumnEvidence },
    counts: {
      items: totals.tokens,
      itemDisposition: { blank: totals.blank, headerZone: totals.headerZone, entry: totals.entryTokens, unresolved: totals.unresolvedTokens },
      entries: totals.entries,
      entriesByShape: shapeCounts,
      auditRecords: totals.audits,
      auditRecordsByKind: reasonCounts as Record<AuditKind, number>,
      geometricRows: { left: totals.geometricRowsLeft, right: totals.geometricRowsRight },
    },
    inputs: {
      inventory: { path: path.relative(process.cwd(), inventory), sha256: sha256(inventoryBytes) },
      pdfs: inputs,
      code: codeFiles.map(f => ({ path: f, sha256: sha256(fs.readFileSync(f)) })),
    },
  };
  files.set('summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  const hashes = Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => [name, { sha256: sha256(content), bytes: Buffer.byteLength(content) }]));
  files.set('output-hashes.json', `${JSON.stringify({ schema: `${TOC_PDF_NATIVE_SCHEMA}/output-hashes`, files: hashes }, null, 2)}\n`);

  for (const [name, content] of files) {
    const dest = path.join(outDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, 'utf8');
  }
  console.log(`entries=${totals.entries} audits=${totals.audits} items=${totals.tokens} (blank ${totals.blank}, header ${totals.headerZone}, entry ${totals.entryTokens}, unresolved ${totals.unresolvedTokens})`);
  console.log(`→ ${outDir} (${((Date.now() - t0) / 1000).toFixed(1)}s; 経過時間は成果物に含めない)`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
