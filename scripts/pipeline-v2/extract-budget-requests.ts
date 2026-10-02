/**
 * 概算要求PDF Extraction工程の入力検査（基盤。PDF本文の解析はまだしない）。
 *
 * manifest（Downloaderと同じ）からdocument targetを列挙し、localPathの解決・原本の存在・
 * PDFとしての最低限の妥当性を確認して件数を集計する。原本PDFは読み取りのみ。
 *
 * 使い方: npx tsx scripts/pipeline-v2/extract-budget-requests.ts [year] [--only=domain,domain] [--write-inventory]
 *   --only=            publisherDomainで絞る
 *   --write-inventory  検査結果を data/work/budget-request-extraction/{year}/inventory.json へ書く（再生成可能）
 * 終了コード: MISSING / INVALID が1件でもあれば1（抽出に進めない状態）
 */
import * as fs from 'fs';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import {
  goldenSamplePath,
  inspectTarget,
  listExtractionTargets,
  resolveGoldenSamples,
  summarizeInspection,
  writeInventory,
  type GoldenSampleFile,
} from './lib/budget-request-extraction';
import { getBudgetRequestManifest, validateBudgetRequestManifest } from './lib/budget-request-manifest';

const USAGE = `usage: extract-budget-requests.ts [year] [--only=domain,domain] [--write-inventory]
  year               対象年度（省略時 2024。manifest未定義の年度はエラー）
  --only=            publisherDomainで絞る
  --write-inventory  検査結果を data/work/budget-request-extraction/{year}/inventory.json へ書く`;

function usageError(message: string): void {
  console.error(`${message}\n${USAGE}`);
  process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const unknown = args.filter(a => a.startsWith('--') && a !== '--write-inventory' && !a.startsWith('--only='));
  const positional = args.filter(a => !a.startsWith('--'));
  if (unknown.length > 0) return usageError(`unknown option: ${unknown.join(' ')}`);
  if (positional.length > 1 || (positional[0] !== undefined && !/^\d{4}$/.test(positional[0]))) {
    return usageError(`year must be a 4-digit fiscal year: ${positional.join(' ')}`);
  }
  const onlyArg = args.find(a => a.startsWith('--only='))?.slice('--only='.length);
  if (onlyArg === '') return usageError('--only= requires domain(s)');
  const only = onlyArg?.split(',');
  const year = positional[0] ? Number(positional[0]) : 2024;

  let manifest;
  try {
    manifest = getBudgetRequestManifest(year);
  } catch (e) {
    return usageError(e instanceof Error ? e.message : String(e));
  }
  const errors = validateBudgetRequestManifest(manifest);
  if (errors.length > 0) {
    console.error(`manifest validation error (${errors.length}件):\n${errors.map(e => `  - ${e}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  const allTargets = listExtractionTargets(manifest);
  const targets = allTargets.filter(t => !only || only.includes(t.publisherDomain));
  const items = targets.map(t => inspectTarget(t, nodeBudgetRequestFs));
  console.log(`\n=== 概算要求PDF extraction入力検査: year=${year} documents=${items.length} ===`);
  for (const i of items.filter(x => x.state !== 'FOUND')) console.log(`  [${i.state}] ${i.publisherAuthority} ${i.canonicalUrl}\n      → ${i.localPath}`);

  const dom: Record<string, [number, number, number]> = {};
  for (const i of items) {
    const d = (dom[i.publisherDomain] ??= [0, 0, 0]);
    d[['FOUND', 'MISSING', 'INVALID'].indexOf(i.state)]++;
  }
  console.log('\n[by domain] FOUND/MISSING/INVALID');
  for (const [d, c] of Object.entries(dom)) console.log(`  ${d}: ${c.join('/')}`);

  // Golden Sample locator（原本PDFを参照するだけ。正解データはまだ無い）
  const gsPath = goldenSamplePath(year);
  if (fs.existsSync(gsPath)) {
    const { resolved, problems } = resolveGoldenSamples(JSON.parse(fs.readFileSync(gsPath, 'utf8')) as GoldenSampleFile, allTargets);
    console.log(`\n[golden samples] ${gsPath}`);
    for (const { sample, target } of resolved) {
      const state = inspectTarget(target, nodeBudgetRequestFs).state;
      console.log(`  ${sample.tier.padEnd(8)} ${sample.id}: ${target.publisherDomain} page ${sample.pdfPage} [${state}] (${sample.groundTruthStatus})\n      → ${target.localPath}`);
    }
    for (const p of problems) console.error(`  golden sample problem: ${p}`);
    if (problems.length > 0) process.exitCode = 1;
  }

  if (args.includes('--write-inventory')) {
    try {
      console.log(`\ninventory: ${writeInventory(year, items, nodeBudgetRequestFs)}`);
    } catch (e) {
      console.error(`inventory write failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }

  const s = summarizeInspection(items);
  console.log(`\n--- Found: ${s.found}  Missing: ${s.missing}  Invalid: ${s.invalid}  (total ${s.total}) ---`);
  if (s.missing > 0 || s.invalid > 0) process.exitCode = 1;
}

main();
