/**
 * 財務省「予算書・決算書データベース」年度別アーカイブ
 * （`https://www.bb.mof.go.jp/archive/reiwa{N}.html`）に掲載されたリンクのうち、
 * 帳票ごとにCSV ZIPを優先して取得し、`data/download/mof.go.jp/archive/{year}/`
 * へ原本のまま保存する。
 *
 * Pipeline V2 download層。帳票ID・様式は年度によって増減する（決算は当該年度が
 * 締まってから追加される等）ため、IDを決め打ちせずアーカイブページの実リンクを
 * その都度パースする（generate-mof-jikou-data.ts が bxsselect.html の目次を
 * 都度パースするのと同じ考え方）。
 *
 * 形式の選び方（2026-09-19判断。実データで確認したところ、csv/excel/dlpdfが
 * 存在する8帳票は3形式とも完全に同一内容だった。docs/tasks/
 * 20260919_1523_Pipeline_V2_downloadファイル一覧と重複分析.md参照）:
 *   - csv（ZIP）が存在する帳票 → csvのみ取得（excel・dlpdfは同一内容のため省略）
 *   - csvが存在しない帳票（決算参照・物品/債権現在額報告等） → dlpdfのみ取得
 *     （公式にCSV/Excel版が無く、PDFが唯一の入手経路のため）
 *   - html（`*Main.html`）は本文ではなく、実データを別URL
 *     （`{id}menu.html`目次 → `../xml/*.xml`）へ読み込むフレームセットの
 *     入れ物（1KB程度）。本文XMLは1帳票あたり最大300〜400ファイルに分割され、
 *     generate-mof-jikou-data.ts（V1）が既に `data/download/mof_{year}/xml/`
 *     にキャッシュ済みのため、常に取得しない
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

interface ArchiveLink {
  href: string;
  text: string;
  /** hrefの `/server/{yearDir}/{kind}/{file}` のkind部分 */
  kind: 'dlpdf' | 'html' | 'excel' | 'csv';
  /** ファイル名から様式・年度接尾辞を除いた帳票ID（同一帳票の形式違いをまとめる単位） */
  reportId: string;
}

/** アーカイブページHTMLから `/server/...` へのリンクだけを抽出する */
function extractServerLinks(html: string): ArchiveLink[] {
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const out: ArchiveLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href.startsWith('/server/')) continue;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const parts = href.split('/'); // '', 'server', yearDir, kind, file
    const kind = parts[3] as ArchiveLink['kind'];
    const file = parts[4] ?? '';
    const reportId = file.replace(/^DL/, '').replace(/(Main)?\.(pdf|xlsx|zip|html)$/, '');
    out.push({ href, text, kind, reportId });
  }
  return out;
}

/**
 * 帳票ID単位でcsvがあればcsvのみ、無ければdlpdfのみを残す
 * （excel・htmlは常に同一内容の重複/入れ物のため除外）。
 */
function selectLinksToDownload(links: ArchiveLink[]): ArchiveLink[] {
  const byReport = new Map<string, ArchiveLink[]>();
  for (const link of links) {
    const list = byReport.get(link.reportId) ?? [];
    list.push(link);
    byReport.set(link.reportId, list);
  }
  const selected: ArchiveLink[] = [];
  for (const group of byReport.values()) {
    const csv = group.filter(l => l.kind === 'csv');
    if (csv.length > 0) selected.push(...csv);
    else selected.push(...group.filter(l => l.kind === 'dlpdf'));
  }
  return selected;
}

interface DownloadResult {
  href: string;
  text: string;
  status: 'downloaded' | 'cached' | 'failed';
  bytes?: number;
  error?: string;
}

async function downloadOne({ href, text }: ArchiveLink, outRoot: string): Promise<DownloadResult> {
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
  const allLinks = extractServerLinks(html);
  const links = selectLinksToDownload(allLinks);
  console.log(`  リンク ${allLinks.length}件検出 → ${links.length}件を取得対象に選定（csv優先、無ければdlpdfのみ）`);

  const outRoot = path.join('data', 'download', 'mof.go.jp', 'archive', String(year));
  const results: DownloadResult[] = [];
  for (const link of links) {
    const result = await downloadOne(link, outRoot);
    results.push(result);
    const size = result.bytes !== undefined ? `${(result.bytes / 1024).toFixed(0)}KB` : '';
    console.log(`  [${result.status}] ${result.href} ${size} ${result.error ?? ''}`.trimEnd());
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
