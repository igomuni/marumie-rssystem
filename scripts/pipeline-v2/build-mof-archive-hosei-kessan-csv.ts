/**
 * MOF の archive の公式 CSV のうち、補正予算（`…21001` 一般、`…22001` 特別）と決算（`…77001` 一般、`…78001` 特別）の歳出（b.csv）を、
 * 原本の形のまま CSV にする（行はそのまま、`source_row` を足すだけ。値の補正・推測・足し算はしない）。当初予算の目（moku）の CSV と同じ作法。
 * 識別列（所管・組織／特別会計・勘定・項コード・各分類コード・項名・目名）は当初予算の目の CSV と同じ名前・順で、`項コード＋各分類コード` で結合できる。
 * 金額の列は原本の見出しのまま。補正は千円（成立予算額・補正の追加／修正減少／差引・改予算額）、決算は円（歳出予算額〜不用額）。
 * 入力の zip の SHA-256 が凍結値と違えば、何も出さずに止まる。原本の列の恒等式（補正: 改予算額＝成立予算額＋差引額 ほか。決算: 歳出予算現額・不用額）の成否を件数で報告する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-mof-archive-hosei-kessan-csv.ts <hosei|kessan> <2023|2024|2025|2026> <out-dir>
 * 出力: <out-dir>/moku-{general,special}-{hosei|kessan}.csv、summary.json
 */
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseCsv } from './build-mof-archive-kou-moku-csv';

const ARCHIVE = path.join('data', 'download', 'mof.go.jp', 'archive');
const FROZEN: Record<string, string> = {
  '2023/2023/csv/DL202321001.zip': '1f4c372b468f23c785d7116b216af84f7d1d474e46c7ced99ab89be4878b8d36',
  '2023/2023/csv/DL202322001.zip': '7ab3711b27b66488dd70a2844e03a948c3b2ad46e1578f982fecbc14acdc9023',
  '2024/2024/csv/DL202421001.zip': '26f9ccf138f5e277c38ec83ad872777e4123fcf7443dd5333d78c218da8a216b',
  '2024/2024/csv/DL202422001.zip': 'c96fbce1195da1148c8fa5aceca0a5197a3db818b49c74df44805578135dc5d9',
  '2025/2025/csv/DL202521001.zip': 'b0394b38ec5f252bd48ebcc6cb8f6c50c4605290ed94b3b22c285d478973b4a9',
  '2025/2025/csv/DL202522001.zip': 'bd2feaf0fca88ac24d7fa5f674cdb17299240487abb193273641fdbdc26d9ad5',
  '2026/2026/csv/DL202621001.zip': '5cf727069122e083ddecd3f8580e1d6b784d22dc37bbe4bef1183d3379a57e5a',
  '2023/2023/csv/DL202377001.zip': '608944c0d3a63b27ecae8b6352250cdb592f0afe49e545182d68b92fa9d37b79',
  '2023/2023/csv/DL202378001.zip': '9724040c3b76ce2543cb5c7d16647ccfdbfac44602e77c06c7477f9674406d7f',
  '2024/2024/csv/DL202477001.zip': '5536fd4f9477cf4ce312d74f9000c8822d979fc1098adefa645d49a6d1e187e4',
  '2024/2024/csv/DL202478001.zip': 'd51972865f25f9ce6f83f5d0f1fbd7b4a1e81ba64689e1cff51844b10048cc47',
};
type Kind = 'hosei' | 'kessan';
const DOC: Record<Kind, Record<'general' | 'special', string>> = { hosei: { general: '21001', special: '22001' }, kessan: { general: '77001', special: '78001' } };

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const cell = (v: string): string => (/[",\n\r]/u.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const fail = (m: string): never => { throw new Error(`STOP: ${m}`); };

function main(): void {
  const [kindArg, year, outDir] = process.argv.slice(2);
  if (!['hosei', 'kessan'].includes(kindArg ?? '') || !/^20\d\d$/.test(year ?? '') || !outDir) throw new Error('usage: build-mof-archive-hosei-kessan-csv.ts <hosei|kessan> <year> <out-dir>');
  const kind = kindArg as Kind;
  fs.mkdirSync(outDir, { recursive: true });
  const summary: Record<string, unknown> = { kind, year };
  for (const account of ['general', 'special'] as const) {
    const doc = `${year}${DOC[kind][account]}`;
    const rel = `${year}/${year}/csv/DL${doc}.zip`;
    const zp = path.join(ARCHIVE, rel);
    if (!fs.existsSync(zp)) { (summary as Record<string, unknown>)[account] = { status: 'no_csv_in_archive' }; continue; }
    if (!(rel in FROZEN)) fail(`${rel} has no frozen SHA-256`);
    if (sha256(fs.readFileSync(zp)) !== FROZEN[rel]) fail(`${rel} SHA-256 mismatch`);
    const raw = execFileSync('unzip', ['-p', zp, `DL${doc}b.csv`], { maxBuffer: 1 << 30 });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const all = parseCsv(text); const header = all[0]; const rows = all.slice(1).filter(r => r.length > 0);
    // 金額の列＝見出しが `(円)` か `(千円)` で終わる列（特別会計の決算には `予算総則の規定による経費増額` の列が 1 つ多い）
    const amountIx = header.map((h, i) => (/\((千円|円)\)$/.test(h) ? i : -1)).filter(i => i >= 0);
    const firstAmount = amountIx[0];
    if (amountIx.length === 0 || amountIx.some((i, k) => i !== firstAmount + k) || amountIx[amountIx.length - 1] !== header.length - 1) fail(`${rel} 金額の列が末尾に連続していない`);
    const num = (s: string): number | null => (/^-?\d+$/.test(s) ? Number(s) : null);
    for (const r of rows) {
      if (r.length !== header.length) fail(`${rel} row length ${r.length} != ${header.length}`);
      for (const i of amountIx) if (r[i] !== '' && num(r[i]) === null) fail(`${rel} 整数でない金額 ${JSON.stringify(r[i])}`);
    }
    // 原本の列の恒等式（成否の件数だけ報告。直さない）。列は見出しの名前で探す
    const col = (re: RegExp): number => { const i = amountIx.find(k => re.test(header[k])); if (i === undefined) fail(`${rel} 見出し ${re} がない`); return i as number; };
    const v = (r: string[], i: number) => num(r[i]) ?? 0;
    let holds = 0, fails = 0;
    if (kind === 'hosei') {
      const base = col(/成立予算額/), add = col(/追加額/), sub = col(/修正減少額/), diff = col(/差引額/), after = col(/^改/);
      for (const r of rows) (v(r, after) === v(r, base) + v(r, diff) && v(r, diff) === v(r, add) + v(r, sub) ? holds++ : fails++);
    } else {
      const base = col(/^歳出予算額/), current = col(/歳出予算現額/), paid = col(/支出済歳出額/), carry = col(/翌年度繰越額/), unused = col(/不用額/);
      for (const r of rows) {
        let between = 0; for (let i = base + 1; i < current; i++) between += v(r, i);
        (v(r, current) === v(r, base) + between && v(r, unused) === v(r, current) - v(r, paid) - v(r, carry) ? holds++ : fails++);
      }
    }
    const file = `moku-${account}-${kind}.csv`;
    fs.writeFileSync(path.join(outDir, file), [[...header, 'source_row'], ...rows.map((r, i) => [...r, String(i + 1)])].map(r => r.map(cell).join(',')).join('\n') + '\n');
    (summary as Record<string, unknown>)[account] = { zip: rel, zip_sha256: FROZEN[rel], rows: rows.length, amount_columns: header.slice(firstAmount), identity_holds: holds, identity_fails: fails };
  }
  fs.writeFileSync(path.join(outDir, `summary-${kind}.json`), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}

main();
