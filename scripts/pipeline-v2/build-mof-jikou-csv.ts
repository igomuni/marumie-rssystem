/**
 * MOF 予算書【XML版】の事項を、素朴な CSV（jikou-general.csv）にする。FY2024 一般会計 当初予算（帳票 202411001）専用。
 * 読み取りは凍結済みの parser v0（lib/mof-budget-xml-items.ts）を変更せずに使い、jsonl・normalized・derived は経由しない。
 * 入力の境界は normalize-mof-jikou.ts と同じ（凍結済み source set の SHA-256、menu の XML 集合 328 = 94 + 234、生成結果 94 / 234 / 1,256）。
 * 契約: docs/tasks/20261015_0822_MOF_Archive_CSV_Primitives_Contract.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-mof-jikou-csv.ts <out-dir>
 * 出力: <out-dir>/jikou-general.csv（列は固定）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseMenuXmlFileNames } from './lib/mof-archive-download';
import { MOF_ITEM_PARSER_V0_DOCUMENT_ID, MofXmlParseError, parseMofBudgetXmlItemFile, readMenuAncestorChains } from './lib/mof-budget-xml-items';
import { assertExpectedPopulation, assertFrozenSourceSetArtifact, assertMenuMatchesSourceSet } from './lib/mof-jikou-source-boundary';
import { ministryFromMenuChain } from './lib/mof-jikou';

const SOURCE_SET = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-source-set.json');
const MENU = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024', 'html', `${MOF_ITEM_PARSER_V0_DOCUMENT_ID}menu.html`);
const XML_DIR = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024', 'xml');
const MENU_SHA256 = '19ccfb611a1b7208'; // 先頭16桁（manifest の既存の値 19ccfb61…と同じ。完全な値は下で manifest と照合）
const COLUMNS = ['所管', '組織', '項コード', '項名', '事項名', '主要経費別分類コード', '令和6年度要求額(千円)', '前年度予算額(千円)', '比較増△減額(千円)', 'source_file', 'source_row', 'source_page'] as const;
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cell = (v: unknown): string => { const s = String(v ?? ''); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function main(): void {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('usage: build-mof-jikou-csv.ts <out-dir>');
  const menuBytes = fs.readFileSync(MENU);
  if (!sha256(menuBytes).startsWith(MENU_SHA256)) throw new Error('menu SHA-256 differs from the frozen value');
  const menuText = new TextDecoder('euc-jp', { fatal: true }).decode(menuBytes);
  const chains = readMenuAncestorChains(menuText);
  const sourceSetBytes = fs.readFileSync(SOURCE_SET);
  assertFrozenSourceSetArtifact(sourceSetBytes);
  const set = JSON.parse(sourceSetBytes.toString('utf8')) as { targets: { file: string; sha256: string }[]; nonTargets: { file: string; sha256: string }[] };
  const sourceSet = new Map<string, string>([...set.targets, ...set.nonTargets].map(t => [t.file, t.sha256]));
  const files = parseMenuXmlFileNames(menuText);
  assertMenuMatchesSourceSet(files, set);

  const rows: string[][] = [];
  let targetFiles = 0, notTargetFiles = 0;
  const counts = { itemStartRows: 0, requestRows: 0, subtotalRows: 0, descriptionOnlyRows: 0 };
  for (const f of files) {
    let outcome;
    try {
      outcome = parseMofBudgetXmlItemFile({ filename: f, bytes: fs.readFileSync(path.join(XML_DIR, f)), documentId: MOF_ITEM_PARSER_V0_DOCUMENT_ID, menuChain: chains.get(f), sourceSet });
    } catch (e) {
      if (e instanceof MofXmlParseError) throw new Error(`parser の失敗: ${e.message}`);
      throw e;
    }
    if (outcome.status === 'unsupported') throw new Error(`${f}: unsupported（${outcome.reason}）`);
    if (outcome.status === 'not_target') { notTargetFiles++; continue; }
    targetFiles++;
    for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] += outcome.counts[k];
    const ministry = ministryFromMenuChain(chains.get(f)!);
    for (const r of outcome.records) {
      rows.push([ministry, r.organization, r.itemCode, r.itemName, r.requestName, r.col4Raw,
        String(r.amountsThousandYen.col6), String(r.amountsThousandYen.col8), String(r.amountsThousandYen.col10), r.file, r.row, String(r.page)]);
    }
  }
  assertExpectedPopulation({ targetFiles, notTargetFiles, records: rows.length });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jikou-general.csv'), [COLUMNS.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'jikou-general-run.json'), JSON.stringify({
    parser: { path: 'scripts/pipeline-v2/lib/mof-budget-xml-items.ts', sha256: sha256(fs.readFileSync('scripts/pipeline-v2/lib/mof-budget-xml-items.ts')) },
    inputs: { sourceSet: { path: SOURCE_SET, sha256: sha256(sourceSetBytes) }, menu: { path: MENU, sha256: sha256(menuBytes) } },
    xmlFiles: files.length, targetFiles, notTargetFiles, records: rows.length, parserCounts: counts,
    columns: COLUMNS,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ outDir, records: rows.length, targetFiles, notTargetFiles, parserCounts: counts }));
}

main();
