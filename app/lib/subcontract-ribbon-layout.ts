import type {
  SubcontractGraph,
  BlockNode,
  BlockOriginKind,
  FlowOrigin,
} from '@/types/subcontract';
import { computeDepths, mergeParallelFlows } from '@/app/lib/subcontract-layout';

/**
 * B案（サンキー風横フロー・リボン表現）のレイアウト計算。
 *
 * 列 = 深度（col0 = ルート、col1 = 深度1、…）。列内はバー（縦長の矩形）を
 * 積み上げて並べ、列間はリボン（帯）で繋ぐ。既存A案（subcontract-layout.ts）の
 * computeDepths / mergeParallelFlows をそのまま再利用し、深度・エッジのマージ規則を
 * 統一する（同じグラフに対して両ビューが矛盾しないことを保証するため）。
 */

// ─── 定数 ──────────────────────────────────────────────

export const RIBBON_COL_W = 300;
export const RIBBON_COL_GAP = 120;
export const RIBBON_ROW_GAP = 14;
export const RIBBON_RIBBON_GAP = 2;
export const RIBBON_BAR_MIN_H = 28;
export const RIBBON_BAR_MAX_H = 160;
export const RIBBON_ROOT_H = 120;
export const RIBBON_MARGIN = { top: 28, right: 36, bottom: 40, left: 36 };
export const RIBBON_MIN_THICKNESS = 3;

const ROOT_KEY = '__root__';

// ─── 型 ──────────────────────────────────────────────

export interface RibbonBar {
  blockId: string;
  blockName: string;
  totalAmount: number;
  originKind: BlockOriginKind;
  isTerminal: boolean;
  isZeroAmount: boolean;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  node: BlockNode;
}

export interface RibbonRoot {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 順方向フロー（col間を繋ぐ帯）。太さは往路・復路とも同じ値で一定（テーパーなし） */
export interface RibbonFlow {
  sourceBlock: string | null;
  targetBlock: string;
  origin: FlowOrigin;
  isReference: boolean;
  note?: string;
  targetIncomingBlockCount: number;
  x1: number;
  y1Top: number;
  y1Bot: number;
  x2: number;
  y2Top: number;
  y2Bot: number;
}

/** バックエッジ・自己ループ（細線・簡略表現） */
export interface RibbonBackEdge {
  sourceBlock: string | null;
  targetBlock: string;
  origin: FlowOrigin;
  isReference: boolean;
  note?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isSelfLoop: boolean;
}

export interface SubcontractRibbonLayout {
  root: RibbonRoot;
  bars: RibbonBar[];
  flows: RibbonFlow[];
  backEdges: RibbonBackEdge[];
  svgWidth: number;
  svgHeight: number;
  maxAmount: number;
}

// ─── スケール関数 ──────────────────────────────────────────────

/**
 * 金額 → バー高さ / リボン太さ（平方根スケール）。
 * 全ノード中の最大金額を RIBBON_BAR_MAX_H に、0円・極小額でも RIBBON_BAR_MIN_H を確保する。
 */
export function ribbonAmountScale(amount: number, maxAmount: number): number {
  if (amount <= 0 || maxAmount <= 0) return RIBBON_BAR_MIN_H;
  const t = Math.sqrt(Math.min(1, amount / maxAmount));
  return RIBBON_BAR_MIN_H + t * (RIBBON_BAR_MAX_H - RIBBON_BAR_MIN_H);
}

// ─── パス生成 ──────────────────────────────────────────────

/** サンキー風の帯（一定太さ、両端をベジェで滑らかに繋ぐ塗りパス） */
export function ribbonFlowPath(x1: number, y1Top: number, y1Bot: number, x2: number, y2Top: number, y2Bot: number): string {
  const cx = (x1 + x2) / 2;
  return [
    `M ${x1} ${y1Top}`,
    `C ${cx} ${y1Top}, ${cx} ${y2Top}, ${x2} ${y2Top}`,
    `L ${x2} ${y2Bot}`,
    `C ${cx} ${y2Bot}, ${cx} ${y1Bot}, ${x1} ${y1Bot}`,
    'Z',
  ].join(' ');
}

/** バックエッジ: 上方を迂回する弧（水平フロー前提。左右どちら向きでも上を通す） */
export function ribbonBackEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const arcY = Math.min(y1, y2) - 40;
  return `M ${x1} ${y1} C ${x1} ${arcY}, ${x2} ${arcY}, ${x2} ${y2}`;
}

/** 自己ループ: バー右端の小さな弧 */
export function ribbonSelfLoopPath(x: number, y: number): string {
  const r = 20;
  return `M ${x - 6} ${y} C ${x - r} ${y - r * 2}, ${x + r} ${y - r * 2}, ${x + 6} ${y}`;
}

// ─── メインレイアウト関数 ──────────────────────────────────────────────

export function computeSubcontractRibbonLayout(graph: SubcontractGraph): SubcontractRibbonLayout {
  const depthMap = computeDepths(graph.flows); // blockId -> depth(>=1)。root は depth 0 相当（別管理）
  const mergedFlows = mergeParallelFlows(graph.flows);

  const blockById = new Map<string, BlockNode>();
  for (const b of graph.blocks) blockById.set(b.blockId, b);

  // 深さ別グループ化
  const byDepth = new Map<number, BlockNode[]>();
  for (const [blockId, depth] of depthMap) {
    const node = blockById.get(blockId);
    if (!node) continue;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  // depth1: 「direct/subcontract 群 → 別起点群」の順、各群内は金額降順（A案と同じ規則）
  const originRank = (k: BlockOriginKind): number =>
    k === 'separate-origin-strong' ? 2 : k === 'separate-origin-broad' ? 1 : 0;
  const depth1Nodes = [...(byDepth.get(1) ?? [])].sort((a, b) => {
    const r = originRank(a.originKind) - originRank(b.originKind);
    return r !== 0 ? r : b.totalAmount - a.totalAmount;
  });

  // 即時親（順方向エッジのみ: sourceDepth < targetDepth）
  const immediateParents = new Map<string, string[]>();
  for (const f of mergedFlows) {
    if (f.sourceBlock === null) continue;
    const sd = depthMap.get(f.sourceBlock) ?? -1;
    const td = depthMap.get(f.targetBlock) ?? -1;
    if (sd >= td) continue;
    if (!immediateParents.has(f.targetBlock)) immediateParents.set(f.targetBlock, []);
    immediateParents.get(f.targetBlock)!.push(f.sourceBlock);
  }

  // fan-in は最大金額の親に所属させ、子は親内で金額降順に並べる（A案と同じ規則）
  const maxDepthVal = depthMap.size > 0 ? Math.max(...depthMap.values()) : 1;
  const childrenOf = new Map<string, BlockNode[]>();
  const orphans: BlockNode[] = [];
  for (let depth = 2; depth <= maxDepthVal; depth++) {
    for (const node of byDepth.get(depth) ?? []) {
      const parents = immediateParents.get(node.blockId) ?? [];
      if (parents.length === 0) {
        orphans.push(node);
        continue;
      }
      let bestParentId = parents[0];
      let bestAmount = -Infinity;
      for (const pid of parents) {
        const amt = blockById.get(pid)?.totalAmount ?? -Infinity;
        if (amt > bestAmount) { bestAmount = amt; bestParentId = pid; }
      }
      if (!childrenOf.has(bestParentId)) childrenOf.set(bestParentId, []);
      childrenOf.get(bestParentId)!.push(node);
    }
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => b.totalAmount - a.totalAmount);

  // 列内の並び順: 親のバンド順を踏襲する DFS 事前順序（A案のバンド配置と同じ視覚的一貫性）
  const orderIndex = new Map<string, number>();
  let orderCursor = 0;
  const visit = (node: BlockNode) => {
    orderIndex.set(node.blockId, orderCursor++);
    for (const kid of childrenOf.get(node.blockId) ?? []) visit(kid);
  };
  for (const node of depth1Nodes) visit(node);
  for (const node of orphans) visit(node);

  // 全ノード中の最大金額（バー高さ・リボン太さの共通スケール基準）
  const maxAmount = Math.max(0, ...graph.blocks.map((b) => b.totalAmount));

  // 列ごとに y 座標を積み上げ配置
  const bars: RibbonBar[] = [];
  const barByBlockId = new Map<string, RibbonBar>();
  const colExtent = new Map<number, { minY: number; maxY: number }>();

  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...nodes].sort((a, b) => (orderIndex.get(a.blockId) ?? 0) - (orderIndex.get(b.blockId) ?? 0));
    let cursor = RIBBON_MARGIN.top;
    const colX = RIBBON_MARGIN.left + depth * (RIBBON_COL_W + RIBBON_COL_GAP);
    for (const node of sorted) {
      const h = ribbonAmountScale(node.totalAmount, maxAmount);
      const bar: RibbonBar = {
        blockId: node.blockId,
        blockName: node.blockName,
        totalAmount: node.totalAmount,
        originKind: node.originKind,
        isTerminal: node.isTerminal,
        isZeroAmount: node.totalAmount === 0 && node.recipientCount === 0,
        depth,
        x: colX,
        y: cursor,
        w: RIBBON_COL_W,
        h,
        node,
      };
      bars.push(bar);
      barByBlockId.set(node.blockId, bar);
      cursor += h + RIBBON_ROW_GAP;
    }
    if (sorted.length > 0) {
      colExtent.set(depth, { minY: RIBBON_MARGIN.top, maxY: cursor - RIBBON_ROW_GAP });
    }
  }

  // ルート（col0）: depth1 列の垂直方向の中心に配置。depth1 が無ければ上端固定
  const col1Extent = colExtent.get(1);
  const rootMidY = col1Extent ? (col1Extent.minY + col1Extent.maxY) / 2 : RIBBON_MARGIN.top + RIBBON_ROOT_H / 2;
  const root: RibbonRoot = {
    label: graph.projectName,
    x: RIBBON_MARGIN.left,
    y: Math.max(RIBBON_MARGIN.top, rootMidY - RIBBON_ROOT_H / 2),
    w: RIBBON_COL_W,
    h: RIBBON_ROOT_H,
  };

  // ─── フロー（順方向・バックエッジ）の分類 ──────────────────────────────────
  const getDepth = (blockId: string | null) => (blockId === null ? 0 : depthMap.get(blockId) ?? -1);
  const getBarTop = (blockId: string | null) => (blockId === null ? root.y : barByBlockId.get(blockId)?.y ?? 0);

  type Classified = { flow: typeof mergedFlows[number]; isSelfLoop: boolean; isBackEdge: boolean };
  const classified: Classified[] = mergedFlows
    .filter((f) => barByBlockId.has(f.targetBlock)) // 対象バーが存在しないフローは描画対象外
    .map((f) => {
      const isSelfLoop = f.sourceBlock === f.targetBlock;
      const sd = getDepth(f.sourceBlock);
      const td = getDepth(f.targetBlock);
      const isBackEdge = isSelfLoop || (f.sourceBlock !== null && sd > td);
      return { flow: f, isSelfLoop, isBackEdge };
    });

  const forwardFlows = classified.filter((c) => !c.isBackEdge).map((c) => c.flow);
  const backFlowsClassified = classified.filter((c) => c.isBackEdge);

  // ターゲットへの順方向流入本数（帯太さの等分割に使用）
  const incomingCountByTarget = new Map<string, number>();
  for (const f of forwardFlows) {
    incomingCountByTarget.set(f.targetBlock, (incomingCountByTarget.get(f.targetBlock) ?? 0) + 1);
  }

  // クロッシングを抑えるため、送出元の y → 送出先の y の順で安定ソートしてからカーソルを送る
  const sortedForward = [...forwardFlows].sort((a, b) => {
    const say = getBarTop(a.sourceBlock);
    const sby = getBarTop(b.sourceBlock);
    if (say !== sby) return say - sby;
    return getBarTop(a.targetBlock) - getBarTop(b.targetBlock);
  });

  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const flows: RibbonFlow[] = [];

  for (const f of sortedForward) {
    const targetBar = barByBlockId.get(f.targetBlock);
    if (!targetBar) continue;
    const sourceKey = f.sourceBlock ?? ROOT_KEY;
    const sourceRightX = f.sourceBlock === null ? root.x + root.w : (barByBlockId.get(f.sourceBlock)?.x ?? root.x) + RIBBON_COL_W;
    const sourceTopDefault = f.sourceBlock === null ? root.y : barByBlockId.get(f.sourceBlock)?.y ?? root.y;

    const incomingCount = Math.max(1, incomingCountByTarget.get(f.targetBlock) ?? 1);
    const thickness = Math.max(RIBBON_MIN_THICKNESS, ribbonAmountScale(targetBar.totalAmount, maxAmount) / incomingCount);

    const y1Top = outCursor.get(sourceKey) ?? sourceTopDefault;
    const y1Bot = y1Top + thickness;
    outCursor.set(sourceKey, y1Bot + RIBBON_RIBBON_GAP);

    const y2Top = inCursor.get(f.targetBlock) ?? targetBar.y;
    const y2Bot = y2Top + thickness;
    inCursor.set(f.targetBlock, y2Bot + RIBBON_RIBBON_GAP);

    flows.push({
      sourceBlock: f.sourceBlock,
      targetBlock: f.targetBlock,
      origin: f.origin,
      isReference: f.isReference,
      note: f.note,
      targetIncomingBlockCount: f.targetIncomingBlockCount,
      x1: sourceRightX,
      y1Top,
      y1Bot,
      x2: targetBar.x,
      y2Top,
      y2Bot,
    });
  }

  const backEdges: RibbonBackEdge[] = backFlowsClassified.map(({ flow: f, isSelfLoop }) => {
    const targetBar = barByBlockId.get(f.targetBlock)!;
    if (isSelfLoop) {
      const x = targetBar.x + RIBBON_COL_W;
      const y = targetBar.y + targetBar.h / 2;
      return {
        sourceBlock: f.sourceBlock,
        targetBlock: f.targetBlock,
        origin: f.origin,
        isReference: f.isReference,
        note: f.note,
        x1: x, y1: y, x2: x, y2: y,
        isSelfLoop: true,
      };
    }
    const sourceBar = f.sourceBlock ? barByBlockId.get(f.sourceBlock) : null;
    const x1 = sourceBar ? sourceBar.x : root.x;
    const y1 = sourceBar ? sourceBar.y + sourceBar.h / 2 : root.y + root.h / 2;
    return {
      sourceBlock: f.sourceBlock,
      targetBlock: f.targetBlock,
      origin: f.origin,
      isReference: f.isReference,
      note: f.note,
      x1,
      y1,
      x2: targetBar.x,
      y2: targetBar.y + targetBar.h / 2,
      isSelfLoop: false,
    };
  });

  // SVGサイズ
  const maxColDepth = byDepth.size > 0 ? Math.max(...byDepth.keys()) : 0;
  const maxRight = RIBBON_MARGIN.left + (maxColDepth + 1) * (RIBBON_COL_W + RIBBON_COL_GAP) - RIBBON_COL_GAP + RIBBON_MARGIN.right;
  const maxBottomBars = bars.length > 0 ? Math.max(...bars.map((b) => b.y + b.h)) : 0;
  const maxBottom = Math.max(maxBottomBars, root.y + root.h, RIBBON_MARGIN.top + 100) + RIBBON_MARGIN.bottom;

  return {
    root,
    bars,
    flows,
    backEdges,
    svgWidth: Math.max(maxRight, RIBBON_MARGIN.left + RIBBON_COL_W + RIBBON_MARGIN.right),
    svgHeight: maxBottom,
    maxAmount,
  };
}
