/**
 * MOF の archive の公式 CSV（DL{年}{帳票}.zip の b.csv＝歳出）から、項・目の CSV を作る（原本の形のまま。値の補正・推測はしない）。
 * 目は b.csv の行そのもの（`source_row` を足すだけ）、項は目を項のキーで集計したもの（目の行数・当年度・前年度の合計）。
 * 入力の zip の SHA-256 が凍結値と違えば、何も出さずに止まる。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-mof-archive-kou-moku-csv.ts <2024|2025|2025_teishutsu> <out-dir>
 * 出力: <out-dir>/{kou,moku}-{general,special}.csv、summary.json
 */
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ARCHIVE = path.join('data', 'download', 'mof.go.jp', 'archive');
const FROZEN: Record<string, string> = {
  '2023/2023/csv/DL202311001.zip': '5b37cafbed02f78b04a283ea9bd264e201b0fd7d47a684c09006121999056298',
  '2023/2023/csv/DL202312001.zip': '0c4571da22aeede17b30a3e9f7cfe1885923b9c5266c31a0f5233237affd43d4',
  '2026/2026/csv/DL202611001.zip': '7d4ed867c12c82d4a9581aed6c951ec93527d9d353ec4292fa21f49aa01ab808',
  '2026/2026/csv/DL202612001.zip': 'bead1d1305ced67d198e3ccae4a3091ef2ce5e2a5e284c6adc5deda3dca32fc6',
  '2024/2024/csv/DL202411001.zip': '234bd440ac8647a07e458e3609457d00a133ffbbef2fc766b1421e1c5510e06f',
  '2024/2024/csv/DL202412001.zip': '48392740ce2a8b83c6e3af0141f37e3ebeebd268466890a506658fa75487603c',
  '2025/2025/csv/DL202511001.zip': 'ad3e482a8c2102f29e8ccd1fc2484b4144650993781cd9c53e2b7a66166cdc2d',
  '2025/2025/csv/DL202512001.zip': '7332b8691a2fecf625338785d4972f879e45236698fe4a58ea60fdbd17982e15',
  '2025/2025_teishutsu/csv/DL202511001.zip': '8af4d9f0b5f0d38fdee72f67b458e39bfa9c016b7f3f789009abf29a31cbadc7',
  '2025/2025_teishutsu/csv/DL202512001.zip': '4031d7f9e387ed2211156cb9168e5dba2d42078f2899c153ce92c503886f8766',
};
/** version → (csv の置き場, 帳票 ID の年部分) */
const VERSIONS: Record<string, { dir: string; year: string }> = {
  '2023': { dir: '2023/2023/csv', year: '2023' },
  '2026': { dir: '2026/2026/csv', year: '2026' },
  '2024': { dir: '2024/2024/csv', year: '2024' },
  '2025': { dir: '2025/2025/csv', year: '2025' },
  '2025_teishutsu': { dir: '2025/2025_teishutsu/csv', year: '2025' },
};
type Account = 'general' | 'special';
const ACCOUNTS: Record<Account, string> = { general: '11001', special: '12001' };
/** 項のキーにする列（原本の見出し） */
const KOU_KEY: Record<Account, string[]> = {
  general: ['所管', '組織', '項コード', '項名'],
  special: ['所管', '特別会計', '勘定', '項コード', '項名', '共管所管名', '共管組織名'],
};

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const fail = (m: string): never => { throw new Error(`STOP: ${m}`); };

/** RFC 4180 の CSV を行の配列にする（引用符・引用符内の改行・"" のエスケープ） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; }
    else if (c === ',') { row.push(field); field = ''; i++; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else { field += c; i++; }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** 区切り・引用符・改行を含むときだけ引用符で囲む（Python の csv.writer の QUOTE_MINIMAL と同じ） */
const cell = (v: string | number): string => { const s = String(v); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (header: string[], rows: (string | number)[][]): string => [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n';

function readB(zipPath: string, name: string): { header: string[]; rows: string[][] } {
  const raw = execFileSync('unzip', ['-p', zipPath, name], { maxBuffer: 1 << 30 });
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const all = parseCsv(text);
  return { header: all[0], rows: all.slice(1).filter(r => r.length > 0) };
}

function main(): void {
  const [version, outDir] = process.argv.slice(2);
  const v = VERSIONS[version ?? ''];
  if (!v || !outDir) throw new Error(`usage: build-mof-archive-kou-moku-csv.ts <${Object.keys(VERSIONS).join('|')}> <out-dir>`);
  const zips = (Object.entries(ACCOUNTS) as [Account, string][]).map(([account, doc]) => ({ account, doc, rel: `${v.dir}/DL${v.year}${doc}.zip` }));
  for (const z of zips) if (sha256(fs.readFileSync(path.join(ARCHIVE, z.rel))) !== FROZEN[z.rel]) fail(`${z.rel} SHA-256 mismatch`);
  fs.mkdirSync(outDir, { recursive: true });
  const summary: Record<string, unknown> = { version, inputs: {} };
  for (const { account, doc, rel } of zips) {
    const { header, rows } = readB(path.join(ARCHIVE, rel), `DL${v.year}${doc}b.csv`);
    const ix = new Map(header.map((h, i) => [h, i]));
    const keyCols = KOU_KEY[account];
    const miss = keyCols.filter(c => !ix.has(c));
    if (miss.length) fail(`${rel} lacks columns ${miss.join(',')}`);
    const cur = header.length - 3, prv = header.length - 2; // 末尾3列が 当年度・前年度・比較増△減（見出しは版で違う）
    const int = (s: string): number => { if (!/^-?\d+$/.test(s)) fail(`${rel} 整数でない値 ${JSON.stringify(s)}`); return Number(s); };
    for (const r of rows) {
      if (r.length !== header.length) fail(`${rel} row length ${r.length} != ${header.length}`);
      for (const i of [cur, prv, cur + 2]) int(r[i]);
    }
    // 項（文書順の最初の出現順）
    const kou = new Map<string, { key: string[]; rows: number; cur: number; prv: number }>();
    for (const r of rows) {
      const key = keyCols.map(c => r[ix.get(c)!]);
      const k = JSON.stringify(key);
      const e = kou.get(k) ?? { key, rows: 0, cur: 0, prv: 0 };
      e.rows++; e.cur += int(r[cur]); e.prv += int(r[prv]); kou.set(k, e);
    }
    if (account === 'special') { // 共管の列は1つの項の中で一定でなければならない
      const base = new Map<string, Set<string>>();
      for (const e of kou.values()) { const b = JSON.stringify(e.key.slice(0, 5)); (base.get(b) ?? base.set(b, new Set()).get(b)!).add(JSON.stringify(e.key.slice(5))); }
      const bad = [...base].filter(([, s]) => s.size > 1).map(([b]) => b);
      if (bad.length) fail(`${rel} 共管 columns vary within a 項: ${bad.slice(0, 3).join(' ')}`);
    }
    fs.writeFileSync(path.join(outDir, `kou-${account}.csv`), toCsv([...keyCols, '目の行数', `${header[cur]}の合計`, `${header[prv]}の合計`], [...kou.values()].map(e => [...e.key, e.rows, e.cur, e.prv])));
    fs.writeFileSync(path.join(outDir, `moku-${account}.csv`), toCsv([...header, 'source_row'], rows.map((r, n) => [...r, String(n + 1)])));
    const totCur = rows.reduce((s, r) => s + int(r[cur]), 0), totPrv = rows.reduce((s, r) => s + int(r[prv]), 0);
    if (totCur !== [...kou.values()].reduce((s, e) => s + e.cur, 0) || totPrv !== [...kou.values()].reduce((s, e) => s + e.prv, 0)) fail(`${rel} 項の合計が総計と一致しない`);
    const topCols = account === 'general' ? ['所管', '組織'] : ['所管', '特別会計'];
    summary[account] = {
      zip: rel, zip_sha256: FROZEN[rel], moku_rows: rows.length, kou: kou.size,
      所管: new Set(rows.map(r => r[ix.get('所管')!])).size,
      [account === 'general' ? '組織' : '特別会計']: new Set(rows.map(r => JSON.stringify(topCols.map(c => r[ix.get(c)!])))).size,
      columns: header, 'total_current(千円)': totCur, 'total_previous(千円)': totPrv, sum_of_kou_totals_equals_total: true,
    };
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const s = summary as Record<string, { moku_rows: number; kou: number }>;
  console.log(JSON.stringify({ version, general: { moku_rows: s.general.moku_rows, kou: s.general.kou }, special: { moku_rows: s.special.moku_rows, kou: s.special.kou } }));
}

if (require.main === module) main();
