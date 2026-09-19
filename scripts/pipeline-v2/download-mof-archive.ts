/**
 * 財務省「予算書・決算書データベース」年度別アーカイブ
 * （`https://www.bb.mof.go.jp/archive/reiwa{N}.html`）に掲載された全リンク
 * （PDF・XML・Excel・CSV ZIP）を取得し、
 * `data/download/mof.go.jp/archive/{year}/` へ原本のまま保存する。
 *
 * Pipeline V2 download層。帳票ID・様式は年度によって増減する（決算は当該年度が
 * 締まってから追加される等）ため、IDを決め打ちせずアーカイブページの実リンクを
 * その都度パースする（generate-mof-jikou-data.ts が bxsselect.html の目次を
 * 都度パースするのと同じ考え方）。
 *
 * 注意: 「XML版」リンク（`*Main.html`）は本文XMLではなく、実データを別URL
 * （`{id}menu.html`目次 → `../xml/*.xml`）へ読み込むフレームセットの入れ物
 * （1KB程度）。本文XMLは1帳票あたり最大300〜400ファイルに分割され、
 * generate-mof-jikou-data.ts（V1）が既に `data/download/mof_{year}/xml/` に
 * キャッシュ済みのため、本スクリプトでは追わない（2026-09-19判断）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/download-mof-archive.ts [year...]
 *   （年度省略時は 2024 2025。年度→令和年号は year - 2018 で変換）
 */
import * as fs from 'fs';
import * as path from 'path';

const FETCH_TIMEOUT_MS = 30_000;
const THROTTLE_MS = 1_000;

async function throttle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, THROTTLE_MS));
}

function reiwaNameFor(year: number): string {
  const n = year - 2018;
  if (n <= 0) throw new Error(`令和年度に変換できません: year=${year}`);
  return `reiwa${n}`;
}

/** アーカイブページHTMLから `/server/...` へのリンクだけを抽出する */
function extractServerLinks(html: string): { href: string; text: string }[] {
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const out: { href: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href.startsWith('/server/')) continue;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    out.push({ href, text });
  }
  return out;
}

interface DownloadResult {
  href: string;
  text: string;
  status: 'downloaded' | 'cached' | 'failed';
  bytes?: number;
  error?: string;
}

async function downloadOne(href: string, text: string, outRoot: string): Promise<DownloadResult> {
  // href例: /server/2024/csv/DL202411001.zip -> outRoot配下に同じ相対パスで保存
  const relPath = href.replace(/^\/server\//, '');
  const outPath = path.join(outRoot, relPath);
  if (fs.existsSync(outPath)) return { href, text, status: 'cached', bytes: fs.statSync(outPath).size };
  await throttle();
  try {
    const res = await fetch(`https://www.bb.mof.go.jp${href}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { href, text, status: 'failed', error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return { href, text, status: 'downloaded', bytes: buf.length };
  } catch (e) {
    return { href, text, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

async function processYear(year: number): Promise<number> {
  const reiwa = reiwaNameFor(year);
  const archiveUrl = `https://www.bb.mof.go.jp/archive/${reiwa}.html`;
  console.log(`\n=== MOF archive download: year=${year} (${reiwa}) ===`);
  await throttle();
  const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    console.error(`  アーカイブページ取得失敗: HTTP ${res.status} ${archiveUrl}`);
    return 1;
  }
  const html = await res.text();
  const links = extractServerLinks(html);
  console.log(`  リンク ${links.length}件を検出`);

  const outRoot = path.join('data', 'download', 'mof.go.jp', 'archive', String(year));
  const results: DownloadResult[] = [];
  for (const { href, text } of links) {
    const result = await downloadOne(href, text, outRoot);
    results.push(result);
    const size = result.bytes !== undefined ? `${(result.bytes / 1024).toFixed(0)}KB` : '';
    console.log(`  [${result.status}] ${href} ${size} ${result.error ?? ''}`.trimEnd());
  }

  const failed = results.filter(r => r.status === 'failed');
  console.log(`合計 ${results.length}件: downloaded=${results.filter(r => r.status === 'downloaded').length} cached=${results.filter(r => r.status === 'cached').length} failed=${failed.length}`);
  if (failed.length > 0) console.error('失敗:', failed.map(f => `${f.href} (${f.error})`).join(', '));
  return failed.length;
}

async function main() {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024, 2025];

  let totalFailed = 0;
  for (const year of targetYears) totalFailed += await processYear(year);
  if (totalFailed > 0) process.exitCode = 1;
}

main();
