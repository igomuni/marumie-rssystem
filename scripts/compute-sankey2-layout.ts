/**
 * /sankey2 レイアウト計算スクリプト
 *
 * sankey2-graph.json からノード座標・エッジBezierパスを事前計算し、
 * sankey2-layout.json に出力する。
 *
 * レイアウト方針:
 *   - X座標: type別ベースライン（左→右の大まかな流れ）
 *   - Y座標: 府省庁セクション分割、金額比例高さ
 *   - エッジ: 3次Bezier曲線（S字カーブ）
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 定数 ──────────────────────────────────────────────

/** type別のX座標ベースライン */
const LAYER_X: Record<string, number> = {
  'total':            0,
  'ministry':         400,
  'project-budget':   800,
  'project-spending': 1200,
  'recipient':        1600,
};

const NODE_WIDTH = 50;

/** ノード高さ計算用 */
const MIN_NODE_HEIGHT = 1;
const AMOUNT_SCALE = 1e-11;  // 1兆円 = 10px

/** ノード間の垂直余白 */
const NODE_VERTICAL_GAP = 2;

/** 府省庁セクション間の垂直余白 */
const MINISTRY_SECTION_GAP = 20;

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
      totalWidth: number;
      totalHeight: number;
      nodeCount: number;
      edgeCount: number;
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
  const offset = dx * BEZIER_CONTROL_RATIO;
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
  console.log('=== sankey2 レイアウト計算 ===\n');

  // 1. グラフデータ読み込み
  const inputPath = path.join(__dirname, '../public/data/sankey2-graph.json');
  console.log('[1/5] グラフデータ読み込み');
  const graph: GraphData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`  ノード: ${graph.nodes.length.toLocaleString()}`);
  console.log(`  エッジ: ${graph.edges.length.toLocaleString()}`);

  // ノードマップ
  const nodeMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodeMap.set(node.id, node);

  // 2. X座標の割り当て
  console.log('\n[2/5] X座標計算');
  const layoutNodes: LayoutNode[] = [];
  const layoutNodeMap = new Map<string, LayoutNode>();

  for (const node of graph.nodes) {
    const x = LAYER_X[node.type] ?? 0;
    const height = amountToHeight(node.amount);
    const ln: LayoutNode = {
      id: node.id,
      label: node.label,
      type: node.type,
      amount: node.amount,
      x,
      y: 0, // Phase 3で計算
      width: NODE_WIDTH,
      height,
      ...(node.ministry && { ministry: node.ministry }),
      ...(node.projectId !== undefined && { projectId: node.projectId }),
    };
    layoutNodes.push(ln);
    layoutNodeMap.set(ln.id, ln);
  }

  // 3. Y座標の計算（府省庁セクション分割）
  console.log('\n[3/5] Y座標計算');

  // 府省庁を金額降順にソート
  const ministryNodes = layoutNodes
    .filter(n => n.type === 'ministry')
    .sort((a, b) => b.amount - a.amount);

  const ministryOrder = ministryNodes.map(n => n.label);
  console.log(`  府省庁セクション: ${ministryOrder.length}`);

  // 各typeのノードを府省庁別にグルーピング
  const typeGroups = ['total', 'ministry', 'project-budget', 'project-spending', 'recipient'];

  // 支出先は複数事業から受け取るため、最大金額の事業の府省庁でグルーピング
  // まず支出先→府省庁の最大フローを計算
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

  // type別・府省庁別にノードをグルーピングして積み上げ
  for (const type of typeGroups) {
    if (type === 'total') {
      // totalノードは1つだけ、Y=0
      const totalNode = layoutNodeMap.get('total');
      if (totalNode) totalNode.y = 0;
      continue;
    }

    let currentY = 0;

    for (const ministry of ministryOrder) {
      let nodesInSection: LayoutNode[];

      if (type === 'ministry') {
        nodesInSection = layoutNodes.filter(n => n.type === type && n.label === ministry);
      } else if (type === 'recipient') {
        nodesInSection = layoutNodes.filter(n => n.type === type && recipientMinistry.get(n.id) === ministry);
      } else {
        nodesInSection = layoutNodes.filter(n => n.type === type && n.ministry === ministry);
      }

      // 金額降順ソート
      nodesInSection.sort((a, b) => b.amount - a.amount);

      for (const node of nodesInSection) {
        node.y = currentY;
        currentY += node.height + NODE_VERTICAL_GAP;
      }

      if (nodesInSection.length > 0) {
        currentY += MINISTRY_SECTION_GAP;
      }
    }

    // 府省庁に紐づかない支出先（フォールバック）
    if (type === 'recipient') {
      const unassigned = layoutNodes.filter(n => n.type === 'recipient' && !recipientMinistry.has(n.id));
      for (const node of unassigned) {
        node.y = currentY;
        currentY += node.height + NODE_VERTICAL_GAP;
      }
    }
  }

  // totalノードのY座標: 府省庁セクション全体の中央に配置
  const totalNode = layoutNodeMap.get('total');
  if (totalNode) {
    const ministryYs = ministryNodes.map(n => n.y + n.height / 2);
    if (ministryYs.length > 0) {
      totalNode.y = (Math.min(...ministryYs) + Math.max(...ministryYs)) / 2 - totalNode.height / 2;
    }
  }

  // 4. エッジBezierパス計算
  console.log('\n[4/5] エッジパス計算');
  const maxEdgeValue = Math.max(...graph.edges.map(e => e.value));
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

  // 5. バウンディングボックス計算 & 出力
  console.log('\n[5/5] JSON出力');
  let maxX = 0, maxY = 0;
  for (const node of layoutNodes) {
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  const layoutData: LayoutData = {
    metadata: {
      ...graph.metadata,
      layout: {
        totalWidth: Math.ceil(maxX),
        totalHeight: Math.ceil(maxY),
        nodeCount: layoutNodes.length,
        edgeCount: layoutEdges.length,
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
  console.log(`  仮想空間: ${Math.ceil(maxX).toLocaleString()} × ${Math.ceil(maxY).toLocaleString()} px`);
  console.log(`
=== サマリ ===
  ノード: ${layoutNodes.length.toLocaleString()} 件
  エッジ: ${layoutEdges.length.toLocaleString()} 件
  仮想空間: ${Math.ceil(maxX).toLocaleString()} × ${Math.ceil(maxY).toLocaleString()} px
  ファイルサイズ: ${sizeMB} MB
`);
}

main();
