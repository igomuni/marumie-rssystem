/**
 * RSシステム公開CSV（`https://rssystem.go.jp/download-csv/{year}`）のZIPを
 * 取得し、`data/download/rssystem.go.jp/download-csv/{year}/` へ原本のまま保存する。
 *
 * Pipeline V2 download層。カラム変換・展開・統合は行わない（取得した原本を
 * 可能な限りそのまま保存するのがdownload層の役割。docs/tasks配下の
 * 20260919_Pipeline_V2基盤整備_実装タスク.md 3節を参照）。
 *
 * URLは `https://rssystem.go.jp/files/{year}/rs/{no}_RS_{year}_{label}.zip`
 * という固定パターン（rssystem.go.jpの配布JSバンドルをPlaywrightで解析し、
 * download-csvページの各ZIPボタン押下時の実リクエストを観測して特定。
 * 認証不要・APIキー不要の静的ファイル配信）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/download-rs-csv.ts [year...]
 *   （年度省略時は 2024 2025。現行フォーマットのRSデータは2024年度以降のみ）
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic } from './lib/atomic-write';

const FETCH_TIMEOUT_MS = 30_000;
const THROTTLE_MS = 500;

/** download-csvページに並ぶ14グループ。no・labelは配布ファイル名の該当部分そのもの */
const RS_CSV_GROUPS: { no: string; label: string }[] = [
  { no: '1-1', label: '基本情報_組織情報' },
  { no: '1-2', label: '基本情報_事業概要等' },
  { no: '1-3', label: '基本情報_政策・施策、法令等' },
  { no: '1-4', label: '基本情報_補助率等' },
  { no: '1-5', label: '基本情報_関連事業' },
  { no: '2-1', label: '予算・執行_サマリ' },
  { no: '2-2', label: '予算・執行_予算種別・歳出予算項目' },
  { no: '3-1', label: '効果発現経路_目標・実績' },
  { no: '3-2', label: '効果発現経路_目標のつながり' },
  { no: '4-1', label: '点検・評価' },
  { no: '5-1', label: '支出先_支出情報' },
  { no: '5-2', label: '支出先_支出ブロックのつながり' },
  { no: '5-3', label: '支出先_費目・使途' },
  { no: '5-4', label: '支出先_国庫債務負担行為等による契約' },
  { no: '6-1', label: 'その他備考' },
];

function fileNameFor(year: number, no: string, label: string): string {
  return `${no}_RS_${year}_${label}.zip`;
}

function urlFor(year: number, fileName: string): string {
  return `https://rssystem.go.jp/files/${year}/rs/${encodeURIComponent(fileName)}`;
}

async function throttle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, THROTTLE_MS));
}

interface DownloadResult {
  no: string;
  fileName: string;
  status: 'downloaded' | 'cached' | 'failed';
  bytes?: number;
  error?: string;
}

async function downloadOne(year: number, no: string, label: string, outDir: string): Promise<DownloadResult> {
  const fileName = fileNameFor(year, no, label);
  const outPath = path.join(outDir, fileName);
  if (fs.existsSync(outPath)) {
    return { no, fileName, status: 'cached', bytes: fs.statSync(outPath).size };
  }
  await throttle();
  try {
    const res = await fetch(urlFor(year, fileName), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { no, fileName, status: 'failed', error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(outDir, { recursive: true });
    writeFileAtomic(outPath, buf);
    return { no, fileName, status: 'downloaded', bytes: buf.length };
  } catch (e) {
    return { no, fileName, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

async function processYear(year: number): Promise<number> {
  const outDir = path.join('data', 'download', 'rssystem.go.jp', 'download-csv', String(year));
  console.log(`\n=== RS CSV download: year=${year} outDir=${outDir} ===`);

  const results: DownloadResult[] = [];
  for (const { no, label } of RS_CSV_GROUPS) {
    const result = await downloadOne(year, no, label, outDir);
    results.push(result);
    const size = result.bytes !== undefined ? `${(result.bytes / 1024).toFixed(0)}KB` : '';
    console.log(`  [${result.status}] ${result.fileName} ${size} ${result.error ?? ''}`.trimEnd());
  }

  const failed = results.filter(r => r.status === 'failed');
  console.log(`合計 ${results.length}件: downloaded=${results.filter(r => r.status === 'downloaded').length} cached=${results.filter(r => r.status === 'cached').length} failed=${failed.length}`);
  if (failed.length > 0) console.error('失敗したファイルがあります:', failed.map(f => f.fileName).join(', '));
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
