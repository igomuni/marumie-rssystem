/**
 * MOF 予算書【XML版】の「事項」を、source-preserving な normalized output（budget-jikou.jsonl）にする。
 * raw XML → frozen parser v0（lib/mof-budget-xml-items.ts, #370）→ 写像（lib/mof-jikou.ts）→ output。
 * 既存の normalized / derived output（budget-items.jsonl・manifest.json・sections.jsonl）は読み取りのみで変更しない。
 *
 * 入力境界（fail-closed）: source-set artifact の SHA-256 を frozen 値に固定、menu の XML 集合が 328 = 94 + 234 と完全一致、生成結果が 94 / 234 / 1,256 でなければ出力しない（lib/mof-jikou-source-boundary.ts）。
 * scope: FY2024 一般会計 当初予算 202411001 のみ（parser v0 の frozen scope）。parser の契約により入力は frozen source set
 * （filename + SHA-256）で固定され、scope 外のファイルは unsupported として失敗する。他年度・特別会計・補正予算には未対応。
 *
 * 入力: data/download/mof.go.jp/archive/2024/2024/{xml,html/202411001menu.html}、凍結済み source-set artifact（--source-set=）、
 *       data/normalized/mof/fy2024/budget-items.jsonl、data/derived/mof/fy2024/sections.jsonl（親の項の解決確認用）
 * 出力: data/normalized/mof/fy2024/{budget-jikou.jsonl,budget-jikou-manifest.json}
 *
 * 使い方: npx tsx scripts/pipeline-v2/normalize-mof-jikou.ts [2024] [--source-set=<path>]
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, writeJson, writeJsonl } from './lib/jsonl';
import { parseMenuXmlFileNames } from './lib/mof-archive-download';
import { MOF_ITEM_PARSER_V0_DOCUMENT_ID, MofXmlParseError, parseMofBudgetXmlItemFile, readMenuAncestorChains } from './lib/mof-budget-xml-items';
import { assertExpectedPopulation, assertFrozenSourceSetArtifact, assertMenuMatchesSourceSet } from './lib/mof-jikou-source-boundary';
import { JIKOU_CONTEXT_FY2024_GENERAL_INITIAL, mapParserRecordToJikou, ministryFromMenuChain, sortJikou, validateJikouRecords } from './lib/mof-jikou';
import type { MofBudgetItemRecord, MofBudgetJikouRecord, MofDerivedSection } from './types';

const DEFAULT_SOURCE_SET = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-source-set.json');
const PARSER_PATH = 'scripts/pipeline-v2/lib/mof-budget-xml-items.ts';
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

function main(): void {
  const args = process.argv.slice(2);
  const year = Number(args.find(a => /^\d{4}$/.test(a)) ?? 2024);
  if (year !== 2024) throw new Error(`parser v0 の frozen scope は FY2024 のみ（指定: ${year}）`);
  const sourceSetPath = args.find(a => a.startsWith('--source-set='))?.slice('--source-set='.length) ?? DEFAULT_SOURCE_SET;
  const ctx = JIKOU_CONTEXT_FY2024_GENERAL_INITIAL;

  const rawRoot = path.join('data', 'download');
  const xmlDir = path.join(rawRoot, ctx.xmlDirRelPath);
  const menuPath = path.join(rawRoot, 'mof.go.jp', 'archive', '2024', '2024', 'html', `${ctx.documentId}menu.html`);
  const menuText = new TextDecoder('euc-jp', { fatal: true }).decode(fs.readFileSync(menuPath));
  const chains = readMenuAncestorChains(menuText);
  // 入力境界（fail-closed）: source-set artifact は frozen 値に固定し、menu の XML 集合は 328 = 94 + 234 と完全一致を要求する
  const sourceSetBytes = fs.readFileSync(sourceSetPath);
  assertFrozenSourceSetArtifact(sourceSetBytes);
  const set = JSON.parse(sourceSetBytes.toString('utf8')) as { targets: { file: string; sha256: string }[]; nonTargets: { file: string; sha256: string }[] };
  const sourceSet = new Map<string, string>([...set.targets, ...set.nonTargets].map(t => [t.file, t.sha256]));

  // 全 XML（menu が列挙する集合）を parser に通す。想定外は例外＝失敗（silent skip しない）
  const files = parseMenuXmlFileNames(menuText);
  assertMenuMatchesSourceSet(files, set);
  const rows: MofBudgetJikouRecord[] = [];
  let targetFiles = 0, notTargetFiles = 0;
  const organizations = new Set<string>();
  for (const f of files) {
    let outcome;
    try {
      outcome = parseMofBudgetXmlItemFile({ filename: f, bytes: fs.readFileSync(path.join(xmlDir, f)), documentId: MOF_ITEM_PARSER_V0_DOCUMENT_ID, menuChain: chains.get(f), sourceSet });
    } catch (e) {
      if (e instanceof MofXmlParseError) throw new Error(`parser の失敗: ${e.message}`);
      throw e;
    }
    if (outcome.status === 'unsupported') throw new Error(`${f}: unsupported（${outcome.reason}）。frozen scope 外のため生成しない`);
    if (outcome.status === 'not_target') { notTargetFiles++; continue; }
    targetFiles++;
    organizations.add(outcome.organization);
    const ministry = ministryFromMenuChain(chains.get(f)!);
    for (const r of outcome.records) rows.push(mapParserRecordToJikou(r, ctx, ministry, outcome.sourceSha256));
  }
  assertExpectedPopulation({ targetFiles, notTargetFiles, records: rows.length });
  const sorted = sortJikou(rows);

  // 親の項の解決確認（既存 output は読み取りのみ）
  const itemsPath = path.join('data', 'normalized', 'mof', `fy${year}`, 'budget-items.jsonl');
  const sectionsPath = path.join('data', 'derived', 'mof', `fy${year}`, 'sections.jsonl');
  if (!fs.existsSync(itemsPath) || !fs.existsSync(sectionsPath)) throw new Error('親の項の解決確認に必要な既存 output（budget-items.jsonl / sections.jsonl）が無い');
  const parentKeys = new Set(readJsonl<MofBudgetItemRecord>(itemsPath).filter(r => r.accountType === ctx.accountType && r.phase === ctx.phase && r.budgetStatus === ctx.budgetStatus).map(r => r.sectionNaturalKey));
  const parentIds = new Set(readJsonl<MofDerivedSection>(sectionsPath).filter(s => s.accountType === ctx.accountType).map(s => s.id));
  const v = validateJikouRecords(sorted, parentKeys, parentIds);
  const problems = [
    v.duplicateRecordIds.length && `recordId 重複 ${v.duplicateRecordIds.length}`,
    v.missingRequiredFields.length && `必須 field 欠落 ${v.missingRequiredFields.length}`,
    v.missingProvenance.length && `provenance 欠落 ${v.missingProvenance.length}`,
    v.orphanParent.length && `親の項が未解決 ${v.orphanParent.length}`,
    v.ambiguousParent.length && `親の参照が不整合 ${v.ambiguousParent.length}`,
    v.notInDocumentOrder && `文書順でない ${v.notInDocumentOrder}`,
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`検証に失敗（出力しない）: ${problems.join(' / ')}`);

  const outDir = path.join('data', 'normalized', 'mof', `fy${year}`);
  const recordCount = writeJsonl(path.join(outDir, 'budget-jikou.jsonl'), sorted);
  writeJson(path.join(outDir, 'budget-jikou-manifest.json'), {
    schemaVersion: 1, fiscalYear: year, documentId: ctx.documentId, accountType: ctx.accountType, phase: ctx.phase, budgetStatus: ctx.budgetStatus,
    recordCount,
    counts: { xmlFiles: files.length, targetFiles, notTargetFiles, organizations: organizations.size, sourceXmlFiles: new Set(sorted.map(r => r.source.file)).size, uniqueRecordIds: new Set(sorted.map(r => r.recordId)).size, parentSections: new Set(sorted.map(r => r.parentSectionId)).size },
    parentResolution: { ...v.parentResolved, orphan: v.orphanParent.length, ambiguous: v.ambiguousParent.length },
    parser: { path: PARSER_PATH, sha256: sha256(fs.readFileSync(PARSER_PATH)) },
    inputs: { sourceSet: { path: sourceSetPath, sha256: sha256(fs.readFileSync(sourceSetPath)) }, menu: { path: menuPath, sha256: sha256(fs.readFileSync(menuPath)) } },
  });
  console.log(`MOF 事項 normalize: fy${year} ${ctx.documentId} → budget-jikou.jsonl ${recordCount} 行（target ${targetFiles} / not_target ${notTargetFiles} files、組織 ${organizations.size}、親の項 ${new Set(sorted.map(r => r.parentSectionId)).size}）`);
}

main();
