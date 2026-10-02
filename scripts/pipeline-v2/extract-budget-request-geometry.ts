/**
 * 概算要求PDFの指定ページについて、SourceToken → PhysicalRowCandidate / ColumnBandObservation を観測するPoC。
 * 物理配置の観測のみ（意味の分類・Coreとの関連付け・数値parse・文字列の結合はしない）。全documentは走査しない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-geometry.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-geometry.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-geometry.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/table-geometry-poc/{id}.json（data/downloadには書かない）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { EXTRACTION_WORK_DIR, inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { resolvePageJobs, type PageJob } from './lib/budget-request-page-jobs';
import { extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { COORDINATE_SYSTEM } from './lib/budget-request-source-token';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { buildTableGeometry, sweepYReference, TABLE_GEOMETRY_SCHEMA } from './lib/budget-request-table-geometry';

const USAGE = `usage: extract-budget-request-geometry.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/table-geometry-poc/{id}.json`;

function usageError(message: string): void {
  console.error(`${message}\n${USAGE}`);
  process.exitCode = 1;
}

async function runJob(year: number, job: PageJob): Promise<void> {
  const state = inspectTarget(job.target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${job.target.localPath}`);
  const extraction = await extractPageTokens(job.target.localPath, job.page);
  const geometry = buildTableGeometry(extraction.tokens, extraction.page);
  const out = {
    schema: TABLE_GEOMETRY_SCHEMA,
    fiscalYear: year,
    source: { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    ...(job.sample ? { sample: job.sample } : {}),
    page: extraction.page,
    coordinateSystem: COORDINATE_SYSTEM,
    sourceTokens: { library: 'pdfjs-dist', version: await pdfjsVersion(), note: 'rows/bands reference SourceToken.index (pdf.js text item order of this page)' },
    ...geometry,
    diagnostics: { yReferenceSweep: sweepYReference(extraction.tokens, extraction.page) },
  };
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'table-geometry-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const rows = geometry.physicalRows;
  const diff = rows.filter(r => !r.rawOrderMatchesVisualOrder);
  const p = geometry.parameters;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} sourceTokens=${geometry.sourceTokenCount} ` +
      `rows=${rows.length} (raw≠visual: ${diff.length}) bands=${geometry.columnBands.length}\n` +
      `  rowClustering: ${p.rowClustering.yReference}, tolerance=${p.rowClustering.tolerance}pt (=${p.rowClustering.toleranceFactor}×${p.rowClustering.referenceFontSize}pt)\n  → ${file}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = args.filter(a => a.startsWith('--') && a !== '--golden' && !/^--(sample|document|page)=/.test(a));
  const positional = args.filter(a => !a.startsWith('--'));
  if (unknown.length > 0) return usageError(`unknown option: ${unknown.join(' ')}`);
  if (positional.length > 1 || (positional[0] !== undefined && !/^\d{4}$/.test(positional[0]))) {
    return usageError(`year must be a 4-digit fiscal year: ${positional.join(' ')}`);
  }
  const year = positional[0] ? Number(positional[0]) : 2024;
  let manifest;
  try {
    manifest = getBudgetRequestManifest(year);
  } catch (e) {
    return usageError(e instanceof Error ? e.message : String(e));
  }
  const { jobs, error } = resolvePageJobs(year, listExtractionTargets(manifest), {
    sampleIds: opt('sample')?.split(','),
    golden: args.includes('--golden'),
    documentUrl: opt('document'),
    page: Number(opt('page')),
  });
  if (error) return usageError(error);

  console.log(`=== TableGeometry PoC: year=${year} jobs=${jobs.length} ===`);
  for (const job of jobs) {
    try {
      await runJob(year, job);
    } catch (e) {
      console.error(`\n[${job.id}] failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

main();
