/**
 * RSシステム「行政事業レビュー資料」（`https://rssystem.go.jp/sheets/{year}/{省庁slug}`）の
 * CSV/PDFを取得し、`data/download/rssystem.go.jp/sheets/{year}/{省庁slug}/` へ原本のまま保存する。
 *
 * Pipeline V2 download層。download-rs-csv.tsと異なり、このページはボタン押下時に
 * ブラウザ側でファイル名（省庁の正式名称込み）が生成されるため、URLを事前に
 * 組み立てられない。Playwrightで実際にページを開きボタンを押下して、発行される
 * 実リクエストURLを観測し、そのURLへ改めてfetchする。
 *
 * 省庁slug一覧・対象年度は`--discover`で毎回サイトから取得する（府省庁再編・
 * 新設に追従するため固定リストを持たない）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/download-rs-sheets.ts [year...]
 *   （年度省略時は 2024 2025）
 */
import * as fs from 'fs';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { writeFileAtomic } from './lib/atomic-write';

const NAV_TIMEOUT_MS = 20_000;
const THROTTLE_MS = 300;

async function throttle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, THROTTLE_MS));
}

/** `/sheets/{year}` から府省庁slug一覧を取得する */
async function discoverMinistrySlugs(page: Page, year: number): Promise<string[]> {
  await page.goto(`https://rssystem.go.jp/sheets/${year}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(800);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.getAttribute('href') ?? ''));
  const prefix = `/sheets/${year}/`;
  return [...new Set(hrefs.filter(h => h.startsWith(prefix)))].map(h => h.slice(prefix.length));
}

/**
 * 1府省庁ページを開き、CSVボタン押下で発行される実URLを集める。
 *
 * 各様式はCSV/PDFの両方が同一内容で提供されるが（全タイトルで完全に一致することを
 * 実データで確認済み。docs/tasks/20260919_1523_...参照）、PDFは非構造化で
 * パイプラインでは使わないためCSVのみ取得する（2026-09-19判断。130MB相当の
 * 重複ダウンロードを回避）。
 */
async function collectFileUrls(page: Page, year: number, slug: string): Promise<string[]> {
  const urls: string[] = [];
  const onRequest = (req: import('playwright').Request) => {
    const u = req.url();
    if (u.includes('/files/')) urls.push(u);
  };
  page.on('request', onRequest);
  try {
    await page.goto(`https://rssystem.go.jp/sheets/${year}/${slug}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(300);
    const buttons = await page.locator('button:has-text("CSV")').all();
    for (const b of buttons) {
      await Promise.all([
        page.waitForEvent('download', { timeout: 8_000 }).catch(() => null),
        b.click(),
      ]);
      await page.waitForTimeout(150);
    }
  } finally {
    page.off('request', onRequest);
  }
  return [...new Set(urls)];
}

interface DownloadResult {
  fileName: string;
  status: 'downloaded' | 'cached' | 'failed';
  bytes?: number;
  error?: string;
}

async function saveFile(url: string, outDir: string): Promise<DownloadResult> {
  const fileName = decodeURIComponent(url.split('/').pop() ?? 'unknown');
  const outPath = path.join(outDir, fileName);
  if (fs.existsSync(outPath)) return { fileName, status: 'cached', bytes: fs.statSync(outPath).size };
  await throttle();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { fileName, status: 'failed', error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(outDir, { recursive: true });
    writeFileAtomic(outPath, buf);
    return { fileName, status: 'downloaded', bytes: buf.length };
  } catch (e) {
    return { fileName, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

async function processYear(browser: Browser, year: number): Promise<void> {
  const page = await browser.newPage();
  const slugs = await discoverMinistrySlugs(page, year);
  console.log(`\n=== ${year}年度: 府省庁 ${slugs.length}件 ===`);

  let downloaded = 0, cached = 0, failed = 0;
  for (const slug of slugs) {
    const fileUrls = await collectFileUrls(page, year, slug);
    const outDir = path.join('data', 'download', 'rssystem.go.jp', 'sheets', String(year), slug);
    const results: DownloadResult[] = [];
    for (const url of fileUrls) results.push(await saveFile(url, outDir));
    downloaded += results.filter(r => r.status === 'downloaded').length;
    cached += results.filter(r => r.status === 'cached').length;
    const failedHere = results.filter(r => r.status === 'failed');
    failed += failedHere.length;
    console.log(`  [${slug}] ${fileUrls.length}件 (downloaded=${results.filter(r => r.status === 'downloaded').length} cached=${results.filter(r => r.status === 'cached').length} failed=${failedHere.length})`);
    if (failedHere.length > 0) console.error(`    失敗: ${failedHere.map(f => `${f.fileName} (${f.error})`).join(', ')}`);
  }
  console.log(`--- ${year}年度 合計: downloaded=${downloaded} cached=${cached} failed=${failed} ---`);
  await page.close();
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025];

  const browser = await chromium.launch();
  try {
    for (const year of targetYears) await processYear(browser, year);
  } finally {
    await browser.close();
  }
}

main();
