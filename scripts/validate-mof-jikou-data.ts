#!/usr/bin/env npx tsx
/**
 * 事項別内訳データの検証スクリプト
 *
 * `public/data/mof-jikou-{YEAR}.json` の帳票別合計を、同じ帳票の配布 CSV
 * （`data/download/mof_{YEAR}/DL{帳票ID}.zip` 内の `b.csv`）と突き合わせる。
 * Web 帳票のスクレイピングは列位置の取り違えで静かに壊れるため、
 * 生成のたびにこの検証を通すこと。
 *
 * 使用法:
 *   tsx scripts/validate-mof-jikou-data.ts [FISCAL_YEAR...]
 *   デフォルト: public/data にある mof-jikou-*.json の全年度
 *
 * 突き合わせの対応は docs/data-pipeline-guide.md 2-8節を参照。
 */

import * as fs from 'fs';
import * as path from 'path';
import { readZipEntryText } from '@/scripts/zip-reader';
import type { MOFJikouData, MOFJikouItem } from '@/types/mof-jikou';

/** 帳票ごとに「JSONのどの値」と「CSVのどの列」を突き合わせるか */
interface Check {
  /** JSON 側の集計対象。null を含む項目は無視する */
  field: 'amount' | 'currentAmount' | 'spent' | 'carriedOver' | 'unused' | 'difference';
  /** CSV の列名。前方一致で探す（年度が名前に入る列があるため） */
  column: string;
  /** CSV の値を円に直す倍率 */
  scale: number;
}

/** 帳票IDの末尾5桁 → 検証内容 */
const CHECKS: Record<string, Check[]> = {
  '11001': [{ field: 'amount', column: '令和', scale: 1000 }],
  '12001': [{ field: 'amount', column: '令和', scale: 1000 }],
  '13001': [{ field: 'amount', column: '令和', scale: 1000 }],
  '31001': [{ field: 'amount', column: '令和', scale: 1000 }],
  '32001': [{ field: 'amount', column: '令和', scale: 1000 }],
  '33001': [{ field: 'amount', column: '令和', scale: 1000 }],
  // 補正は事項別内訳に補正対象の事項しか載らないため、改予算額の合計は一致しない。
  // 増減（差引額）だけが全事項ぶんそろう。
  '21001': [{ field: 'difference', column: '補正要求差引額', scale: 1000 }],
  '22001': [{ field: 'difference', column: '補正予定差引額', scale: 1000 }],
  '77001': [
    { field: 'amount', column: '歳出予算額(円)', scale: 1 },
    { field: 'currentAmount', column: '歳出予算現額(円)', scale: 1 },
    { field: 'spent', column: '支出済歳出額(円)', scale: 1 },
    { field: 'carriedOver', column: '翌年度繰越額(円)', scale: 1 },
    { field: 'unused', column: '不用額(円)', scale: 1 },
  ],
};

/** CSV を行の配列にする（値にカンマを含まない単純な配布物なので分割で足りる） */
function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/** 歳出側の CSV（`b.csv`）を読む。a/b が入れ替わっている帳票があるので中身で判定する */
function readExpenditureCsv(zipPath: string, documentId: string): Array<Record<string, string>> {
  for (const suffix of ['b', 'a']) {
    const rows = parseCsv(readZipEntryText(zipPath, `DL${documentId}${suffix}.csv`));
    const headers = Object.keys(rows[0] ?? {});
    // 歳出側は主要経費別分類コードか使途別分類コードを持つ
    if (headers.some(h => h.includes('主要経費別分類') || h.includes('使途別分類'))) return rows;
  }
  throw new Error(`歳出側のCSVが見つかりません: ${zipPath}`);
}

function sumColumn(rows: Array<Record<string, string>>, prefix: string, scale: number): number {
  const header = Object.keys(rows[0] ?? {}).find(h => h.startsWith(prefix));
  if (!header) throw new Error(`列が見つかりません: ${prefix}`);
  return rows.reduce((sum, r) => sum + (parseInt(r[header] || '0', 10) || 0), 0) * scale;
}

function sumField(items: MOFJikouItem[], field: Check['field']): number {
  return items.reduce((sum, i) => sum + (i[field] ?? 0), 0);
}

function validateYear(year: number): { ok: boolean; checked: number } {
  const jsonPath = path.join(process.cwd(), 'public', 'data', `mof-jikou-${year}.json`);
  const data: MOFJikouData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const downloadDir = path.join(process.cwd(), 'data', 'download', `mof_${year}`);

  console.log(`\n=== ${data.metadata.eraLabel}（${year}）事項 ${data.summary.count} 件 ===`);
  let ok = true;
  let checked = 0;

  const byDocument = new Map<string, MOFJikouItem[]>();
  for (const item of data.items) {
    const list = byDocument.get(item.documentId);
    if (list) list.push(item);
    else byDocument.set(item.documentId, [item]);
  }

  for (const [documentId, items] of [...byDocument].sort()) {
    const checks = CHECKS[documentId.slice(4)];
    if (!checks) {
      console.log(`  ${documentId}: 検証対象外`);
      continue;
    }
    const zipPath = path.join(downloadDir, `DL${documentId}.zip`);
    if (!fs.existsSync(zipPath)) {
      console.log(`  ${documentId}: CSV未取得のためスキップ（${path.basename(zipPath)}）`);
      continue;
    }
    const rows = readExpenditureCsv(zipPath, documentId);
    for (const check of checks) {
      const actual = sumField(items, check.field);
      const expected = sumColumn(rows, check.column, check.scale);
      const match = actual === expected;
      if (!match) ok = false;
      checked += 1;
      console.log(
        `  ${match ? 'OK ' : 'NG '} ${documentId} ${check.field.padEnd(13)} ` +
          `JSON ${actual.toLocaleString().padStart(22)} / CSV ${expected.toLocaleString().padStart(22)}`
      );
    }
  }

  const duplicates = data.items.length - new Set(data.items.map(i => i.key)).size;
  if (duplicates > 0) {
    ok = false;
    console.log(`  NG  合成キーの重複 ${duplicates} 件`);
  }
  return { ok, checked };
}

function main() {
  const args = process.argv.slice(2).map(v => parseInt(v, 10));
  const years = args.length
    ? args
    : fs
        .readdirSync(path.join(process.cwd(), 'public', 'data'))
        .map(f => f.match(/^mof-jikou-(\d{4})\.json$/)?.[1])
        .filter((v): v is string => Boolean(v))
        .map(Number)
        .sort();

  if (years.length === 0) {
    console.error('検証対象がありません。npm run generate-mof-jikou を実行してください。');
    process.exit(1);
  }

  let ok = true;
  let checked = 0;
  for (const year of years) {
    const r = validateYear(year);
    ok = ok && r.ok;
    checked += r.checked;
  }
  console.log(`\n${ok ? '✅ 全一致' : '❌ 不一致あり'}（${checked} 項目を検証）`);
  if (!ok) process.exit(1);
}

main();
