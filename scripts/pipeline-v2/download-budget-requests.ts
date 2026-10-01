/**
 * 概算要求（歳出概算要求書）PDFを、manifestに従って `data/download/{publisherDomain}/{URL path}` へ
 * 原本のまま保存する（Pipeline V2 download層）。URLはmanifestに固定済みのものだけを使い、推測しない。
 *
 * 取得順: canonical URL direct fetch → manifest明示のacquisitionFallbacks
 *         → allowPlaywrightFallback付きtargetのみ browser acquisition（canonical URL、1回）。
 * acquisitionPolicy=manual-required のtargetは、valid cacheが無ければnetworkへ出ず manual-required と表示する
 * （人手で所定pathへPDFを置けば次回から cached）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/download-budget-requests.ts [year] [--dry-run] [--only=domain,domain]
 *   （年度省略時は 2024。manifest未定義の年度はエラー）
 *   --dry-run: network access・file書き込みをせず、targetと保存先の一覧だけを表示する
 *   --only:    publisherDomainで対象を絞る（例: --only=ndl.go.jp,mof.go.jp）
 */
import {
  defaultDeps,
  downloadAll,
  expandTargets,
  localPathFor,
  summarizeResults,
  type BudgetRequestDownloadResult,
  type BudgetRequestDownloadTarget,
} from './lib/budget-request-download';
import { createPlaywrightAcquirer } from './lib/budget-request-browser';
import { getBudgetRequestManifest, validateBudgetRequestManifest } from './lib/budget-request-manifest';

const USAGE = `usage: download-budget-requests.ts [year] [--dry-run] [--only=domain,domain]
  year        対象年度（省略時 2024。manifest未定義の年度はエラー）
  --dry-run   network access・file書き込みなしでtargetと保存先を表示
  --only=     publisherDomainで絞る（例: --only=ndl.go.jp,mof.go.jp）`;

function label(t: BudgetRequestDownloadTarget): string {
  return t.kind === 'reference'
    ? `${t.publisherAuthority} [reference:${t.purpose}]`
    : `${t.publisherAuthority} ${t.logicalAuthority ? `${t.logicalAuthority} ` : ''}${t.account}${t.role ? ` (${t.role})` : ''}`;
}

function printResult(t: BudgetRequestDownloadTarget, r: BudgetRequestDownloadResult): void {
  const kb = r.bytes !== undefined ? ` ${(r.bytes / 1024).toFixed(0)}KB` : '';
  const via = r.status === 'downloaded' ? ` via ${r.acquisitionMethod}/${r.transport}` : '';
  console.log(`  [${r.status}]${via}${kb} ${label(t)}\n      ${r.canonicalUrl}\n      → ${r.localPath}`);
  if (r.status === 'downloaded' && r.acquisitionUrl !== r.canonicalUrl) console.log(`      acquisition: ${r.acquisitionUrl}`);
  if (r.status === 'downloaded' && r.finalUrl && r.finalUrl !== r.acquisitionUrl) console.log(`      final: ${r.finalUrl}`);
  if (r.invalidCache) console.log('      (既存ファイルがPDFとして不正だったため再取得)');
  if (r.error) console.error(`      error: ${r.error}`);
}

function dryRun(targets: BudgetRequestDownloadTarget[]): void {
  const paths = new Set<string>();
  const urls = new Set<string>();
  let problems = 0;
  for (const t of targets) {
    let localPath: string;
    try {
      localPath = localPathFor(t.canonicalUrl, t.publisherDomain);
    } catch (e) {
      localPath = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      problems++;
    }
    if (paths.has(localPath) || urls.has(t.canonicalUrl)) problems++;
    paths.add(localPath);
    urls.add(t.canonicalUrl);
    const what = t.kind === 'document' ? `${t.account}${t.logicalAuthority ? `/${t.logicalAuthority}` : ''}` : t.purpose;
    console.log(
      `  ${t.kind} | ${t.publisherAuthority} | ${what} | fallbacks=${t.acquisitionFallbacks?.length ?? 0} playwright=${t.allowPlaywrightFallback ? 'allowed' : '-'}${t.acquisitionPolicy === 'manual-required' ? ' MANUAL-REQUIRED' : ''}\n` +
        `      ${t.canonicalUrl}\n      → ${localPath}`,
    );
  }
  console.log(
    `\n--- dry-run: document targets=${targets.filter(t => t.kind === 'document').length} reference targets=${targets.filter(t => t.kind === 'reference').length} ` +
      `total targets=${targets.length} unique local paths=${paths.size} unique canonical urls=${urls.size} ` +
      `fallback targets=${targets.filter(t => t.acquisitionFallbacks?.length).length} Playwright allowed targets=${targets.filter(t => t.allowPlaywrightFallback).length} ` +
      `manual-required targets=${targets.filter(t => t.acquisitionPolicy === 'manual-required').length} problems=${problems} ---`,
  );
  if (problems > 0) process.exitCode = 1;
}

/** direct試行の失敗分類（HTTP statusがあればそれ、無ければkind） */
function failureClass(r: BudgetRequestDownloadResult): string {
  const a = r.attempts?.[0];
  if (!a) return 'none';
  return a.httpStatus !== undefined ? `${a.kind}:${a.httpStatus}` : a.kind;
}

function printReport(targets: BudgetRequestDownloadTarget[], results: BudgetRequestDownloadResult[]): void {
  const by = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
  const ok = results.filter(r => r.status === 'downloaded');
  console.log(`\n[acquisition method/transport] ${JSON.stringify(by(ok, r => `${r.acquisitionMethod}/${r.transport}`))}`);
  console.log(`[invalid cache] ${results.filter(r => r.invalidCache).length}`);
  const bad = results.filter(r => r.status === 'failed' || r.status === 'playwright-required');
  const STATUSES = ['downloaded', 'cached', 'manual-required', 'failed', 'playwright-required'];
  console.log(`[failure class (direct attempt)] ${JSON.stringify(by(bad, failureClass))}`);

  console.log('\n[redirect] (finalUrl != acquisitionUrl)');
  for (const r of results) {
    if (r.finalUrl && r.finalUrl !== r.acquisitionUrl) console.log(`  ${r.canonicalUrl}\n    final: ${r.finalUrl} (HTTP ${r.httpStatus})`);
  }

  console.log(`\n[by domain] ${STATUSES.join('/')}`);
  const dom: Record<string, number[]> = {};
  results.forEach((r, i) => {
    const d = (dom[targets[i].publisherDomain] ??= STATUSES.map(() => 0));
    d[STATUSES.indexOf(r.status)]++;
  });
  for (const [d, c] of Object.entries(dom)) console.log(`  ${d}: ${c.join('/')}`);

  console.log('\n[top 10 bytes]');
  [...results].filter(r => r.bytes).sort((a, b) => b.bytes! - a.bytes!).slice(0, 10).forEach(r => console.log(`  ${(r.bytes! / 1048576).toFixed(1)}MB ${r.canonicalUrl}`));

  for (const [title, status] of [['failed', 'failed'], ['playwright-required', 'playwright-required'], ['manual-required', 'manual-required']] as const) {
    console.log(`\n[${title}]`);
    results.forEach((r, i) => {
      if (r.status !== status) return;
      console.log(`  ${targets[i].publisherAuthority} ${r.canonicalUrl}\n    ${status === 'manual-required' ? `→ ${r.localPath}` : r.attempts?.map(a => `${a.method}/${a.transport}: ${a.error}${a.contentType ? ` [${a.contentType}]` : ''}`).join(' → ') ?? r.error}`);
    });
  }
}

function usageError(message: string): void {
  console.error(`${message}\n${USAGE}`);
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a.startsWith('--') && a !== '--dry-run' && !a.startsWith('--only='));
  const positional = args.filter(a => !a.startsWith('--'));
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  if (unknown.length > 0) return usageError(`unknown option: ${unknown.join(' ')}`);
  if (positional.length > 1 || (positional[0] !== undefined && !/^\d{4}$/.test(positional[0]))) {
    return usageError(`year must be a 4-digit fiscal year: ${positional.join(' ')}`);
  }
  const isDryRun = args.includes('--dry-run');
  const onlyArg = args.find(a => a.startsWith('--only='))?.slice('--only='.length);
  if (onlyArg !== undefined && onlyArg === '') return usageError('--only= requires domain(s)');
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

  const targets = expandTargets(manifest).filter(t => !only || only.includes(t.publisherDomain));
  console.log(`\n=== 概算要求PDF: year=${year} targets=${targets.length}${isDryRun ? ' (dry-run)' : ''} ===`);
  if (isDryRun) return dryRun(targets);
  const browser = createPlaywrightAcquirer(); // browserは初回の取得時に初めて起動する
  let results: BudgetRequestDownloadResult[];
  try {
    results = await downloadAll(targets, { ...defaultDeps(), browserAcquire: browser.acquire }, printResult);
  } finally {
    await browser.close();
  }
  printReport(targets, results);

  const s = summarizeResults(results);
  console.log(
    `\n--- 合計: downloaded=${s.downloaded} cached=${s.cached} manual-required=${s['manual-required']} failed=${s.failed} playwright-required=${s['playwright-required']} total=${results.length} ---`,
  );
  // manual-requiredは「分類済みで人手が必要」な状態でありエラーではない。failed/playwright-requiredのみ非0終了
  if (s.failed > 0 || s['playwright-required'] > 0) process.exitCode = 1;
}

main();
