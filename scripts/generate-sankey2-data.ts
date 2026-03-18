/**
 * /sankey2 用グラフデータ生成スクリプト
 *
 * 元CSV（data/year_2024/）から、ノード＋エッジのグラフ構造JSONを生成する。
 * 既存の generate-structured-json.ts とは独立したパイプライン。
 *
 * 出力: public/data/sankey2-graph.json（ノード・エッジ・メタデータ）
 *
 * 使用CSV:
 *   1-1: 組織情報（府省庁階層）
 *   2-1: 予算・執行サマリ（事業別予算額・執行額）
 *   5-1: 支出先・支出情報（支出先名・金額）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readShiftJISCSV, parseAmount } from './csv-reader';
import type { CSVRow } from '@/types/rs-system';
import type { RS2024StructuredData } from '@/types/structured';

// ─── 定数 ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data/year_2024');
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const OUTPUT_FILE = 'sankey2-graph.json';
const STRUCTURED_GZ = path.join(__dirname, '../public/data/rs2024-structured.json.gz');
const TARGET_BUDGET_YEAR = 2023; // 2024年度事業 → 2023年度予算データを使用

// ─── 型定義 ──────────────────────────────────────────────

/** グラフノード */
interface Sankey2Node {
  id: string;
  label: string;
  type: 'total' | 'ministry' | 'project-budget' | 'project-spending' | 'recipient';
  amount: number;       // 1円単位
  /** project-budget/project-spending のみ: 予算事業ID */
  projectId?: number;
  /** ministry / project のみ: 府省庁名 */
  ministry?: string;
  /** recipient のみ: 間接支出（委託経由）を含むか */
  isIndirect?: boolean;
  /** recipient のみ: ユニークな委託経路リスト */
  chainPaths?: string[];
}

/** グラフエッジ */
interface Sankey2Edge {
  source: string;
  target: string;
  value: number;        // フロー金額（1円単位）
  /** エッジ種別: direct=通常支出、subcontract=再委託 */
  edgeType?: 'direct' | 'subcontract';
}

/** 出力JSON */
interface Sankey2Graph {
  metadata: {
    generatedAt: string;
    totalBudget: number;
    totalSpending: number;
    projectCount: number;
    recipientCount: number;
    ministryCount: number;
    edgeCount: number;
  };
  nodes: Sankey2Node[];
  edges: Sankey2Edge[];
}

// ─── CSV読み込み ──────────────────────────────────────────

function loadCSV(filename: string): CSVRow[] {
  const filePath = path.join(DATA_DIR, filename);
  console.log(`  読み込み中: ${filename}`);
  const rows = readShiftJISCSV(filePath);
  console.log(`    → ${rows.length.toLocaleString()} 行`);
  return rows;
}

// ─── メイン処理 ──────────────────────────────────────────

function main() {
  console.log('=== sankey2 グラフデータ生成 ===\n');

  // 1. CSV読み込み
  console.log('[1/4] CSV読み込み');
  const orgRows = loadCSV('1-1_RS_2024_基本情報_組織情報.csv');
  const budgetRows = loadCSV('2-1_RS_2024_予算・執行_サマリ.csv');
  const spendingRows = loadCSV('5-1_RS_2024_支出先_支出情報.csv');

  // 2. 組織情報マップ（予算事業ID → 府省庁名）
  console.log('\n[2/4] ノード生成');
  const orgMap = new Map<number, { ministry: string; projectName: string }>();
  for (const row of orgRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    orgMap.set(pid, {
      ministry: row['府省庁'] || row['所管府省庁'] || '',
      projectName: row['事業名'] || '',
    });
  }
  console.log(`  組織情報: ${orgMap.size.toLocaleString()} 事業`);

  // 3. 予算データ集計（予算事業ID → 予算額・執行額）
  //    会計区分ごとに複数行あるため、予算年度=2023 のみ集約
  const budgetMap = new Map<number, { totalBudget: number; executedAmount: number }>();
  for (const row of budgetRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    const fiscalYear = parseInt(row['予算年度'], 10);
    if (fiscalYear !== TARGET_BUDGET_YEAR) continue;
    if (!orgMap.has(pid)) continue;

    const existing = budgetMap.get(pid) || { totalBudget: 0, executedAmount: 0 };
    existing.totalBudget += parseAmount(row['計(歳出予算現額合計)']);
    existing.executedAmount += parseAmount(row['執行額(合計)']);
    budgetMap.set(pid, existing);
  }
  console.log(`  予算データ: ${budgetMap.size.toLocaleString()} 事業（予算年度${TARGET_BUDGET_YEAR}）`);

  // 4. 支出データ集計
  //    支出先名がある個別行のみ対象（ブロック集計行は除外）
  //    支出先の一意キー: 支出先名（法人番号は参考情報として保持）
  interface RecipientAgg {
    name: string;
    totalAmount: number;
    projectAmounts: Map<number, number>; // projectId → amount
  }
  const recipientMap = new Map<string, RecipientAgg>();

  // 事業ごとの支出合計
  const projectSpendingMap = new Map<number, number>();

  let skippedNoName = 0;
  let skippedNoAmount = 0;
  let totalRows = 0;

  for (const row of spendingRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    if (!orgMap.has(pid)) continue;

    const spendingName = (row['支出先名'] || '').trim();
    if (!spendingName) { skippedNoName++; continue; }

    const amount = parseAmount(row['金額']);
    if (amount <= 0) { skippedNoAmount++; continue; }

    totalRows++;

    // 支出先集計
    const recipientKey = spendingName;
    let recipient = recipientMap.get(recipientKey);
    if (!recipient) {
      recipient = { name: spendingName, totalAmount: 0, projectAmounts: new Map() };
      recipientMap.set(recipientKey, recipient);
    }
    recipient.totalAmount += amount;
    const prevProjectAmt = recipient.projectAmounts.get(pid) || 0;
    recipient.projectAmounts.set(pid, prevProjectAmt + amount);

    // 事業別支出合計
    projectSpendingMap.set(pid, (projectSpendingMap.get(pid) || 0) + amount);
  }

  console.log(`  支出データ: ${totalRows.toLocaleString()} 行（支出先名なし=${skippedNoName.toLocaleString()}, 金額0=${skippedNoAmount.toLocaleString()}）`);
  console.log(`  ユニーク支出先: ${recipientMap.size.toLocaleString()} 件`);

  // 5. ノード生成
  console.log('\n[3/4] グラフ構築');
  const nodes: Sankey2Node[] = [];
  const edges: Sankey2Edge[] = [];

  // 5a. 全体ノード
  let totalBudget = 0;
  let totalSpending = 0;
  for (const [, b] of budgetMap) totalBudget += b.totalBudget;
  for (const [, s] of projectSpendingMap) totalSpending += s;

  nodes.push({
    id: 'total',
    label: '予算総計',
    type: 'total',
    amount: totalBudget,
  });

  // 5b. 府省庁ノード（orgMap ベース: 予算データのない事業も含む全5,664件）
  const ministryAmounts = new Map<string, { budget: number; spending: number }>();

  for (const [pid, org] of orgMap) {
    const m = org.ministry;
    const existing = ministryAmounts.get(m) || { budget: 0, spending: 0 };
    const budget = budgetMap.get(pid);
    if (budget) existing.budget += budget.totalBudget;
    existing.spending += projectSpendingMap.get(pid) || 0;
    ministryAmounts.set(m, existing);
  }

  for (const [ministry, amounts] of ministryAmounts) {
    const ministryId = `ministry-${ministry}`;
    nodes.push({
      id: ministryId,
      label: ministry,
      type: 'ministry',
      amount: amounts.budget,
      ministry,
    });
    // 全体 → 府省庁エッジ（予算額ベース）
    if (amounts.budget > 0) {
      edges.push({
        source: 'total',
        target: ministryId,
        value: amounts.budget,
      });
    }
  }
  console.log(`  府省庁: ${ministryAmounts.size} 件`);

  // 5c. 事業ノード（orgMap ベース: 全5,664事業。予算データなし=金額0）
  let projectCount = 0;
  let projectsWithoutBudget = 0;
  for (const [pid, org] of orgMap) {
    projectCount++;
    const budget = budgetMap.get(pid) || { totalBudget: 0, executedAmount: 0 };
    const spending = projectSpendingMap.get(pid) || 0;
    const budgetNodeId = `project-budget-${pid}`;
    const spendingNodeId = `project-spending-${pid}`;

    if (!budgetMap.has(pid)) projectsWithoutBudget++;

    // 事業(予算)ノード
    nodes.push({
      id: budgetNodeId,
      label: org.projectName,
      type: 'project-budget',
      amount: budget.totalBudget,
      projectId: pid,
      ministry: org.ministry,
    });

    // 事業(支出)ノード
    nodes.push({
      id: spendingNodeId,
      label: org.projectName,
      type: 'project-spending',
      amount: spending,
      projectId: pid,
      ministry: org.ministry,
    });

    // 府省庁 → 事業(予算)（予算額>0の場合のみ）
    if (budget.totalBudget > 0) {
      edges.push({
        source: `ministry-${org.ministry}`,
        target: budgetNodeId,
        value: budget.totalBudget,
      });
    }

    // 事業(予算) → 事業(支出)（両方>0の場合のみ）
    const flowValue = Math.min(budget.totalBudget, spending);
    if (flowValue > 0) {
      edges.push({
        source: budgetNodeId,
        target: spendingNodeId,
        value: flowValue,
      });
    }
  }
  console.log(`  事業: ${projectCount.toLocaleString()} 件（うち予算データなし=${projectsWithoutBudget}）`);

  // 5d. 支出先ノード
  for (const [key, recipient] of recipientMap) {
    const recipientId = `recipient-${key}`;
    nodes.push({
      id: recipientId,
      label: recipient.name,
      type: 'recipient',
      amount: recipient.totalAmount,
    });

    // 事業(支出) → 支出先エッジ
    for (const [pid, amount] of recipient.projectAmounts) {
      edges.push({
        source: `project-spending-${pid}`,
        target: recipientId,
        value: amount,
      });
    }
  }
  console.log(`  支出先: ${recipientMap.size.toLocaleString()} 件`);
  console.log(`  エッジ: ${edges.length.toLocaleString()} 件`);

  // 5e. 委託チェーン情報の付与（structured.json から）
  console.log('\n[3.5/4] 委託チェーン情報の付与');
  let structuredData: RS2024StructuredData | null = null;
  if (fs.existsSync(STRUCTURED_GZ)) {
    const gzBuf = fs.readFileSync(STRUCTURED_GZ);
    structuredData = JSON.parse(zlib.gunzipSync(gzBuf).toString('utf-8'));
    console.log(`  structured.json 読み込み完了（${structuredData!.spendings.length.toLocaleString()} 支出先）`);
  } else {
    console.log('  ⚠ structured.json.gz が見つかりません。委託チェーン情報なしで出力します。');
  }

  if (structuredData) {
    // recipientノードのindexを作成（高速検索用）
    const recipientNodeIndex = new Map<string, Sankey2Node>();
    for (const node of nodes) {
      if (node.type === 'recipient') {
        recipientNodeIndex.set(node.label, node);
      }
    }

    // 支出先ごとの委託情報を付与
    let enrichedCount = 0;
    for (const spending of structuredData.spendings) {
      const recipientNode = recipientNodeIndex.get(spending.spendingName);
      if (!recipientNode) continue;

      // isIndirect: いずれかのprojectでisDirectFromGov === false
      const hasIndirect = spending.projects.some(p => p.isDirectFromGov === false);
      if (hasIndirect) {
        recipientNode.isIndirect = true;
        enrichedCount++;
      }

      // chainPaths: sourceChainPathをSetで収集（ユニーク化）
      const pathSet = new Set<string>();
      for (const p of spending.projects) {
        if (p.sourceChainPath) pathSet.add(p.sourceChainPath);
      }
      if (pathSet.size > 0) {
        recipientNode.chainPaths = [...pathSet];
      }
    }
    console.log(`  間接支出ノード: ${enrichedCount.toLocaleString()} 件`);

    // 再委託エッジの生成（outflows.recipients から recipient→recipient）
    let subcontractEdgeCount = 0;
    const subcontractAmounts = new Map<string, number>(); // edgeKey → amount
    let unmatchedFlows = 0;

    for (const spending of structuredData.spendings) {
      if (!spending.outflows || spending.outflows.length === 0) continue;
      const sourceNode = recipientNodeIndex.get(spending.spendingName);
      if (!sourceNode) continue;

      for (const flow of spending.outflows) {
        // recipients[] の個別名でマッチング（targetBlockNameは「〜ほか」等でマッチしにくい）
        if (flow.recipients && flow.recipients.length > 0) {
          for (const r of flow.recipients) {
            const targetNode = recipientNodeIndex.get(r.name);
            if (!targetNode) { unmatchedFlows++; continue; }
            if (sourceNode.id === targetNode.id) continue;

            const edgeKey = `${sourceNode.id}→${targetNode.id}`;
            subcontractAmounts.set(edgeKey, (subcontractAmounts.get(edgeKey) || 0) + r.amount);
          }
        } else {
          // recipients がない場合は targetBlockName でフォールバック
          const targetNode = recipientNodeIndex.get(flow.targetBlockName);
          if (!targetNode) { unmatchedFlows++; continue; }
          if (sourceNode.id === targetNode.id) continue;

          const edgeKey = `${sourceNode.id}→${targetNode.id}`;
          subcontractAmounts.set(edgeKey, (subcontractAmounts.get(edgeKey) || 0) + flow.amount);
        }
      }
    }

    // 累積結果をエッジに変換
    for (const [edgeKey, amount] of subcontractAmounts) {
      if (amount <= 0) continue;
      const [sourceId, targetId] = edgeKey.split('→');

      edges.push({
        source: sourceId,
        target: targetId,
        value: amount,
        edgeType: 'subcontract',
      });
      subcontractEdgeCount++;
    }
    console.log(`  再委託エッジ: ${subcontractEdgeCount.toLocaleString()} 件（未マッチ: ${unmatchedFlows.toLocaleString()}）`);
  }

  console.log(`  最終エッジ数: ${edges.length.toLocaleString()} 件`);

  // 6. 出力
  console.log('\n[4/4] JSON出力');
  const graph: Sankey2Graph = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalBudget,
      totalSpending,
      projectCount,
      recipientCount: recipientMap.size,
      ministryCount: ministryAmounts.size,
      edgeCount: edges.length,
    },
    nodes,
    edges,
  };

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(graph));

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`  出力: ${outputPath}`);
  console.log(`  サイズ: ${sizeMB} MB`);
  console.log(`
=== サマリ ===
  総予算: ${(totalBudget / 1e12).toFixed(2)} 兆円
  総支出: ${(totalSpending / 1e12).toFixed(2)} 兆円
  府省庁: ${ministryAmounts.size} 件
  事業:   ${projectCount.toLocaleString()} 件（うち予算データなし=${projectsWithoutBudget}）
  支出先: ${recipientMap.size.toLocaleString()} 件
  エッジ: ${edges.length.toLocaleString()} 件
`);
}

main();
