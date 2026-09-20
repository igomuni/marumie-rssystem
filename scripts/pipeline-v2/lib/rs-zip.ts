import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import { parseCsv } from './csv';

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

/** ZIP内の唯一のCSVエントリを読む */
export function readSingleCsv(zipPath: string): { entry: string; rows: Record<string, string>[] } {
  const entries = listZipEntries(zipPath).filter(e => e.toLowerCase().endsWith('.csv')).sort();
  if (entries.length === 0) throw new Error(`CSVが見つかりません: ${zipPath}`);
  const entry = entries[0];
  return { entry, rows: parseCsv(readZipEntryText(zipPath, entry)) };
}

/** rssystem.go.jp/download-csv、sheets配下から利用可能な年度を検出する */
export function discoverRsYears(rawRoot: string, years?: Set<number>): number[] {
  const found = new Set<number>();
  for (const base of [
    path.join(rawRoot, 'rssystem.go.jp', 'download-csv'),
    path.join(rawRoot, 'rssystem.go.jp', 'sheets'),
  ]) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      if (/^\d+$/.test(name) && fs.statSync(path.join(base, name)).isDirectory()) found.add(Number(name));
    }
  }
  const all = [...found].sort((a, b) => a - b);
  return years ? all.filter(y => years.has(y)) : all;
}
