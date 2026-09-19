/**
 * 財務省「決算の説明」（`https://www.mof.go.jp/policy/budget/budger_workflow/account/fy{year}/`）の
 * 一括ダウンロード版PDF（全体版）を取得し、
 * `data/download/mof.go.jp/account/fy{year}/` へ原本のまま保存する（`fy`接頭辞はURL
 * `account/fy{year}/`にそのまま合わせたもの。bb.mof.go.jpのarchive側はURLに
 * `fy`が無いため`archive/{year}/`のまま。ソースURLの表記にディレクトリ名を合わせる方針）。
 *
 * Pipeline V2 download層。bb.mof.go.jp/archive（download-mof-archive.ts）の
 * 予算書・決算書CSVとは別の情報源で、決算を歳出目的別（社会保障・防衛・公共事業等）に
 * 解説した文書。この文書にCSV/XML版は無く、PDFが唯一の公式配布形式
 * （個別章に分割した41ファイルもあるが、全体版1本で内容は網羅されるためこちらのみ取得）。
 *
 * 決算は当該年度終了から1年半ほど経ってから国会提出されるため（例:
 * 令和6年度決算は令和7年11月18日提出）、直近年度はまだ存在しないことがある。
 *
 * 使い方: npx tsx scripts/pipeline-v2/download-mof-account-explanation.ts [year...]
 *   （年度省略時は 2024 のみ。2025年度分は本稿執筆時点で未提出）
 */
import * as fs from 'fs';
import * as path from 'path';

const FETCH_TIMEOUT_MS = 30_000;

function eraCodeFor(year: number): string {
  const n = year - 2018;
  if (n <= 0) throw new Error(`令和年度に変換できません: year=${year}`);
  return String(n).padStart(2, '0');
}

async function downloadOne(year: number): Promise<boolean> {
  const era = eraCodeFor(year);
  const fileName = `kessan_${era}_zenntaibann.pdf`;
  const url = `https://www.mof.go.jp/policy/budget/budger_workflow/account/fy${year}/${fileName}`;
  const outDir = path.join('data', 'download', 'mof.go.jp', 'account', `fy${year}`);
  const outPath = path.join(outDir, fileName);

  if (fs.existsSync(outPath)) {
    console.log(`  [cached] ${fileName} ${(fs.statSync(outPath).size / 1024).toFixed(0)}KB`);
    return true;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`  [failed] ${fileName} HTTP ${res.status}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log(`  [downloaded] ${fileName} ${(buf.length / 1024).toFixed(0)}KB`);
    return true;
  } catch (e) {
    console.error(`  [failed] ${fileName} ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function main() {
  const years = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targetYears = years.length > 0 ? years : [2024];

  let ok = true;
  for (const year of targetYears) {
    console.log(`\n=== MOF決算の説明（全体版）: year=${year} ===`);
    ok = (await downloadOne(year)) && ok;
  }
  if (!ok) process.exitCode = 1;
}

main();
