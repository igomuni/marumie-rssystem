/**
 * RS2024構造化JSON生成スクリプト
 *
 * 全事業・全支出先の完全な構造化データを生成する
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';
import { buildHierarchyPath, hierarchyPathToString } from '../client/lib/buildHierarchyPath';
import type { HierarchyPath } from '../types/rs-system';
import type {
  RS2024StructuredData,
  Metadata,
  BudgetTree,
  BudgetRecord,
  SpendingRecord,
  SpendingProject,
  SpendingBlockFlow,
  Statistics,
  MinistryNode,
  BureauNode,
  DepartmentNode,
  DivisionNode,
  OfficeNode,
  GroupNode,
  SectionNode,
} from '../types/structured';
import type {
  OrganizationInfo,
  BudgetSummary,
  ProjectOverview,
  SpendingInfo,
  SpendingBlockFlowInfo,
} from '../types/rs-system';

const DATA_DIR = path.join(__dirname, '../data/year_2024');
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const OUTPUT_FILE = 'rs2024-structured.json';
const HISTORICAL_OUTPUT_FILE = 'rs2024-historical.json';
const TARGET_FISCAL_YEAR = 2024;

/**
 * 支出先の一意キー（支出先名 + 法人番号）
 */
function getSpendingKey(name: string, corporateNumber: string): string {
  return `${name.trim()}::${corporateNumber.trim()}`;
}

/**
 * 数値パース（空文字列やエラーは0）
 */
function parseNumber(value: string): number {
  if (!value || value.trim() === '') return 0;
  const num = parseFloat(value.replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * 年度パース（不明や空は0）
 */
function parseYear(value: string, unknownFlag: string): number {
  if (unknownFlag === 'TRUE' || !value || value.trim() === '') return 0;
  const year = parseInt(value, 10);
  return isNaN(year) ? 0 : year;
}

/**
 * HierarchyPathオブジェクトを配列に変換
 */
function hierarchyPathToArray(path: HierarchyPath): string[] {
  const parts: string[] = [];
  if (path.府省庁) parts.push(path.府省庁);
  if (path['局・庁']) parts.push(path['局・庁']);
  if (path.部) parts.push(path.部);
  if (path.課) parts.push(path.課);
  if (path.室) parts.push(path.室);
  if (path.班) parts.push(path.班);
  if (path.係) parts.push(path.係);
  return parts;
}

/**
 * メイン処理
 */
async function main() {
  console.log('RS2024構造化JSON生成開始...\n');

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // CSVファイル読み込み
  console.log('CSVファイル読み込み中...');
  const orgPath = path.join(DATA_DIR, '1-1_RS_2024_基本情報_組織情報.csv');
  const overviewPath = path.join(DATA_DIR, '1-2_RS_2024_基本情報_事業概要等.csv');
  const budgetPath = path.join(DATA_DIR, '2-1_RS_2024_予算・執行_サマリ.csv');
  const spendingPath = path.join(DATA_DIR, '5-1_RS_2024_支出先_支出情報.csv');
  const blockFlowPath = path.join(DATA_DIR, '5-2_RS_2024_支出先_支出ブロックのつながり.csv');

  const requiredFiles = [orgPath, overviewPath, budgetPath, spendingPath, blockFlowPath];
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      console.error(`❌ 必要なCSVファイルが見つかりません: ${file}`);
      console.error('npm run normalize を実行してください');
      process.exit(1);
    }
  }

  const orgRows = readShiftJISCSV(orgPath) as unknown as OrganizationInfo[];
  const overviewRows = readShiftJISCSV(overviewPath) as unknown as ProjectOverview[];
  const budgetRows = readShiftJISCSV(budgetPath) as unknown as BudgetSummary[];
  const spendingRows = readShiftJISCSV(spendingPath) as unknown as SpendingInfo[];
  const blockFlowRows = readShiftJISCSV(blockFlowPath) as unknown as SpendingBlockFlowInfo[];

  console.log(`✓ 組織情報: ${orgRows.length}行`);
  console.log(`✓ 事業概要: ${overviewRows.length}行`);
  console.log(`✓ 予算情報: ${budgetRows.length}行`);
  console.log(`✓ 支出情報: ${spendingRows.length}行`);
  console.log(`✓ 支出ブロックフロー: ${blockFlowRows.length}行\n`);

  // データ処理
  console.log('データ処理中...');

  // 1. 予算事業IDをキーとしたマップ構築
  const orgMap = new Map<number, OrganizationInfo>();
  const overviewMap = new Map<number, ProjectOverview>();

  for (const row of orgRows) {
    const projectId = parseInt(row.予算事業ID, 10);
    if (!isNaN(projectId)) {
      orgMap.set(projectId, row);
    }
  }

  for (const row of overviewRows) {
    const projectId = parseInt(row.予算事業ID, 10);
    if (!isNaN(projectId)) {
      overviewMap.set(projectId, row);
    }
  }

  // 2. 予算レコード構築
  console.log('予算レコード構築中...');
  const { currentYearRecords, historicalYearRecords } = buildBudgetRecords(
    budgetRows,
    orgMap,
    overviewMap
  );
  console.log(`✓ 2024年度予算レコード数: ${currentYearRecords.length}`);
  console.log(`✓ 過去年度予算レコード数: ${historicalYearRecords.length}`);

  // 3. 支出ブロックフローマップ構築
  console.log('支出ブロックフローマップ構築中...');
  const blockFlowMap = buildBlockFlowMap(blockFlowRows, spendingRows);
  console.log(`✓ 直接支出ブロック数: ${blockFlowMap.isDirectFromGov.size}`);
  console.log(`✓ 間接支出フロー数: ${Array.from(blockFlowMap.outflows.values()).reduce((sum, flows) => sum + flows.length, 0)}`);

  // 4. 支出レコード構築
  console.log('支出レコード構築中...');
  const { spendingRecords, projectSpendingMap } = buildSpendingRecords(
    spendingRows,
    currentYearRecords,
    blockFlowMap
  );
  console.log(`✓ 支出レコード数: ${spendingRecords.length}`);

  // 4. 予算レコードに支出先IDを追加
  console.log('予算レコードと支出レコードをリンク中...');
  linkBudgetAndSpending(currentYearRecords, projectSpendingMap, spendingRecords);

  // 5. 予算ツリー構築
  console.log('組織階層ツリー構築中...');
  const budgetTree = buildBudgetTree(currentYearRecords);
  console.log(`✓ 府省庁数: ${budgetTree.ministries.length}`);

  // 6. 統計情報生成
  console.log('統計情報生成中...');
  const statistics = buildStatistics(currentYearRecords, spendingRecords);

  // 7. メタデータ生成（2024年度）
  const metadata: Metadata = {
    generatedAt: new Date().toISOString(),
    fiscalYear: TARGET_FISCAL_YEAR,
    dataVersion: '1.0.0',
    totalProjects: currentYearRecords.length,
    totalRecipients: spendingRecords.length,
    totalBudgetAmount: currentYearRecords.reduce((sum, b) => sum + b.totalBudget, 0),
    totalSpendingAmount: spendingRecords.reduce((sum, s) => sum + s.totalSpendingAmount, 0),
  };

  // 8. 構造化データ生成（2024年度 + 過去年度）
  const structuredData: RS2024StructuredData = {
    metadata,
    budgetTree,
    budgets: currentYearRecords,
    spendings: spendingRecords,
    statistics,
    historicalBudgets: historicalYearRecords,
  };

  // 9. JSON出力
  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  console.log(`\nJSON出力中: ${outputPath}`);
  fs.writeFileSync(outputPath, JSON.stringify(structuredData, null, 2), 'utf-8');

  const fileSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
  console.log(`✅ データ生成完了 (ファイルサイズ: ${fileSizeMB}MB)`);

  console.log(`\n統計:
  - 2024年度事業数: ${metadata.totalProjects.toLocaleString()}
  - 過去年度事業数: ${historicalYearRecords.length.toLocaleString()}
  - 総支出先数: ${metadata.totalRecipients.toLocaleString()}
  - 2024年度総予算額: ${(metadata.totalBudgetAmount / 1e12).toFixed(2)}兆円
  - 2024年度総支出額: ${(metadata.totalSpendingAmount / 1e12).toFixed(2)}兆円
  `);
}

/**
 * 予算レコードを構築
 * 2024年度と過去年度を分離
 */
function buildBudgetRecords(
  budgetRows: BudgetSummary[],
  orgMap: Map<number, OrganizationInfo>,
  overviewMap: Map<number, ProjectOverview>
): {
  currentYearRecords: BudgetRecord[];
  historicalYearRecords: BudgetRecord[];
} {
  // 予算事業ID + 予算年度単位で集計（会計区分ごとに複数行存在する可能性）
  type BudgetKey = string; // `${projectId}_${fiscalYear}`

  const budgetMap = new Map<BudgetKey, {
    projectId: number;
    fiscalYear: number;
    org: OrganizationInfo;
    overview?: ProjectOverview;
    initialBudget: number;
    supplementaryBudget: number;
    carryoverBudget: number;
    reserveFund: number;
    totalBudget: number;
    executedAmount: number;
    executionRate: number;
    carryoverToNext: number;
    nextYearRequest: number;
    accountCategories: Set<string>;
    accounts: Set<string>;
    accountingSubdivisions: Set<string>;
  }>();

  for (const row of budgetRows) {
    const projectId = parseInt(row.予算事業ID, 10);
    if (isNaN(projectId)) continue;

    const org = orgMap.get(projectId);
    if (!org) continue;

    // 予算年度でフィルタリング
    const fiscalYear = parseInt(row.予算年度, 10);
    if (isNaN(fiscalYear)) continue;

    const key: BudgetKey = `${projectId}_${fiscalYear}`;

    if (!budgetMap.has(key)) {
      budgetMap.set(key, {
        projectId,
        fiscalYear,
        org,
        overview: overviewMap.get(projectId),
        initialBudget: 0,
        supplementaryBudget: 0,
        carryoverBudget: 0,
        reserveFund: 0,
        totalBudget: 0,
        executedAmount: 0,
        executionRate: 0,
        carryoverToNext: 0,
        nextYearRequest: 0,
        accountCategories: new Set(),
        accounts: new Set(),
        accountingSubdivisions: new Set(),
      });
    }

    const budget = budgetMap.get(key)!;
    budget.initialBudget += parseNumber(row['当初予算(合計)']);
    budget.supplementaryBudget += parseNumber(row['補正予算(合計)']);
    budget.carryoverBudget += parseNumber(row['前年度からの繰越し(合計)']);
    budget.reserveFund += parseNumber(row['予備費等(合計)']);
    budget.totalBudget += parseNumber(row['計(歳出予算現額合計)']);
    budget.executedAmount += parseNumber(row['執行額(合計)']);
    budget.carryoverToNext += parseNumber(row['翌年度への繰越し(合計)']);
    budget.nextYearRequest += parseNumber(row['翌年度要求額(合計)']);

    if (row.会計区分) budget.accountCategories.add(row.会計区分);
    if (row.会計) budget.accounts.add(row.会計);
    if (row.勘定) budget.accountingSubdivisions.add(row.勘定);

    // 執行率は最新の値を使用（空でない場合のみ）
    const rate = parseNumber(row.執行率);
    if (rate > 0) {
      budget.executionRate = rate;
    }
  }

  // BudgetRecordに変換（2024年度と過去年度を分離）
  const currentYearRecords: BudgetRecord[] = [];
  const historicalYearRecords: BudgetRecord[] = [];

  for (const [_key, budget] of budgetMap.entries()) {
    const hierarchyObj = buildHierarchyPath(budget.org);
    const hierarchyArray = hierarchyPathToArray(hierarchyObj);
    const overview = budget.overview;

    const record: BudgetRecord = {
      projectId: budget.projectId,
      projectName: budget.org.事業名,
      fiscalYear: budget.fiscalYear,
      projectStartYear: overview
        ? parseYear(overview.事業開始年度, overview.開始年度不明)
        : 0,
      projectEndYear: overview
        ? parseYear(overview['事業終了(予定)年度'], overview.終了予定なし)
        : 0,
      ministry: budget.org.府省庁,
      bureau: budget.org['局・庁'] || '',
      department: budget.org.部 || '',
      division: budget.org.課 || '',
      office: budget.org.室 || '',
      group: budget.org.班 || '',
      section: budget.org.係 || '',
      hierarchyPath: hierarchyArray,
      initialBudget: budget.initialBudget,
      supplementaryBudget: budget.supplementaryBudget,
      carryoverBudget: budget.carryoverBudget,
      reserveFund: budget.reserveFund,
      totalBudget: budget.totalBudget,
      executedAmount: budget.executedAmount,
      executionRate: budget.executionRate,
      carryoverToNext: budget.carryoverToNext,
      nextYearRequest: budget.nextYearRequest,
      accountCategory: Array.from(budget.accountCategories).join(', '),
      account: Array.from(budget.accounts).join(', '),
      accountingSubdivision: Array.from(budget.accountingSubdivisions).join(', '),
      spendingIds: [],
      totalSpendingAmount: 0,
    };

    // 2024年度と過去年度を分離
    if (budget.fiscalYear === TARGET_FISCAL_YEAR) {
      currentYearRecords.push(record);
    } else {
      historicalYearRecords.push(record);
    }
  }

  return {
    currentYearRecords: currentYearRecords.sort((a, b) => a.projectId - b.projectId),
    historicalYearRecords: historicalYearRecords.sort((a, b) => {
      // 年度降順、プロジェクトID昇順
      if (a.fiscalYear !== b.fiscalYear) return b.fiscalYear - a.fiscalYear;
      return a.projectId - b.projectId;
    }),
  };
}

/**
 * 支出ブロックフローのマップを構築
 */
interface BlockFlowMap {
  // key: "projectId_blockNumber" (例: "7259_A")
  // value: outflows（この支出先から他への流出）
  outflows: Map<string, SpendingBlockFlow[]>;

  // key: "projectId_blockNumber"
  // value: isDirectFromGov（政府から直接支出か）
  isDirectFromGov: Map<string, boolean>;
}

function buildBlockFlowMap(flowRows: SpendingBlockFlowInfo[], spendingRows: SpendingInfo[]): BlockFlowMap {
  const outflows = new Map<string, SpendingBlockFlow[]>();
  const isDirectFromGov = new Map<string, boolean>();

  // ブロックごとの金額マップを構築（5-1 CSVから）
  const blockAmountMap = new Map<string, number>();

  // ブロックごとの個別支出先リストを構築（5-1 CSVから）
  const blockRecipientsMap = new Map<string, Array<{
    name: string;
    corporateNumber: string;
    amount: number;
  }>>();

  for (const row of spendingRows) {
    const projectId = row.予算事業ID;
    const blockNumber = row.支出先ブロック番号;
    if (!projectId || !blockNumber) continue;

    const key = `${projectId}_${blockNumber}`;

    // ブロックの合計金額を取得
    const blockAmount = parseAmount(row.ブロックの合計支出額);
    const existing = blockAmountMap.get(key) || 0;
    if (blockAmount > existing) {
      blockAmountMap.set(key, blockAmount);
    }

    // 個別支出先を収集（支出先名がある場合）
    const recipientName = row.支出先名?.trim();
    if (recipientName) {
      const amount = parseAmount(row.金額);
      if (amount > 0) {
        if (!blockRecipientsMap.has(key)) {
          blockRecipientsMap.set(key, []);
        }
        blockRecipientsMap.get(key)!.push({
          name: recipientName,
          corporateNumber: row.法人番号?.trim() || '',
          amount: amount,
        });
      }
    }
  }

  for (const row of flowRows) {
    const projectIdStr = row.予算事業ID;
    const projectId = parseInt(projectIdStr, 10);
    const sourceBlock = row.支出元の支出先ブロック;
    const targetBlock = row.支出先の支出先ブロック;
    const isDirectStr = row.担当組織からの支出;

    if (!projectIdStr || !targetBlock || isNaN(projectId)) continue;

    // 支出先ブロックが政府から直接支出かどうか
    if (isDirectStr === 'TRUE') {
      const key = `${projectIdStr}_${targetBlock}`;
      isDirectFromGov.set(key, true);
    }

    // 支出元ブロックがある場合（再委託等）
    if (sourceBlock && isDirectStr === 'FALSE') {
      const sourceKey = `${projectIdStr}_${sourceBlock}`;
      const targetKey = `${projectIdStr}_${targetBlock}`;
      const amount = blockAmountMap.get(targetKey) || 0;
      const recipients = blockRecipientsMap.get(targetKey) || [];

      if (!outflows.has(sourceKey)) {
        outflows.set(sourceKey, []);
      }
      outflows.get(sourceKey)!.push({
        projectId: projectId,
        projectName: row.事業名,
        sourceBlockNumber: sourceBlock,
        sourceBlockName: row.支出元の支出先ブロック名,
        targetBlockNumber: targetBlock,
        targetBlockName: row.支出先の支出先ブロック名,
        flowType: row.資金の流れの補足情報 || '再委託',
        amount: amount,
        recipients: recipients.length > 0 ? recipients : undefined,
        isDirectFromGov: false,
      });
    }
  }

  return { outflows, isDirectFromGov };
}

/**
 * 支出レコードを構築
 */
function buildSpendingRecords(
  spendingRows: SpendingInfo[],
  budgetRecords: BudgetRecord[],
  blockFlowMap: BlockFlowMap
): {
  spendingRecords: SpendingRecord[];
  projectSpendingMap: Map<number, number[]>;
} {
  // 支出先キー（名前+法人番号）ごとに集計
  const spendingMap = new Map<string, {
    name: string;
    corporateNumber: string;
    location: string;
    corporateType: string;
    projects: Map<number, {
      amount: number;
      blockNumbers: Set<string>;
      blockNames: Set<string>;
      contractSummaries: Set<string>;
      contractMethods: Set<string>;
    }>;
  }>();

  // 間接支出ブロックの除外統計
  let indirectBlockCount = 0;
  let indirectBlockAmount = 0;

  for (const row of spendingRows) {
    const projectId = parseInt(row.予算事業ID, 10);
    if (isNaN(projectId)) continue;

    const spendingName = row.支出先名?.trim();
    if (!spendingName) continue;

    const amount = parseAmount(row.金額);
    if (amount <= 0) continue;

    // 間接支出ブロックをスキップ（重複カウント防止）
    const blockNumber = row.支出先ブロック番号;
    if (blockNumber) {
      const blockKey = `${projectId}_${blockNumber}`;
      const isDirectFromGov = blockFlowMap.isDirectFromGov.get(blockKey);

      // isDirectFromGovがfalseまたは未定義（=政府から直接支出ではない）の場合
      // ただし、isDirectFromGovがtrueの場合のみ集計対象とする
      if (isDirectFromGov !== true) {
        indirectBlockCount++;
        indirectBlockAmount += amount;
        continue; // 間接支出はスキップ
      }
    }

    const key = getSpendingKey(spendingName, row.法人番号 || '');

    if (!spendingMap.has(key)) {
      spendingMap.set(key, {
        name: spendingName,
        corporateNumber: row.法人番号 || '',
        location: row.所在地 || '',
        corporateType: row.法人種別 || '',
        projects: new Map(),
      });
    }

    const spending = spendingMap.get(key)!;
    if (!spending.projects.has(projectId)) {
      spending.projects.set(projectId, {
        amount: 0,
        blockNumbers: new Set(),
        blockNames: new Set(),
        contractSummaries: new Set(),
        contractMethods: new Set(),
      });
    }

    const project = spending.projects.get(projectId)!;
    project.amount += amount;
    if (row.支出先ブロック番号) project.blockNumbers.add(row.支出先ブロック番号);
    if (row.支出先ブロック名) project.blockNames.add(row.支出先ブロック名);
    if (row.契約概要) project.contractSummaries.add(row.契約概要);
    if (row.契約方式等) project.contractMethods.add(row.契約方式等);
  }

  // SpendingRecordに変換
  const spendingRecords: SpendingRecord[] = [];
  const projectSpendingMap = new Map<number, number[]>();
  let spendingId = 1;

  for (const [_key, spending] of spendingMap.entries()) {
    const currentSpendingId = spendingId++;
    const projects: SpendingProject[] = [];

    for (const [projectId, proj] of spending.projects.entries()) {
      projects.push({
        projectId,
        amount: proj.amount,
        blockNumber: Array.from(proj.blockNumbers).join(', '),
        blockName: Array.from(proj.blockNames).join(', '),
        contractSummary: Array.from(proj.contractSummaries).join(', '),
        contractMethod: Array.from(proj.contractMethods).join(', '),
      });

      // プロジェクト→支出先のマッピング
      if (!projectSpendingMap.has(projectId)) {
        projectSpendingMap.set(projectId, []);
      }
      projectSpendingMap.get(projectId)!.push(currentSpendingId);
    }

    spendingRecords.push({
      spendingId: currentSpendingId,
      spendingName: spending.name,
      corporateNumber: spending.corporateNumber,
      location: spending.location,
      corporateType: spending.corporateType,
      totalSpendingAmount: projects.reduce((sum, p) => sum + p.amount, 0),
      projectCount: projects.length,
      projects: projects.sort((a, b) => b.amount - a.amount),
    });
  }

  // SpendingRecordにoutflowsを追加
  for (const record of spendingRecords) {
    const outflows: SpendingBlockFlow[] = [];

    for (const project of record.projects) {
      // ブロック番号が複数ある場合は最初のものを使用
      const blockNumbers = project.blockNumber.split(', ').filter(b => b);

      for (const blockNum of blockNumbers) {
        const blockKey = `${project.projectId}_${blockNum}`;
        const flows = blockFlowMap.outflows.get(blockKey) || [];
        outflows.push(...flows);
      }
    }

    if (outflows.length > 0) {
      record.outflows = outflows;
    }
  }

  // 間接支出除外の統計を出力
  console.log(`✓ 間接支出ブロック除外数: ${indirectBlockCount}件`);
  console.log(`✓ 間接支出除外金額: ${(indirectBlockAmount / 1e12).toFixed(2)}兆円`);

  return {
    spendingRecords: spendingRecords.sort((a, b) => b.totalSpendingAmount - a.totalSpendingAmount),
    projectSpendingMap,
  };
}

/**
 * 予算レコードと支出レコードをリンク
 */
function linkBudgetAndSpending(
  budgetRecords: BudgetRecord[],
  projectSpendingMap: Map<number, number[]>,
  spendingRecords: SpendingRecord[]
) {
  // 支出先IDから支出レコードを高速に引けるマップ
  const spendingMap = new Map<number, SpendingRecord>();
  for (const spending of spendingRecords) {
    spendingMap.set(spending.spendingId, spending);
  }

  for (const budget of budgetRecords) {
    const spendingIds = projectSpendingMap.get(budget.projectId) || [];
    budget.spendingIds = spendingIds;

    // この事業の総支出額を支出レコードから計算
    let totalSpending = 0;
    for (const spendingId of spendingIds) {
      const spending = spendingMap.get(spendingId);
      if (spending) {
        const project = spending.projects.find(p => p.projectId === budget.projectId);
        if (project) {
          totalSpending += project.amount;
        }
      }
    }
    budget.totalSpendingAmount = totalSpending;
  }
}

/**
 * 予算ツリーを構築
 */
function buildBudgetTree(budgetRecords: BudgetRecord[]): BudgetTree {
  // 組織階層の構造を構築
  type HierarchyNode = {
    name: string;
    children: Map<string, HierarchyNode>;
    projectIds: Set<number>;
    totalBudget: number;
  };

  const root: HierarchyNode = {
    name: 'root',
    children: new Map(),
    projectIds: new Set(),
    totalBudget: 0,
  };

  // ツリー構築
  for (const budget of budgetRecords) {
    let current = root;
    const path = budget.hierarchyPath;

    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      if (!segment) continue;

      if (!current.children.has(segment)) {
        current.children.set(segment, {
          name: segment,
          children: new Map(),
          projectIds: new Set(),
          totalBudget: 0,
        });
      }
      current = current.children.get(segment)!;

      // 最後の階層にのみprojectIdを追加
      if (i === path.length - 1) {
        current.projectIds.add(budget.projectId);
      }

      current.totalBudget += budget.totalBudget;
    }
  }

  // HierarchyNodeからBudgetTree形式に変換
  // データの種類ごとにIDを発番
  let ministryId = 1;
  let bureauId = 1;
  let departmentId = 1;
  let divisionId = 1;
  let officeId = 1;
  let groupId = 1;
  let sectionId = 1;

  const ministries: MinistryNode[] = [];

  for (const [ministryName, ministryNode] of root.children.entries()) {
    const ministry: MinistryNode = {
      id: ministryId++,
      name: ministryName,
      totalBudget: ministryNode.totalBudget,
      bureaus: [],
      projectIds: Array.from(ministryNode.projectIds),
    };

    for (const [bureauName, bureauNode] of ministryNode.children.entries()) {
      const bureau: BureauNode = {
        id: bureauId++,
        name: bureauName,
        totalBudget: bureauNode.totalBudget,
        departments: [],
        projectIds: Array.from(bureauNode.projectIds),
      };

      for (const [deptName, deptNode] of bureauNode.children.entries()) {
        const department: DepartmentNode = {
          id: departmentId++,
          name: deptName,
          totalBudget: deptNode.totalBudget,
          divisions: [],
          projectIds: Array.from(deptNode.projectIds),
        };

        for (const [divName, divNode] of deptNode.children.entries()) {
          const division: DivisionNode = {
            id: divisionId++,
            name: divName,
            totalBudget: divNode.totalBudget,
            offices: [],
            projectIds: Array.from(divNode.projectIds),
          };

          for (const [officeName, officeNode] of divNode.children.entries()) {
            const office: OfficeNode = {
              id: officeId++,
              name: officeName,
              totalBudget: officeNode.totalBudget,
              groups: [],
              projectIds: Array.from(officeNode.projectIds),
            };

            for (const [groupName, groupNode] of officeNode.children.entries()) {
              const group: GroupNode = {
                id: groupId++,
                name: groupName,
                totalBudget: groupNode.totalBudget,
                sections: [],
                projectIds: Array.from(groupNode.projectIds),
              };

              for (const [sectionName, sectionNode] of groupNode.children.entries()) {
                const section: SectionNode = {
                  id: sectionId++,
                  name: sectionName,
                  totalBudget: sectionNode.totalBudget,
                  projectIds: Array.from(sectionNode.projectIds),
                };
                group.sections.push(section);
              }

              office.groups.push(group);
            }

            division.offices.push(office);
          }

          department.divisions.push(division);
        }

        bureau.departments.push(department);
      }

      ministry.bureaus.push(bureau);
    }

    ministries.push(ministry);
  }

  // 全府省庁の予算額合計を計算
  const totalBudget = ministries.reduce((sum, m) => sum + m.totalBudget, 0);

  return {
    totalBudget,
    ministries,
  };
}

/**
 * 統計情報を構築
 */
function buildStatistics(
  budgetRecords: BudgetRecord[],
  spendingRecords: SpendingRecord[]
): Statistics {
  // 府省庁別統計
  const byMinistry: Statistics['byMinistry'] = {};
  const ministryRecipients = new Map<string, Set<number>>();

  for (const budget of budgetRecords) {
    const ministry = budget.ministry;
    if (!byMinistry[ministry]) {
      byMinistry[ministry] = {
        projectCount: 0,
        totalBudget: 0,
        totalSpending: 0,
        recipientCount: 0,
      };
      ministryRecipients.set(ministry, new Set());
    }

    byMinistry[ministry].projectCount++;
    byMinistry[ministry].totalBudget += budget.totalBudget;
    byMinistry[ministry].totalSpending += budget.totalSpendingAmount;

    for (const spendingId of budget.spendingIds) {
      ministryRecipients.get(ministry)!.add(spendingId);
    }
  }

  for (const [ministry, recipientSet] of ministryRecipients.entries()) {
    byMinistry[ministry].recipientCount = recipientSet.size;
  }

  // Top100支出先
  const topSpendingsByAmount = spendingRecords
    .slice(0, 100)
    .map(s => ({
      spendingId: s.spendingId,
      spendingName: s.spendingName,
      totalSpendingAmount: s.totalSpendingAmount,
      projectCount: s.projectCount,
    }));

  // Top100事業（予算額）
  const topProjectsByBudget = budgetRecords
    .sort((a, b) => b.totalBudget - a.totalBudget)
    .slice(0, 100)
    .map(b => ({
      projectId: b.projectId,
      projectName: b.projectName,
      ministry: b.ministry,
      totalBudget: b.totalBudget,
    }));

  // Top100事業（支出額）
  const topProjectsBySpending = budgetRecords
    .sort((a, b) => b.totalSpendingAmount - a.totalSpendingAmount)
    .slice(0, 100)
    .map(b => ({
      projectId: b.projectId,
      projectName: b.projectName,
      ministry: b.ministry,
      totalSpendingAmount: b.totalSpendingAmount,
    }));

  return {
    byMinistry,
    topSpendingsByAmount,
    topProjectsByBudget,
    topProjectsBySpending,
  };
}

main().catch(error => {
  console.error('エラーが発生しました:', error);
  process.exit(1);
});
