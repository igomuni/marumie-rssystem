/**
 * Pipeline V1/V2比較検証（仕様書10節）。
 *
 * V1の既存生成物（public/data/*.json）・V1が使うraw原本（data/download_old/、
 * data/downloadをV1/V2分離した際の退避先）とV2のderived出力を突き合わせ、
 * MATCH/DIFF/V1_ONLY/V2_ONLYを機械的に報告する。
 *
 * 差分を自動補正はしない。「一致すべき差分」（パースバグ）と「V2の意図的な差分」
 * （算出範囲・年度の取り方の違い）を各メトリクスのnoteで区別する。
 *
 * 使い方: npx tsx scripts/pipeline-v2/validate.ts [year]
 *   （年度省略時は2024。V1のraw原本がdata/download_old/に無い場合はそのメトリクスをスキップする）
 */
import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';

type Verdict = 'MATCH' | 'DIFF' | 'V1_ONLY' | 'V2_ONLY' | 'SKIPPED';

interface MetricResult {
  name: string;
  v1: number | null;
  v2: number | null;
  verdict: Verdict;
  note: string;
}

function readJsonIfExists<T>(p: string): T | null {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

/**
 * V1の生raw CSV（data/download_old/mof_{year}/DL{id}.zip）から歳出表の項の集合と金額を
 * 独立に再集計する。normalize-mof.tsとは別実装で、V2側のパースバグ検出を目的とする。
 *
 * 項の同一性は「項コード」単独では判定できない（同じ項コードが所管・組織をまたいで
 * 再利用されるため）。所管+組織+項コード+項名の組で数える必要がある
 * （Python参照実装との突合で判明。項コードのみだと259件になり、正しい784件と一致しなかった）。
 */
function recountMofExpenditure(zipPath: string): { sectionCount: number; amount: number } | null {
  if (!fs.existsSync(zipPath)) return null;
  const entry = listZipEntries(zipPath).find(e => e.toLowerCase().endsWith('b.csv'));
  if (!entry) return null;
  const lines = readZipEntryText(zipPath, entry).split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const idx = (name: string) => headers.indexOf(name);
  const accountCol = idx('所管');
  const orgCol = idx('組織');
  const sectionCodeCol = idx('項コード');
  const sectionNameCol = idx('項名');
  const amountCol = headers.findIndex(h => /^(令和|平成)(元|\d+)年度/.test(h));
  if (accountCol < 0 || orgCol < 0 || sectionCodeCol < 0 || sectionNameCol < 0 || amountCol < 0) return null;
  const sections = new Set<string>();
  let amount = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    sections.add([cells[accountCol], cells[orgCol], cells[sectionCodeCol], cells[sectionNameCol]].join('|'));
    const n = parseInt((cells[amountCol] ?? '').replace(/,/g, ''), 10);
    if (!Number.isNaN(n)) amount += n * 1000;
  }
  return { sectionCount: sections.size, amount };
}

/**
 * クォート対応の最小CSVパーサ（1レコード=1行の配列）。RSの自由記述列（主な増減理由等）が
 * カンマ・改行を含みうるため、単純split(',')では後続列がずれる。
 * lib/csv.tsとは意図的に別実装にしている（正規化パイプラインのパーサ自体にバグがあった
 * 場合にvalidate.ts側で検出できるようにするため。同じコードを共有すると同じバグを
 * 再現しうる。CodeRabbit指摘、2026-09-19）。
 */
function parseCsvRowsIndependently(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); if (row.some(v => v !== '')) rows.push(row); row = []; };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"' && content[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\r') { pushRow(); if (content[i + 1] === '\n') i++; }
    else if (c === '\n') pushRow();
    else field += c;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/**
 * V1の生raw CSV（data/download_old/RS_{year}/2-1_*.zip）から、指定した予算年度の
 * 列の合計を独立に再集計する（normalize-rs.tsとは別コード。列名は呼び出し側で指定）。
 */
function recountRsColumn(zipPath: string, budgetYear: number, columnName: string): number | null {
  if (!fs.existsSync(zipPath)) return null;
  const entry = listZipEntries(zipPath).find(e => e.toLowerCase().endsWith('.csv'));
  if (!entry) return null;
  const content = readZipEntryText(zipPath, entry).replace(/^﻿/, '');
  const rows = parseCsvRowsIndependently(content);
  if (rows.length === 0) return null;
  const headers = rows[0];
  const yearCol = headers.indexOf('予算年度');
  const valueCol = headers.indexOf(columnName);
  if (yearCol < 0 || valueCol < 0) return null;
  let total = 0;
  for (const cells of rows.slice(1)) {
    if (Number(cells[yearCol]) !== budgetYear) continue;
    total += Number(cells[valueCol].replace(/,/g, '')) || 0;
  }
  return total;
}

function metric(name: string, v1: number | null, v2: number | null, note: string, tolerance = 0): MetricResult {
  let verdict: Verdict;
  if (v1 === null && v2 === null) verdict = 'SKIPPED';
  else if (v1 === null) verdict = 'V2_ONLY';
  else if (v2 === null) verdict = 'V1_ONLY';
  else verdict = Math.abs(v1 - v2) <= tolerance ? 'MATCH' : 'DIFF';
  return { name, v1, v2, verdict, note };
}

function fmt(n: number | null): string {
  if (n === null) return '—';
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

function main(): void {
  const year = Number(process.argv[2] ?? '2024');
  console.log(`\n=== Pipeline V1/V2比較検証: fiscalYear=${year} ===\n`);

  const results: MetricResult[] = [];

  // --- MOF ---
  const mofOverview = readJsonIfExists<{ generalAccount: { expenditure: { total: number } } }>(
    `public/data/mof-budget-overview-${year}.json`
  );
  const mofRecount = recountMofExpenditure(path.join('data', 'download_old', `mof_${year}`, 'DL202411001.zip'));
  const derivedEvents = readJsonIfExists<{ eventType: string; account: string; organization: string; sectionCode: string; sectionName: string; amount: number; provenance: { file: string } }[]>(
    path.join('data', 'derived', String(year), 'budget-events.json')
  );
  const v2InitialGeneral = derivedEvents?.filter(e => e.eventType === 'initial' && e.provenance.file === 'DL202411001.zip') ?? null;
  const v2InitialAmount = v2InitialGeneral ? v2InitialGeneral.reduce((a, e) => a + e.amount, 0) : null;
  const v2InitialSections = v2InitialGeneral
    ? new Set(v2InitialGeneral.map(e => [e.account, e.organization, e.sectionCode, e.sectionName].join('|'))).size
    : null;

  results.push(metric(
    'MOF当初 項数（一般会計、raw再集計 vs derived）',
    mofRecount?.sectionCount ?? null, v2InitialSections,
    'どちらも所管+組織+項コード+項名のユニーク数（項コード単独は所管をまたいで再利用されるため不可）。' +
      'Python参照実装（docs/tasksのpipeline-v2-reference）との突合で784件が正であることを確認済み'
  ));
  results.push(metric(
    'MOF当初 金額（一般会計歳出、円）',
    mofOverview?.generalAccount.expenditure.total ?? null, v2InitialAmount,
    'V1はpublic/data/mof-budget-overview-{year}.json（V1が実際に配信している値）'
  ));

  const v2Supplementary = derivedEvents?.filter(e => e.eventType === 'supplementary' && e.provenance.file === 'DL202421001.zip')
    .reduce((a, e) => a + e.amount, 0) ?? null;
  results.push(metric(
    'MOF補正額（一般会計、円）',
    null, v2Supplementary,
    'V1のmof-budget-overview.jsonは当初予算のみを対象とし補正を含まないため比較対象が無い（V2のみ算出）'
  ));

  const v2Execution = derivedEvents?.filter(e => e.eventType === 'execution' && e.provenance.file === 'DL202477001.zip')
    .reduce((a, e) => a + e.amount, 0) ?? null;
  results.push(metric(
    'MOF決算 執行額（一般会計、円）',
    null, v2Execution,
    'V1側に対応する集計済み公開値が見当たらないため比較対象が無い（V2のみ算出）'
  ));

  // --- RS ---
  const rsProjectDetails = readJsonIfExists<Record<string, unknown>>(`public/data/rs${year}-project-details.json`);
  const v2Projects = readJsonIfExists<unknown[]>(path.join('data', 'normalized', 'rs', String(year), 'projects.json'));
  results.push(metric(
    'RS事業数',
    rsProjectDetails ? Object.keys(rsProjectDetails).length : null, v2Projects?.length ?? null,
    'V1はpublic/data配信物（生成日時が異なるスナップショットの可能性）、V2はraw CSVを都度そのまま件数化。差は主にダウンロード時点の違いによるものと推測（要確認）'
  ));

  const rsZip = path.join('data', 'download_old', `RS_${year}`, `2-1_RS_${year}_予算・執行_サマリ.zip`);
  const v2RsEvents = readJsonIfExists<{ eventType: string; fiscalYear: number; amount: number }[]>(
    path.join('data', 'normalized', 'rs', String(year), 'budget-events.json')
  );
  const v2RsInitial = v2RsEvents?.filter(e => e.eventType === 'initial' && e.fiscalYear === year).reduce((a, e) => a + e.amount, 0) ?? null;
  results.push(metric(
    'RS当初予算額（予算年度=fiscalYearの当初予算合計、円）',
    recountRsColumn(rsZip, year, '当初予算'), v2RsInitial,
    'V1側はdata/download_old/の生CSVをvalidate.ts独自実装で再集計（normalize-rs.tsとは別コード）'
  ));

  // 執行額は「事業年度(sourceYear)」の1年前の予算年度（既に決算が締まっている年度）に対して記録される
  // （事業年度2024のRS提出データには2023年度の執行実績が入る。データ確認済み）
  const executionFiscalYear = year - 1;
  const v2RsExecution = v2RsEvents?.filter(e => e.eventType === 'execution' && e.fiscalYear === executionFiscalYear)
    .reduce((a, e) => a + e.amount, 0) ?? null;
  results.push(metric(
    `RS執行額（予算年度=${executionFiscalYear}の執行額合計、円）`,
    recountRsColumn(rsZip, executionFiscalYear, '執行額'), v2RsExecution,
    'V1側はdata/download_old/の生CSVをvalidate.ts独自実装で再集計（normalize-rs.tsとは別コード）。' +
      `執行額は事業年度${year}のRS提出データでは${executionFiscalYear}年度分（直近で決算が締まった年度）として記録される`
  ));

  // --- Links ---
  const v1Linkage = readJsonIfExists<{ metadata: { counts: { links: number }; coverage: { rsAmountTotal: number; rsAmountLinked: number } } }>(
    `public/data/mof-rs-kou-moku-linkage-${year}.json`
  );
  const v2Links = readJsonIfExists<unknown[]>(path.join('data', 'derived', String(year), 'project-links.json'));
  const v2Ir = readJsonIfExists<{ projectLinks?: { amountTotal: number; amountLinked: number } }>(
    path.join('data', 'derived', String(year), 'identity-resolution.json')
  );
  results.push(metric(
    'MOF目↔RS事業 リンク数',
    v1Linkage?.metadata.counts.links ?? null, v2Links?.length ?? null,
    'V1はRS(year+1)×MOF(year)をbudgetType別キーで突合、決算目への引き継ぎも含む。V2はRS(year)×MOF(year)をentity単位（budgetType区別なし）で突合。年度の取り方・粒度が異なるため一致は期待しない（意図的な差分）'
  ));
  results.push(metric(
    'リンク済金額（円）',
    v1Linkage?.metadata.coverage.rsAmountLinked ?? null, v2Ir?.projectLinks?.amountLinked ?? null,
    '算出方法の違いは上記と同じ'
  ));
  if (v1Linkage && v2Ir?.projectLinks) {
    const v1Total = v1Linkage.metadata.coverage.rsAmountTotal;
    const v1Unlinked = v1Total - v1Linkage.metadata.coverage.rsAmountLinked;
    const v2Unlinked = v2Ir.projectLinks.amountTotal - v2Ir.projectLinks.amountLinked;
    results.push(metric('未リンク金額（円）', v1Unlinked, v2Unlinked, '算出方法の違いは上記と同じ'));
  }

  // --- レポート出力 ---
  console.log('| メトリクス | V1 | V2 | 判定 |');
  console.log('|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.name} | ${fmt(r.v1)} | ${fmt(r.v2)} | ${r.verdict} |`);
  }
  console.log();
  for (const r of results) {
    console.log(`[${r.verdict}] ${r.name}\n  ${r.note}`);
  }

  const diffs = results.filter(r => r.verdict === 'DIFF');
  if (diffs.length > 0) {
    console.log(`\n⚠ DIFF ${diffs.length}件（上記noteで意図的差分かどうかを確認すること。自動補正はしない）`);
  }
}

main();
