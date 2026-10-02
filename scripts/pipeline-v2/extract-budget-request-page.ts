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
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import {
  EXTRACTION_WORK_DIR,
  goldenSamplePath,
  humanObservationsPath,
  inspectTarget,
  listExtractionTargets,
  resolveGoldenSamples,
  type ExtractionTarget,
  type GoldenSampleFile,
} from './lib/budget-request-extraction';
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

interface Job {
  id: string;
  target: ExtractionTarget;
  page: number;
  sample?: { id: string; tier: string };
}

async function runJob(year: number, job: Job, observations: HumanObservation[]): Promise<void> {
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

  const jobs: Job[] = [];
  const sampleIds = opt('sample')?.split(',');
  const documentUrl = opt('document');
  if (!sampleIds && !args.includes('--golden') && !documentUrl) return usageError('--sample= / --golden / --document= のいずれかが必要です');

  if (sampleIds || args.includes('--golden')) {
    const gsPath = goldenSamplePath(year);
    if (!fs.existsSync(gsPath)) return usageError(`Golden Sample fixtureがありません: ${gsPath}`);
    const { resolved, problems } = resolveGoldenSamples(JSON.parse(fs.readFileSync(gsPath, 'utf8')) as GoldenSampleFile, targets);
    if (problems.length > 0) return usageError(`Golden Sample fixtureに問題があります:\n  ${problems.join('\n  ')}`);
    const picked = sampleIds ? sampleIds.map(id => resolved.find(r => r.sample.id === id) ?? null) : resolved;
    const missing = sampleIds?.filter((_, i) => picked[i] === null);
    if (missing?.length) return usageError(`未知のGolden Sample id: ${missing.join(', ')}（有効: ${resolved.map(r => r.sample.id).join(', ')}）`);
    for (const r of picked) if (r) jobs.push({ id: r.sample.id, target: r.target, page: r.sample.pdfPage, sample: { id: r.sample.id, tier: r.sample.tier } });
  }
  if (documentUrl) {
    const target = targets.find(t => t.canonicalUrl === documentUrl);
    const page = Number(opt('page'));
    if (!target) return usageError(`manifestに無いcanonical URLです: ${documentUrl}`);
    if (!Number.isInteger(page) || page < 1) return usageError('--page= には1以上の整数が必要です');
    jobs.push({ id: `${path.basename(target.localPath, '.pdf')}-p${page}`, target, page });
  }

  const obsPath = humanObservationsPath(year);
  const observations: Record<string, HumanObservation[]> = fs.existsSync(obsPath)
    ? (JSON.parse(fs.readFileSync(obsPath, 'utf8')) as { observations: Record<string, HumanObservation[]> }).observations
    : {};
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
