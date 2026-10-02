/**
 * 概算要求PDFの指定ページだけからSourceTokenを取り出すPoC（text layerの文字と位置を忠実に保持できるかの検証）。
 * 全82 documentの走査はしない。意味解析（行・列・表・備考の分類、Coreとの関連付け）もしない。
 *
 * 使い方:
 *   npx tsx scripts/pipeline-v2/extract-budget-request-page.ts [year] --sample=<id>[,<id>]
 *   npx tsx scripts/pipeline-v2/extract-budget-request-page.ts [year] --golden
 *   npx tsx scripts/pipeline-v2/extract-budget-request-page.ts [year] --document=<canonicalUrl> --page=<N>
 *
 * 出力: data/work/budget-request-extraction/{year}/source-token-poc/{id}.json（data/downloadには書かない）。
 * Golden Sampleに人間確認値（human-observations.json）がある場合は、抽出結果との差を表示する（評価専用）。
 */
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { EXTRACTION_WORK_DIR, inspectTarget, listExtractionTargets } from './lib/budget-request-extraction';
import { loadHumanObservations, resolvePageJobs, type PageJob } from './lib/budget-request-page-jobs';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { buildPocOutput, extractPageTokens, pdfjsVersion } from './lib/budget-request-pdf-page';
import { compareObservation, type HumanObservation } from './lib/budget-request-source-token';

const USAGE = `usage: extract-budget-request-page.ts [year] (--sample=id[,id] | --golden | --document=<canonicalUrl> --page=N)
  --sample=    Golden Sample id（tests/fixtures/budget-request-extraction/{year}/golden-samples.json）
  --golden     Golden Sample全件（全documentの走査ではない）
  --document=  manifestのcanonical URL（--page= と併用）
  --page=      PDFの物理ページ番号（1始まり）
出力: ${EXTRACTION_WORK_DIR}/{year}/source-token-poc/{id}.json`;

function usageError(message: string): void {
  console.error(`${message}\n${USAGE}`);
  process.exitCode = 1;
}

async function runJob(year: number, job: PageJob, observations: HumanObservation[]): Promise<void> {
  const state = inspectTarget(job.target, nodeBudgetRequestFs).state;
  if (state !== 'FOUND') throw new Error(`原本が${state}です: ${job.target.localPath}`);
  const extraction = await extractPageTokens(job.target.localPath, job.page);
  const out = buildPocOutput(
    year,
    { canonicalUrl: job.target.canonicalUrl, publisherDomain: job.target.publisherDomain, localPath: job.target.localPath },
    job.sample,
    extraction,
    await pdfjsVersion(),
  );
  const file = path.join(EXTRACTION_WORK_DIR, String(year), 'source-token-poc', `${job.id}.json`);
  nodeBudgetRequestFs.mkdirp(path.dirname(file));
  nodeBudgetRequestFs.writeAtomic(file, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));

  const t = extraction.timingMs;
  console.log(
    `\n[${job.id}] ${job.target.publisherDomain} page ${job.page}/${extraction.page.numPages} ${extraction.page.width}x${extraction.page.height}pt ` +
      `tokens=${extraction.tokens.length} (read ${t.read}ms / open ${t.open}ms / page+text ${t.page}ms)\n  → ${file}`,
  );
  for (const o of observations) {
    const c = compareObservation(extraction.tokens, o);
    console.log(
      c.token
        ? `  human "${o.text}" (${o.x}, ${o.y}) ⇔ token#${c.token.index} "${c.token.rawText}" (${c.token.bbox.xMin}, ${c.token.bbox.yMin}) Δ=(${c.dx}, ${c.dy})`
        : `  human "${o.text}" (${o.x}, ${o.y}) ⇔ 該当tokenなし`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = args.filter(a => a.startsWith('--') && !['--golden'].includes(a) && !/^--(sample|document|page)=/.test(a));
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
  const targets = listExtractionTargets(manifest);

  const { jobs, error } = resolvePageJobs(year, targets, { sampleIds: opt('sample')?.split(','), golden: args.includes('--golden'), documentUrl: opt('document'), page: Number(opt('page')) });
  if (error) return usageError(error);
  const observations = loadHumanObservations(year);
  console.log(`=== SourceToken PoC: year=${year} jobs=${jobs.length} ===`);
  for (const job of jobs) {
    try {
      await runJob(year, job, observations[job.id] ?? []);
    } catch (e) {
      console.error(`\n[${job.id}] failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

main();
