import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import { parseCsv, parseCsvStream } from './csv';

/** `{code}_RS_{year}_...zip` にマッチする最初のZIPを探す（ラベル文言は年度で変わらない前提だが、
 *  念のため接頭辞一致にしている） */
export function findRsZip(yearDir: string, code: string, year: number): string | null {
  if (!fs.existsSync(yearDir)) return null;
  const prefix = `${code}_RS_${year}_`;
  const match = fs.readdirSync(yearDir)
    .filter(f => f.endsWith('.zip') && f.startsWith(prefix))
    .sort()[0];
  return match ? path.join(yearDir, match) : null;
}

function findSingleCsvEntry(zipPath: string): string {
  const entries = listZipEntries(zipPath).filter(e => e.toLowerCase().endsWith('.csv')).sort();
  if (entries.length === 0) throw new Error(`CSVが見つかりません: ${zipPath}`);
  return entries[0];
}

/** ZIP内の唯一のCSVエントリを読む */
export function readSingleCsv(zipPath: string): { entry: string; rows: Record<string, string>[] } {
  const entry = findSingleCsvEntry(zipPath);
  return { entry, rows: parseCsv(readZipEntryText(zipPath, entry)) };
}

/**
 * ZIP内の唯一のCSVエントリを、行オブジェクトのgeneratorとして読む。
 * ヘッダーはすぐに確定するが本体行は消費するまでメモリに載らない
 * （CSV row iterator→normalize generator→writeJsonlのstreaming経路の入口）。
 */
export function readSingleCsvIter(zipPath: string): { entry: string; headers: string[]; rows: Generator<Record<string, string>> } {
  const entry = findSingleCsvEntry(zipPath);
  const { headers, rows } = parseCsvStream(readZipEntryText(zipPath, entry));
  return { entry, headers, rows };
}

function yearDirsUnder(base: string): Set<number> {
  const found = new Set<number>();
  if (!fs.existsSync(base)) return found;
  for (const name of fs.readdirSync(base)) {
    if (/^\d+$/.test(name) && fs.statSync(path.join(base, name)).isDirectory()) found.add(Number(name));
  }
  return found;
}

/**
 * rssystem.go.jp/download-csv、sheets配下から利用可能な年度を検出する。
 * download-csvが無くsheetsのみの年度（例: 2026は本稿執筆時点でレビューシートのみ
 * 順次公開中でCSVバルクは未公開）は`sheetsOnlyYears`として区別する。
 * review-sheetsとのマージ（_merge_projects相当）が未実装のこのPoCでは、
 * sheets-onlyの年度をnormalize対象にすると「0件」という誤解を招く出力になるため、
 * 呼び出し側でdownloadCsvYearsのみを処理対象にする。
 */
export function discoverRsYears(rawRoot: string, years?: Set<number>): { downloadCsvYears: number[]; sheetsOnlyYears: number[] } {
  const downloadCsv = yearDirsUnder(path.join(rawRoot, 'rssystem.go.jp', 'download-csv'));
  const sheets = yearDirsUnder(path.join(rawRoot, 'rssystem.go.jp', 'sheets'));
  const filterFn = (y: number) => !years || years.has(y);
  return {
    downloadCsvYears: [...downloadCsv].filter(filterFn).sort((a, b) => a - b),
    sheetsOnlyYears: [...sheets].filter(y => !downloadCsv.has(y)).filter(filterFn).sort((a, b) => a - b),
  };
}
