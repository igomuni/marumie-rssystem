#!/usr/bin/env node
/**
 * サーバ関数バンドルのデータ同梱検査（Vercel 関数上限 250MB の再燃防止）。
 *
 * npm run build 後に .next/server 配下のファイルトレース結果（*.nft.json）を走査し、
 * 各関数がデータディレクトリから何を同梱するかを検査する:
 *   1. public/data の同梱は一切禁止（生 .json は展開後 96MB 級があり 250MB 超過が再発する）
 *   2. data/server は .gz と mof-budget-overview（.gz を持たない ~4KB）のみ許可
 *   3. includes（next.config.ts）が反映されず data/server 同梱が 0 件なら構成破綻として失敗
 * 経緯: PR #259、docs/tasks/20260718_1421_関数バンドル250MB問題の設計的回避.md
 *
 * 使い方: npm run build && npm run check-traces
 */
import fs from 'node:fs';
import path from 'node:path';

const SERVER_DIR = path.join(process.cwd(), '.next', 'server');
// data/server 内で生 .json のまま同梱を許可するファイル（.gz を持たない小容量ファイル）
const ALLOWED_RAW = new Set(['mof-budget-overview-2023.json']);

if (!fs.existsSync(SERVER_DIR)) {
  console.error('❌ .next/server がありません。先に npm run build を実行してください。');
  process.exit(1);
}

/** SERVER_DIR 以下の *.nft.json を再帰列挙 */
function collectNftFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectNftFiles(p));
    else if (entry.name.endsWith('.nft.json')) out.push(p);
  }
  return out;
}

const PUBLIC_DATA = `public${path.sep}data${path.sep}`;
const SERVER_DATA = `data${path.sep}server${path.sep}`;

let violations = 0;
let functionsWithBundleData = 0;

for (const nftPath of collectNftFiles(SERVER_DIR)) {
  const { files = [] } = JSON.parse(fs.readFileSync(nftPath, 'utf-8'));
  const nftDir = path.dirname(nftPath);
  const resolved = files.map((f) => path.resolve(nftDir, f));

  const publicHits = resolved.filter((f) => f.includes(PUBLIC_DATA));
  const serverHits = resolved.filter((f) => f.includes(SERVER_DATA));
  if (publicHits.length === 0 && serverHits.length === 0) continue;

  const fnName = path.relative(SERVER_DIR, nftPath).replace(/\.nft\.json$/, '');
  const badServer = serverHits.filter(
    (f) => !f.endsWith('.gz') && !ALLOWED_RAW.has(path.basename(f))
  );
  if (serverHits.length > 0) functionsWithBundleData++;
  console.log(`📦 ${fnName}: data/server ${serverHits.length}件, public/data ${publicHits.length}件`);
  for (const f of publicHits) {
    console.log(`   ❌ public/data が同梱されています: ${f.slice(f.indexOf(PUBLIC_DATA))}`);
    violations++;
  }
  for (const f of badServer) {
    console.log(`   ❌ 許可外の生 .json が同梱されています: ${f.slice(f.indexOf(SERVER_DATA))}`);
    violations++;
  }
}

if (functionsWithBundleData === 0) {
  console.error(
    '❌ data/server を同梱する関数が 0 件です。outputFileTracingIncludes が反映されていません。' +
    'next.config.ts と scripts/decompress-data.sh（prebuild の同期）を確認してください。'
  );
  process.exit(1);
}
if (violations > 0) {
  console.error(
    `\n❌ 違反 ${violations}件。next.config.ts の outputFileTracingExcludes/Includes と ` +
    'ローダの読み込みパス（app/lib/api/data-file.ts）を確認してください。'
  );
  process.exit(1);
}
console.log(
  `\n✅ 検査完了: data/server 同梱の関数 ${functionsWithBundleData}件、public/data の同梱なし`
);
