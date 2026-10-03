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
 *   - html（`*Main.html`）は、アーカイブ上で【XML版】と明示された予算書本体のフレームセット
 *     （`{id}menu.html`目次 → `../xml/*.xml`、1帳票あたり数百ファイル）。**既定では取得しない**
 *     （CSV/Excel=科目別内訳とは別の source role。CSV と XML は排他ではない）。
 *     取得は `--xml=<帳票ID,...>` で帳票を明示したときだけ（下記）
 *
 * XML版（予算書本体）の取得: `--xml=202411001`
 *   アーカイブの【XML版】リンク → `{id}Main.html` と `{id}menu.html` を原本のまま保存し、目次が列挙する
 *   `../xml/*.xml` を1件ずつ（1秒間隔）取得して、HTTP応答のbyte列を無加工で保存する。
 *   既存ファイルは上書きしない（cached）。V1のXMLキャッシュ・生成物は参照しない。
 *   由来（URL・bytes・SHA-256・取得時刻・HTTP応答ヘッダ）は `data/work/mof-xml-download/{year}/{id}.json`
 *   に記録する（原本ではないので data/download には置かない）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/download-mof-archive.ts [year...] [--xml=ID,ID] [--dry-run]
 *   （年度省略時は 2023 2024 2025。年度→令和年号は year - 2018 で変換。--dry-run は取得せず対象だけ表示）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic } from './lib/atomic-write';
import { extractServerLinks, parseMenuXmlFileNames, selectLinksToDownload, selectXmlDocumentLinks, xmlDocumentPaths, type ArchiveLink } from './lib/mof-archive-download';

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
    writeFileAtomic(outPath, buf);
    return { href, text, status: 'downloaded', bytes: buf.length };
  } catch (e) {
    return { href, text, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}


interface XmlFileRecord {
  url: string;
  localPath: string;
  status: 'downloaded' | 'cached' | 'failed';
  bytes?: number;
  sha256?: string;
  httpStatus?: number;
  contentType?: string | null;
  error?: string;
}

async function fetchRaw(url: string): Promise<{ buf: Buffer; httpStatus: number; contentType: string | null } | { error: string; httpStatus?: number }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    // 配信側は過剰アクセスを 404 で弾く（docs/mof-budget-data-guide.md 制約3）。失敗として扱い、空ファイルを保存しない
    if (!res.ok) return { error: `HTTP ${res.status}`, httpStatus: res.status };
    return { buf: Buffer.from(await res.arrayBuffer()), httpStatus: res.status, contentType: res.headers.get('content-type') };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** URL を1件取得し、HTTP応答の byte 列を無加工で outPath に保存する。既存ファイルは上書きしない */
async function downloadRawFile(url: string, outPath: string): Promise<XmlFileRecord> {
  if (fs.existsSync(outPath)) {
    const buf = fs.readFileSync(outPath);
    return { url, localPath: outPath, status: 'cached', bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  await throttle();
  const r = await fetchRaw(url);
  if ('error' in r) return { url, localPath: outPath, status: 'failed', error: r.error, httpStatus: r.httpStatus };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileAtomic(outPath, r.buf);
  return { url, localPath: outPath, status: 'downloaded', bytes: r.buf.length, sha256: crypto.createHash('sha256').update(r.buf).digest('hex'), httpStatus: r.httpStatus, contentType: r.contentType };
}

/** 【XML版】1帳票: Main.html・menu.html・目次が列挙する本文XMLを取得し、由来を data/work に記録する。失敗件数を返す */
async function downloadXmlDocument(year: number, link: ArchiveLink, outRoot: string, archiveUrl: string): Promise<number> {
  const { menuHref, xmlDirHref } = xmlDocumentPaths(link.href);
  const local = (href: string) => path.join(outRoot, href.replace(/^\/server\//, ''));
  const abs = (href: string) => `https://www.bb.mof.go.jp${href}`;
  console.log(`  [xml] ${link.reportId}: ${link.text}`);

  const main = await downloadRawFile(abs(link.href), local(link.href));
  const menu = await downloadRawFile(abs(menuHref), local(menuHref));
  const files: XmlFileRecord[] = [];
  if (menu.status === 'failed' || main.status === 'failed') {
    console.error(`    Main/menu 取得失敗: ${main.error ?? ''} ${menu.error ?? ''}`);
    return 1;
  }
  // 目次は EUC-JP。ファイル名の列挙にだけデコードして使い、保存するのは取得した byte 列のまま
  const names = parseMenuXmlFileNames(new TextDecoder('euc-jp').decode(fs.readFileSync(local(menuHref))));
  console.log(`    目次から本文XML ${names.length}件`);
  for (const name of names) {
    const rec = await downloadRawFile(abs(`${xmlDirHref}${name}`), local(`${xmlDirHref}${name}`));
    files.push(rec);
    if (rec.status === 'failed') console.error(`    [failed] ${name} ${rec.error ?? ''}`);
  }
  const failed = files.filter(f => f.status === 'failed').length;
  console.log(`    XML: downloaded=${files.filter(f => f.status === 'downloaded').length} cached=${files.filter(f => f.status === 'cached').length} failed=${failed}`);

  const manifest = {
    schemaVersion: 1,
    fiscalYear: year,
    reportId: link.reportId,
    sourceRole: 'budget-book-xml',
    archivePage: archiveUrl,
    archiveLinkText: link.text,
    downloadedAt: new Date().toISOString(),
    main, menu,
    xmlFileCount: files.length,
    xmlTotalBytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0),
    files,
  };
  const manifestPath = path.join('data', 'work', 'mof-xml-download', String(year), `${link.reportId}.json`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileAtomic(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  console.log(`    provenance: ${manifestPath}`);
  return failed;
}

async function processYear(year: number, xmlReportIds: string[], dryRun: boolean): Promise<number> {
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
  const xmlLinks = selectXmlDocumentLinks(allLinks, xmlReportIds);
  const missingXml = xmlReportIds.filter(id => !xmlLinks.some(l => l.reportId === id));
  if (missingXml.length > 0) { console.error(`  --xml に指定した帳票のXML版リンクがアーカイブに無い: ${missingXml.join(', ')}`); return 1; }
  if (dryRun) {
    for (const l of links) console.log(`  [dry-run] ${l.href}`);
    for (const l of xmlLinks) console.log(`  [dry-run][xml] ${l.href} (${l.text})`);
    return 0;
  }
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
  let xmlFailed = 0;
  for (const link of xmlLinks) xmlFailed += await downloadXmlDocument(year, link, outRoot, archiveUrl);
  return failed.length + xmlFailed;
}

async function main() {
  const args = process.argv.slice(2);
  const years = args.filter(a => !a.startsWith('--')).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2023, 2024, 2025];
  const xmlArg = args.find(a => a.startsWith('--xml='))?.slice('--xml='.length);
  const xmlReportIds = xmlArg ? xmlArg.split(',').map(x => x.trim()).filter(Boolean) : [];
  const dryRun = args.includes('--dry-run');
  if (xmlReportIds.length > 0 && targetYears.length !== 1) { console.error('--xml は年度を1つ指定したときだけ使えます（帳票IDは年度を含む）'); process.exitCode = 1; return; }

  let totalFailed = 0;
  for (const year of targetYears) totalFailed += await processYear(year, xmlReportIds, dryRun);
  if (totalFailed > 0) process.exitCode = 1;
}

main();
