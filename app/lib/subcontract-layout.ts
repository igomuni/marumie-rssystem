import type { SubcontractGraph, BlockNode, BlockEdge } from '@/types/subcontract';

// ─── 定数 ──────────────────────────────────────────────

export const NODE_W = 200;
export const NODE_MIN_H = 40;
export const NODE_PAD = 16;
export const COL_GAP = 160;
export const ROW_PAD = 12;
export const ROOT_W = 160;
export const ROOT_H = 60;
export const SVG_MARGIN = { top: 24, right: 32, bottom: 32, left: 32 };

export const COLOR_DIRECT = '#3b82f6';
export const COLOR_SUBCONTRACT = '#f97316';
export const COLOR_ROOT = '#6b7280';
export const COLOR_EDGE = 'rgba(100,116,139,0.35)';

// ─── 型 ──────────────────────────────────────────────

export interface LayoutBlock {
  blockId: string;
  blockName: string;
  totalAmount: number;
  isDirect: boolean;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  node: BlockNode;
}

export interface LayoutRoot {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  sourceBlock: string | null;
  targetBlock: string;
  note?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SubcontractLayout {
  root: LayoutRoot;
  blocks: LayoutBlock[];
  edges: LayoutEdge[];
  svgWidth: number;
  svgHeight: number;
}

// ─── ヘルパー ──────────────────────────────────────────────

function formatYen(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万円`;
  return `${v.toLocaleString()}円`;
}
export { formatYen };

const MAX_DEPTH_LIMIT = 30;

/** blockId → depth (BFS、Fan-In: 最大深さ採用、サイクル対策あり) */
function computeDepths(flows: BlockEdge[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const queue: Array<{ blockId: string; depth: number }> = [];
  const children = new Map<string, string[]>();

  for (const f of flows) {
    if (f.sourceBlock === null) {
      queue.push({ blockId: f.targetBlock, depth: 1 });
    } else {
      if (!children.has(f.sourceBlock)) children.set(f.sourceBlock, []);
      children.get(f.sourceBlock)!.push(f.targetBlock);
    }
  }

  while (queue.length > 0) {
    const { blockId, depth } = queue.shift()!;
    const existing = depthMap.get(blockId) ?? 0;
    if (depth <= existing || depth > MAX_DEPTH_LIMIT) continue;
    depthMap.set(blockId, depth);
    for (const child of (children.get(blockId) ?? [])) {
      queue.push({ blockId: child, depth: depth + 1 });
    }
  }

  return depthMap;
}

/** ノードの高さを金額から算出（最小高さあり、比例スケール） */
function blockHeight(graph: SubcontractGraph, totalAmount: number): number {
  const maxAmount = Math.max(...graph.blocks.map((b) => b.totalAmount), 1);
  const maxH = 180;
  const scaled = NODE_MIN_H + (totalAmount / maxAmount) * (maxH - NODE_MIN_H);
  return Math.max(NODE_MIN_H, Math.round(scaled));
}

// ─── メインレイアウト関数 ──────────────────────────────────────────────

export function computeSubcontractLayout(graph: SubcontractGraph): SubcontractLayout {
  const depthMap = computeDepths(graph.flows);

  // ブロックノードをマップ化
  const blockById = new Map<string, BlockNode>();
  for (const b of graph.blocks) blockById.set(b.blockId, b);

  // 深さ別にブロックをグループ化（totalAmount 降順）
  const byDepth = new Map<number, BlockNode[]>();
  for (const [blockId, depth] of depthMap) {
    const node = blockById.get(blockId);
    if (!node) continue;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }
  for (const arr of byDepth.values()) {
    arr.sort((a, b) => b.totalAmount - a.totalAmount);
  }

  const maxDepth = depthMap.size > 0 ? Math.max(...depthMap.values()) : 1;

  // X座標: 深さ0=担当組織, 深さ1以降=ブロック
  // 担当組織 x=0, depth1 x=ROOT_W+COL_GAP, depth2 x=ROOT_W+COL_GAP+NODE_W+COL_GAP ...
  function depthToX(depth: number): number {
    if (depth === 0) return SVG_MARGIN.left;
    return SVG_MARGIN.left + ROOT_W + COL_GAP + (depth - 1) * (NODE_W + COL_GAP);
  }

  // Y座標計算 (各深さの列ごとに上から積み上げ)
  const layoutBlocks: LayoutBlock[] = [];
  const yNextByDepth = new Map<number, number>();

  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    let y = SVG_MARGIN.top;
    for (const node of nodes) {
      const h = blockHeight(graph, node.totalAmount);
      layoutBlocks.push({
        blockId: node.blockId,
        blockName: node.blockName,
        totalAmount: node.totalAmount,
        isDirect: node.isDirect,
        depth,
        x: depthToX(depth),
        y,
        w: NODE_W,
        h,
        node,
      });
      y += h + ROW_PAD;
    }
    yNextByDepth.set(depth, y);
  }

  // 担当組織ルートノード（Y中央）
  const depth1Nodes = byDepth.get(1) ?? [];
  const depth1TotalHeight = depth1Nodes.reduce((sum, n) => sum + blockHeight(graph, n.totalAmount) + ROW_PAD, 0) - ROW_PAD;
  const rootY = SVG_MARGIN.top + Math.max(0, (depth1TotalHeight - ROOT_H) / 2);

  const root: LayoutRoot = {
    label: graph.ministry,
    x: SVG_MARGIN.left,
    y: rootY,
    w: ROOT_W,
    h: ROOT_H,
  };

  // LayoutBlock → マップ
  const layoutById = new Map<string, LayoutBlock>();
  for (const lb of layoutBlocks) layoutById.set(lb.blockId, lb);

  // エッジ計算
  const edges: LayoutEdge[] = [];
  for (const f of graph.flows) {
    const target = layoutById.get(f.targetBlock);
    if (!target) continue;

    const tx = target.x;
    const ty = target.y + target.h / 2;

    if (f.sourceBlock === null) {
      // ルート → ブロック
      edges.push({
        ...f,
        x1: root.x + root.w,
        y1: root.y + root.h / 2,
        x2: tx,
        y2: ty,
      });
    } else {
      const source = layoutById.get(f.sourceBlock);
      if (!source) continue;
      edges.push({
        ...f,
        x1: source.x + source.w,
        y1: source.y + source.h / 2,
        x2: tx,
        y2: ty,
      });
    }
  }

  // SVGサイズ
  const maxX = SVG_MARGIN.left + ROOT_W + COL_GAP + maxDepth * (NODE_W + COL_GAP) + SVG_MARGIN.right;
  const maxY = Math.max(
    ...layoutBlocks.map((lb) => lb.y + lb.h),
    root.y + root.h,
    SVG_MARGIN.top + 100
  ) + SVG_MARGIN.bottom;

  return {
    root,
    blocks: layoutBlocks,
    edges,
    svgWidth: maxX,
    svgHeight: maxY,
  };
}

/** SVG ベジェ曲線パス (ソース右端 → ターゲット左端) */
export function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}
