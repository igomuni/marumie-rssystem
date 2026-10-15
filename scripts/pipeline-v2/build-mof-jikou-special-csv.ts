/**
 * MOF 予算書【XML版】特別会計の事項を、素朴な CSV（jikou-special.csv）にする。
 * 文法: docs/tasks/20261015_1800_MOF_Special_Account_Row_Grammar_Contract.md（事前登録）。説明欄は含めない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-mof-jikou-special-csv.ts <2024|2025|2025_teishutsu> <out-dir>
 * 出力: <out-dir>/jikou-special.csv、jikou-special-run.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { decodeEucJpMenu, parseMenuXmlFileNames } from './lib/mof-archive-download';
import { readMenuAncestorChains } from './lib/mof-budget-xml-items-general';
import { checkSourceSetCompleteness } from './lib/mof-budget-xml-items-evaluation-rules';
import { MofXmlParseError } from './lib/mof-budget-xml-items-general';
import { parseMofSpecialXmlFile, type MofSpecialParserSpec } from './lib/mof-budget-xml-special-items';

interface Target { archive: string; spec: MofSpecialParserSpec; sourceSet: string; sourceSetSha256: string; targets: number; nonTargets: number }
const SET = (v: string) => path.join('tests', 'fixtures', 'mof-xml-parser-special', v, 'source-set.json');
const SPEC24: MofSpecialParserSpec = { documentId: '202412001', doctype: 'DOCTYPE budget SYSTEM "../dtd/202401.dtd"', yearLabel: '令和6年度' };
const SPEC25: MofSpecialParserSpec = { documentId: '202512001', doctype: 'DOCTYPE budget SYSTEM "../dtd/202501.dtd"', yearLabel: '令和7年度' };
const TARGETS: Record<string, Target> = {
  '2023': { archive: path.join('2023', '2023'), spec: { documentId: '202312001', doctype: 'DOCTYPE budget SYSTEM "../dtd/202301.dtd"', yearLabel: '令和5年度' }, sourceSet: SET('2023'), sourceSetSha256: '6aa906b8365314a7e054b98a364c15af932bab1a56c5a823e01bfe0d84dd7e99', targets: 32, nonTargets: 249 },
  '2024': { archive: path.join('2024', '2024'), spec: SPEC24, sourceSet: SET('2024'), sourceSetSha256: '96fb5e5cc69996cdf83e23323bf2711d904f2caf74dea59024a92154ba3fb833', targets: 32, nonTargets: 249 },
  '2025': { archive: path.join('2025', '2025'), spec: SPEC25, sourceSet: SET('2025'), sourceSetSha256: 'd9bdf969eab9f2c3c1d683911cce947ab98b72a7474c42012f4b1b1ca15b10ab', targets: 34, nonTargets: 265 },
  '2025_teishutsu': { archive: path.join('2025', '2025_teishutsu'), spec: SPEC25, sourceSet: SET('2025_teishutsu'), sourceSetSha256: '8efec243f667b21e3b54f686937cbefd7ace13da4e7593176c7f1f4f2c6e076c', targets: 34, nonTargets: 265 },
};
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cell = (v: unknown): string => { const s = String(v ?? ''); return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const num = (n: number | null) => (n === null ? '' : String(n));

function main(): void {
  const [key, outDir] = process.argv.slice(2);
  const t = TARGETS[key ?? ''];
  if (!t || !outDir) throw new Error(`usage: build-mof-jikou-special-csv.ts <${Object.keys(TARGETS).join('|')}> <out-dir>`);
  const { spec } = t;
  const root = path.join('data', 'download', 'mof.go.jp', 'archive', t.archive);
  const menuBytes = fs.readFileSync(path.join(root, 'html', `${spec.documentId}menu.html`));
  const menuText = decodeEucJpMenu(menuBytes).text;
  const chains = readMenuAncestorChains(menuText);
  const setBytes = fs.readFileSync(t.sourceSet);
  if (sha256(setBytes) !== t.sourceSetSha256) throw new Error(`source set ${t.sourceSet} differs from the frozen value`);
  const set = JSON.parse(setBytes.toString('utf8')) as { targets: { file: string; sha256: string }[]; nonTargets: { file: string; sha256: string }[] };
  if (set.targets.length !== t.targets || set.nonTargets.length !== t.nonTargets) throw new Error(`source set の件数が想定外（target ${set.targets.length} / non-target ${set.nonTargets.length}）`);
  const sourceSet = new Map<string, string>([...set.targets, ...set.nonTargets].map(x => [x.file, x.sha256]));
  const files = parseMenuXmlFileNames(menuText);
  const c = checkSourceSetCompleteness(files, set.targets.map(x => x.file), set.nonTargets.map(x => x.file));
  if (files.length === 0 || !c.complete) throw new Error(`menu の XML 集合が source set と一致しない（欠落 ${c.missingLocally.length}、余剰 ${c.unexpectedLocally.length}、重複 ${c.duplicateExpected.length}）`);

  const COLUMNS = ['所管', '特別会計', '勘定', '組織', '項コード', '項名', '事項名', '分類コード', `${spec.yearLabel}予定額(千円)`, '前年度予算額(千円)', '比較増△減額(千円)', 'source_file', 'source_row', 'source_page'];
  const rows: string[][] = [];
  let targetFiles = 0, notTargetFiles = 0;
  const counts: Record<string, number> = {}; const layouts: Record<string, number> = {};
  for (const f of files) {
    let outcome;
    try { outcome = parseMofSpecialXmlFile({ filename: f, bytes: fs.readFileSync(path.join(root, 'xml', f)), menuChain: chains.get(f), sourceSet, spec }); }
    catch (e) { if (e instanceof MofXmlParseError) throw new Error(`parser の失敗: ${e.message}`); throw e; }
    if (outcome.status === 'unsupported') throw new Error(`${f}: unsupported（${outcome.reason}）`);
    if (outcome.status === 'not_target') { notTargetFiles++; continue; }
    targetFiles++; layouts[outcome.layout] = (layouts[outcome.layout] ?? 0) + 1;
    for (const [k, v] of Object.entries(outcome.counts)) counts[k] = (counts[k] ?? 0) + v;
    for (const r of outcome.records) {
      rows.push([r.ministry, r.specialAccount, r.subAccount, r.organization, r.itemCode, r.itemName, r.matterName, r.classCode,
        num(r.amountsThousandYen.planned), num(r.amountsThousandYen.prev), num(r.amountsThousandYen.diff), r.file, r.row, String(r.page)]);
    }
  }
  if (targetFiles !== t.targets || notTargetFiles !== t.nonTargets) throw new Error(`生成結果の population が期待と異なる（target ${targetFiles} / not_target ${notTargetFiles}。期待 ${t.targets} / ${t.nonTargets}）`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jikou-special.csv'), [COLUMNS.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n');
  const p = 'scripts/pipeline-v2/lib/mof-budget-xml-special-items.ts';
  fs.writeFileSync(path.join(outDir, 'jikou-special-run.json'), JSON.stringify({
    parser: { path: p, sha256: sha256(fs.readFileSync(p)) }, inputs: { sourceSet: { path: t.sourceSet, sha256: sha256(setBytes) }, menu: { sha256: sha256(menuBytes) } },
    xmlFiles: files.length, targetFiles, notTargetFiles, records: rows.length, rowClassCounts: counts, layouts, columns: COLUMNS,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ records: rows.length, targetFiles, notTargetFiles, layouts, rowClassCounts: counts }));
}

main();
