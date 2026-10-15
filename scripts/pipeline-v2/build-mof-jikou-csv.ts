/**
 * MOF 予算書【XML版】の事項を、素朴な CSV（jikou-general.csv）にする。一般会計（FY2024 当初予算 202411001、FY2025 成立後・提出時 202511001）。
 * 読み取りは parser v0 の規則のまま（lib/mof-budget-xml-items-general.ts。v0 は hash で凍結のため複製）（帳票ごとの値 spec だけを渡す）。jsonl・normalized・derived は経由しない。
 * 入力の境界は normalize-mof-jikou.ts と同じ（凍結済み source set の SHA-256、menu の XML 集合 328 = 94 + 234、生成結果 94 / 234 / 1,256）。
 * 契約: docs/tasks/20261015_0822_MOF_Archive_CSV_Primitives_Contract.md
 *
 * 契約（FY2025）: docs/tasks/20261015_1654_MOF_Jikou_Parser_General_Account_FY2025_Contract.md
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-mof-jikou-csv.ts <2024|2025|2025_teishutsu> <out-dir>
 * 出力: <out-dir>/jikou-general.csv（列は固定）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseMenuXmlFileNames } from './lib/mof-archive-download';
import { MOF_ITEM_PARSER_SPEC_FY2024, type MofItemParserSpec, MofXmlParseError, parseMofBudgetXmlItemFile, readMenuAncestorChains } from './lib/mof-budget-xml-items-general';
import { assertExpectedPopulation, assertFrozenSourceSetArtifact, assertMenuMatchesSourceSet } from './lib/mof-jikou-source-boundary';
import { checkSourceSetCompleteness } from './lib/mof-budget-xml-items-evaluation-rules';
import { ministryFromMenuChain } from './lib/mof-jikou';

interface Target { targets?: number; nonTargets?: number; key: string; archive: string; spec: MofItemParserSpec; sourceSet: string; sourceSetSha256: string | null; menuSha256Prefix: string | null; fy2024: boolean }
const ARCHIVE = path.join('data', 'download', 'mof.go.jp', 'archive');
const GENERAL_SOURCE_SET = (v: string) => path.join('tests', 'fixtures', 'mof-xml-parser-general', v, 'source-set.json');
const FY2025_SPEC: MofItemParserSpec = { documentId: '202511001', doctype: 'DOCTYPE budget SYSTEM "../dtd/202501.dtd"', yearLabel: '令和7年度' };
/** FY2024 は従来どおり（frozen source set の SHA・menu の SHA・1,256 件を境界にする）。FY2025 は commit 済みの source set の SHA を境界にし、事項の件数は期待値を置かない */
const TARGETS: Record<string, Target> = {
  '2023': { key: '2023', archive: path.join('2023', '2023'), spec: { documentId: '202311001', doctype: 'DOCTYPE budget SYSTEM "../dtd/202301.dtd"', yearLabel: '令和5年度' }, sourceSet: GENERAL_SOURCE_SET('2023'), sourceSetSha256: '1e1a01892793161d55e5bcd2551a172101fc04642a10b72bf1d6f12fb01cdb24', menuSha256Prefix: null, fy2024: false, targets: 95, nonTargets: 235 },
  '2024': { key: '2024', archive: path.join('2024', '2024'), spec: MOF_ITEM_PARSER_SPEC_FY2024, sourceSet: path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-source-set.json'), sourceSetSha256: null, menuSha256Prefix: '19ccfb611a1b7208', fy2024: true },
  '2025': { key: '2025', archive: path.join('2025', '2025'), spec: FY2025_SPEC, sourceSet: GENERAL_SOURCE_SET('2025'), sourceSetSha256: 'de7731e5fc426d662f0c04c4ca7c6728dfe6ca70b835d0bb73979236c10b6d74', menuSha256Prefix: null, fy2024: false },
  '2025_teishutsu': { key: '2025_teishutsu', archive: path.join('2025', '2025_teishutsu'), spec: FY2025_SPEC, sourceSet: GENERAL_SOURCE_SET('2025_teishutsu'), sourceSetSha256: '57b2433f8b616deb3d05f510741f619fc7aecf53841a4851cefd4d70b850a2e3', menuSha256Prefix: null, fy2024: false },
};
const columnsFor = (yearLabel: string) => ['所管', '組織', '項コード', '項名', '事項名', '主要経費別分類コード', `${yearLabel}要求額(千円)`, '前年度予算額(千円)', '比較増△減額(千円)', 'source_file', 'source_row', 'source_page'];
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cell = (v: unknown): string => { const s = String(v ?? ''); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function main(): void {
  const [targetKey, outDir] = process.argv.slice(2);
  const target = TARGETS[targetKey ?? ''];
  if (!target || !outDir) throw new Error(`usage: build-mof-jikou-csv.ts <${Object.keys(TARGETS).join('|')}> <out-dir>`);
  const { spec } = target;
  const SOURCE_SET = target.sourceSet;
  const MENU = path.join(ARCHIVE, target.archive, 'html', `${spec.documentId}menu.html`);
  const XML_DIR = path.join(ARCHIVE, target.archive, 'xml');
  const COLUMNS = columnsFor(spec.yearLabel);
  const menuBytes = fs.readFileSync(MENU);
  if (target.menuSha256Prefix && !sha256(menuBytes).startsWith(target.menuSha256Prefix)) throw new Error('menu SHA-256 differs from the frozen value');
  const menuText = new TextDecoder('euc-jp', { fatal: true }).decode(menuBytes);
  const chains = readMenuAncestorChains(menuText);
  const sourceSetBytes = fs.readFileSync(SOURCE_SET);
  if (target.fy2024) assertFrozenSourceSetArtifact(sourceSetBytes);
  else if (sha256(sourceSetBytes) !== target.sourceSetSha256) throw new Error(`source set ${SOURCE_SET} differs from the frozen value`);
  const set = JSON.parse(sourceSetBytes.toString('utf8')) as { targets: { file: string; sha256: string }[]; nonTargets: { file: string; sha256: string }[] };
  const sourceSet = new Map<string, string>([...set.targets, ...set.nonTargets].map(t => [t.file, t.sha256]));
  const files = parseMenuXmlFileNames(menuText);
  if (target.fy2024) assertMenuMatchesSourceSet(files, set);
  else {
    if (set.targets.length !== (target.targets ?? 94) || set.nonTargets.length !== (target.nonTargets ?? 234)) throw new Error(`source set の件数が想定外（target ${set.targets.length} / non-target ${set.nonTargets.length}）`);
    const c = checkSourceSetCompleteness(files, set.targets.map(t => t.file), set.nonTargets.map(t => t.file));
    if (files.length === 0 || !c.complete) throw new Error(`menu の XML 集合が source set と一致しない（欠落 ${c.missingLocally.length}、余剰 ${c.unexpectedLocally.length}、重複 ${c.duplicateExpected.length}）`);
  }

  const rows: string[][] = [];
  let targetFiles = 0, notTargetFiles = 0;
  const counts = { itemStartRows: 0, requestRows: 0, subtotalRows: 0, descriptionOnlyRows: 0 };
  for (const f of files) {
    let outcome;
    try {
      outcome = parseMofBudgetXmlItemFile({ filename: f, bytes: fs.readFileSync(path.join(XML_DIR, f)), documentId: spec.documentId, menuChain: chains.get(f), sourceSet, spec });
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
  if (target.fy2024) assertExpectedPopulation({ targetFiles, notTargetFiles, records: rows.length });
  else if (targetFiles !== (target.targets ?? 94) || notTargetFiles !== (target.nonTargets ?? 234)) throw new Error(`生成結果の population が期待と異なる（target ${targetFiles} / not_target ${notTargetFiles}。期待 ${target.targets ?? 94} / ${target.nonTargets ?? 234}）`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jikou-general.csv'), [COLUMNS.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'jikou-general-run.json'), JSON.stringify({
    parser: { path: 'scripts/pipeline-v2/lib/mof-budget-xml-items-general.ts', sha256: sha256(fs.readFileSync('scripts/pipeline-v2/lib/mof-budget-xml-items-general.ts')) },
    inputs: { sourceSet: { path: SOURCE_SET, sha256: sha256(sourceSetBytes) }, menu: { path: MENU, sha256: sha256(menuBytes) } },
    xmlFiles: files.length, targetFiles, notTargetFiles, records: rows.length, parserCounts: counts,
    columns: COLUMNS,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ outDir, records: rows.length, targetFiles, notTargetFiles, parserCounts: counts }));
}

main();
