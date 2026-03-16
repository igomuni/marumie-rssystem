/**
 * /sankey2 レイアウト計算スクリプト（グリッド配置版）
 *
 * sankey2-graph.json からノード座標・エッジBezierパスを事前計算し、
 * sankey2-layout.json に出力する。
 *
 * レイアウト方針:
 *   - 37府省庁を6列×7行のグリッドに配置（予算額降順）
 *   - 各セルが独立したミニSankeyフロー（ministry→project→recipient）
 *   - ノード高さ: 線形スケール、GAP=0px
 *   - エッジ: 3次Bezier曲線（S字カーブ）
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 定数 ──────────────────────────────────────────────

/** グリッド設定 */
const GRID_COLS = 6;
const CELL_WIDTH = 400;       // セル幅（4type帯 × 100px）
const CELL_H_GAP = 50;       // セル間の水平余白
const CELL_V_GAP = 50;       // 行間の垂直余白

/** セル内のtype別X座標オフセット */
const TYPE_X_OFFSET: Record<string, number> = {
  'ministry':         0,
  'project-budget':   100,
  'project-spending': 200,
  'recipient':        300,
};

const NODE_WIDTH = 50;

/** ノード高さ計算用 */
const MIN_NODE_HEIGHT = 1;
const AMOUNT_SCALE = 1e-11;  // 1兆円 = 10px

/** totalノードの配置 */
const TOTAL_X = -200;        // グリッド左外

/** Bezier制御点のオフセット比率（水平距離の40%） */
const BEZIER_CONTROL_RATIO = 0.4;

/** Bezierパスの分割数 */
const BEZIER_SEGMENTS = 12;

// ─── 型定義 ──────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: string;
  amount: number;
  projectId?: number;
  ministry?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  value: number;
}

interface GraphData {
  metadata: Record<string, unknown>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface LayoutNode {
  id: string;
  label: string;
  type: string;
  amount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  ministry?: string;
  projectId?: number;
}

interface LayoutEdge {
  source: string;
  target: string;
  value: number;
  path: [number, number][];
  width: number;
}

interface LayoutData {
  metadata: Record<string, unknown> & {
    layout: {
      minX: number;
      totalWidth: number;
      totalHeight: number;
      nodeCount: number;
      edgeCount: number;
      gridCols: number;
      gridRows: number;
    };
  };
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

// ─── ユーティリティ ──────────────────────────────────────

/** 金額からノード高さを計算 */
function amountToHeight(amount: number): number {
  if (amount <= 0) return MIN_NODE_HEIGHT;
  return Math.max(MIN_NODE_HEIGHT, amount * AMOUNT_SCALE);
}

/** 3次Bezier補間 */
function cubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    Math.round(mt3 * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t3 * p3[0]),
    Math.round(mt3 * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t3 * p3[1]),
  ];
}

/** Bezierパス生成（S字カーブ） */
function generateBezierPath(
  sx: number, sy: number, tx: number, ty: number
): [number, number][] {
  const dx = tx - sx;
  const offset = Math.abs(dx) * BEZIER_CONTROL_RATIO;
  const p0: [number, number] = [sx, sy];
  const p1: [number, number] = [sx + offset, sy];
  const p2: [number, number] = [tx - offset, ty];
  const p3: [number, number] = [tx, ty];

  const points: [number, number][] = [];
  for (let i = 0; i <= BEZIER_SEGMENTS; i++) {
    points.push(cubicBezier(p0, p1, p2, p3, i / BEZIER_SEGMENTS));
  }
  return points;
}

/** エッジ幅の計算（対数スケール） */
function valueToWidth(value: number, maxValue: number): number {
  if (value <= 0) return 0.5;
  const logScale = Math.log10(value + 1) / Math.log10(maxValue + 1);
  return Math.max(0.5, logScale * 20);
}

// ─── メイン処理 ──────────────────────────────────────────

function main() {
  console.log('=== sankey2 グリッドレイアウト計算 ===\n');

  // 1. グラフデータ読み込み
  const inputPath = path.join(__dirname, '../public/data/sankey2-graph.json');
  console.log('[1/5] グラフデータ読み込み');
  const graph: GraphData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`  ノード: ${graph.nodes.length.toLocaleString()}`);
  console.log(`  エッジ: ${graph.edges.length.toLocaleString()}`);

  // ノードマップ
  const nodeMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodeMap.set(node.id, node);

  // 2. 支出先→府省庁の帰属計算（最大フロー元）
  console.log('\n[2/5] 支出先の府省庁帰属計算');
  const recipientMinistry = new Map<string, string>();
  const recipientMinistryAmount = new Map<string, number>();

  for (const edge of graph.edges) {
    if (!edge.source.startsWith('project-spending-')) continue;
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode?.ministry) continue;
    const prev = recipientMinistryAmount.get(edge.target) || 0;
    if (edge.value > prev) {
      recipientMinistry.set(edge.target, sourceNode.ministry);
      recipientMinistryAmount.set(edge.target, edge.value);
    }
  }
  console.log(`  帰属決定: ${recipientMinistry.size.toLocaleString()} 支出先`);

  // 3. 府省庁別にノードをグルーピング
  console.log('\n[3/5] グリッド配置');
  const ministryNodeGroups = new Map<string, Map<string, GraphNode[]>>();

  for (const node of graph.nodes) {
    if (node.type === 'total') continue;

    let ministry: string | undefined;
    if (node.type === 'ministry') {
      ministry = node.label;
    } else if (node.type === 'recipient') {
      ministry = recipientMinistry.get(node.id);
    } else {
      ministry = node.ministry;
    }
    if (!ministry) continue;

    if (!ministryNodeGroups.has(ministry)) {
      ministryNodeGroups.set(ministry, new Map());
    }
    const typeMap = ministryNodeGroups.get(ministry)!;
    if (!typeMap.has(node.type)) typeMap.set(node.type, []);
    typeMap.get(node.type)!.push(node);
  }

  // 府省庁を予算額降順にソート
  const ministrySorted = graph.nodes
    .filter(n => n.type === 'ministry')
    .sort((a, b) => b.amount - a.amount)
    .map(n => n.label);

  const gridRows = Math.ceil(ministrySorted.length / GRID_COLS);
  console.log(`  グリッド: ${GRID_COLS}列 × ${gridRows}行`);

  // 4. セル内レイアウト計算
  const layoutNodes: LayoutNode[] = [];
  const layoutNodeMap = new Map<string, LayoutNode>();
  const types = ['ministry', 'project-budget', 'project-spending', 'recipient'];

  // 各セルの高さを計算（行ごとの最大高さで揃える）
  const cellHeights: number[] = new Array(ministrySorted.length).fill(0);

  for (let i = 0; i < ministrySorted.length; i++) {
    const ministry = ministrySorted[i];
    const typeMap = ministryNodeGroups.get(ministry);
    if (!typeMap) continue;

    let maxColHeight = 0;
    for (const type of types) {
      const nodes = typeMap.get(type) || [];
      let colHeight = 0;
      for (const node of nodes) {
        colHeight += amountToHeight(node.amount); // GAP=0
      }
      maxColHeight = Math.max(maxColHeight, colHeight);
    }
    cellHeights[i] = maxColHeight;
  }

  // 行ごとの高さ（行内の最大セル高さで揃える）
  const rowHeights: number[] = [];
  for (let row = 0; row < gridRows; row++) {
    let maxH = 0;
    for (let col = 0; col < GRID_COLS; col++) {
      const idx = row * GRID_COLS + col;
      if (idx < cellHeights.length) {
        maxH = Math.max(maxH, cellHeights[idx]);
      }
    }
    rowHeights.push(maxH);
  }

  // 行のY開始位置
  const rowYStart: number[] = [];
  let cumY = 0;
  for (let row = 0; row < gridRows; row++) {
    rowYStart.push(cumY);
    cumY += rowHeights[row] + CELL_V_GAP;
  }

  console.log(`  行高さ: ${rowHeights.map(h => Math.round(h)).join(', ')}`);

  // 各府省庁のノードを配置
  for (let i = 0; i < ministrySorted.length; i++) {
    const ministry = ministrySorted[i];
    const typeMap = ministryNodeGroups.get(ministry);
    if (!typeMap) continue;

    const gridCol = i % GRID_COLS;
    const gridRow = Math.floor(i / GRID_COLS);

    const cellLeft = gridCol * (CELL_WIDTH + CELL_H_GAP);
    const cellTop = rowYStart[gridRow];

    for (const type of types) {
      const nodes = typeMap.get(type) || [];
      // 金額降順ソート
      nodes.sort((a, b) => b.amount - a.amount);

      const typeX = cellLeft + (TYPE_X_OFFSET[type] ?? 0);
      let y = cellTop;

      for (const node of nodes) {
        const height = amountToHeight(node.amount);
        const ln: LayoutNode = {
          id: node.id,
          label: node.label,
          type: node.type,
          amount: node.amount,
          x: typeX,
          y,
          width: NODE_WIDTH,
          height,
          ...(node.ministry && { ministry: node.ministry }),
          ...(node.projectId !== undefined && { projectId: node.projectId }),
        };
        layoutNodes.push(ln);
        layoutNodeMap.set(ln.id, ln);
        y += height; // GAP=0
      }
    }
  }

  // 府省庁に帰属しない支出先（フォールバック: 最終セルの下）
  const unassignedRecipients = graph.nodes.filter(
    n => n.type === 'recipient' && !recipientMinistry.has(n.id)
  );
  if (unassignedRecipients.length > 0) {
    console.log(`  未帰属支出先: ${unassignedRecipients.length} 件（最終行下に配置）`);
    let y = cumY;
    for (const node of unassignedRecipients) {
      const height = amountToHeight(node.amount);
      const ln: LayoutNode = {
        id: node.id,
        label: node.label,
        type: node.type,
        amount: node.amount,
        x: (GRID_COLS - 1) * (CELL_WIDTH + CELL_H_GAP) + (TYPE_X_OFFSET['recipient'] ?? 0),
        y,
        width: NODE_WIDTH,
        height,
      };
      layoutNodes.push(ln);
      layoutNodeMap.set(ln.id, ln);
      y += height;
    }
  }

  // totalノード: グリッド左外、全体の垂直中央
  const totalGraphNode = graph.nodes.find(n => n.type === 'total');
  if (totalGraphNode) {
    const totalHeight = amountToHeight(totalGraphNode.amount);
    const gridTotalHeight = cumY - CELL_V_GAP;
    const ln: LayoutNode = {
      id: totalGraphNode.id,
      label: totalGraphNode.label,
      type: totalGraphNode.type,
      amount: totalGraphNode.amount,
      x: TOTAL_X,
      y: gridTotalHeight / 2 - totalHeight / 2,
      width: NODE_WIDTH,
      height: totalHeight,
    };
    layoutNodes.push(ln);
    layoutNodeMap.set(ln.id, ln);
  }

  console.log(`  配置済みノード: ${layoutNodes.length.toLocaleString()}`);

  // 5. エッジBezierパス計算
  console.log('\n[4/5] エッジパス計算');
  const maxEdgeValue = graph.edges.length > 0
    ? Math.max(...graph.edges.map(e => e.value))
    : 1;
  const layoutEdges: LayoutEdge[] = [];

  for (const edge of graph.edges) {
    const source = layoutNodeMap.get(edge.source);
    const target = layoutNodeMap.get(edge.target);
    if (!source || !target) continue;

    // ソースの右端 → ターゲットの左端
    const sx = source.x + source.width;
    const sy = source.y + source.height / 2;
    const tx = target.x;
    const ty = target.y + target.height / 2;

    layoutEdges.push({
      source: edge.source,
      target: edge.target,
      value: edge.value,
      path: generateBezierPath(sx, sy, tx, ty),
      width: valueToWidth(edge.value, maxEdgeValue),
    });
  }
  console.log(`  エッジパス: ${layoutEdges.length.toLocaleString()} 件`);

  // 6. バウンディングボックス計算 & 出力
  console.log('\n[5/5] JSON出力');
  let minX = 0, maxX = 0, maxY = 0;
  for (const node of layoutNodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  const layoutData: LayoutData = {
    metadata: {
      ...graph.metadata,
      layout: {
        minX: Math.floor(minX),
        totalWidth: Math.ceil(maxX - minX),
        totalHeight: Math.ceil(maxY),
        nodeCount: layoutNodes.length,
        edgeCount: layoutEdges.length,
        gridCols: GRID_COLS,
        gridRows,
      },
    },
    nodes: layoutNodes,
    edges: layoutEdges,
  };

  const outputPath = path.join(__dirname, '../public/data/sankey2-layout.json');
  fs.writeFileSync(outputPath, JSON.stringify(layoutData));

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`  出力: ${outputPath}`);
  console.log(`  サイズ: ${sizeMB} MB`);
  const totalWidth = Math.ceil(maxX - minX);
  const totalHeight = Math.ceil(maxY);
  console.log(`  仮想空間: ${totalWidth.toLocaleString()} × ${totalHeight.toLocaleString()} px (minX: ${Math.floor(minX)})`);
  console.log(`
=== サマリ ===
  グリッド: ${GRID_COLS}列 × ${gridRows}行
  ノード: ${layoutNodes.length.toLocaleString()} 件
  エッジ: ${layoutEdges.length.toLocaleString()} 件
  仮想空間: ${totalWidth.toLocaleString()} × ${totalHeight.toLocaleString()} px
  ファイルサイズ: ${sizeMB} MB
`);
}

main();
