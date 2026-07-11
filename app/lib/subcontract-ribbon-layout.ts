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
 * 列 = 深度（col0 = ルート、col1 = 深度1、…）。列内は「縦サブツリー帯（バンド）」で
 * ノードを配置する。これは A案（subcontract-layout.ts）の横方向バンドアルゴリズム
 * （subtreeW/placeSubtree）を縦方向に移植したもの: 各ノードは自分の子孫全体が専有する
 * 縦バンドを持ち、親はバンドの中央に置かれる（単一子の連鎖は真横に一直線になる）。
 *
 * 別財源ブロック（separate-origin 起点）は直接系バンド群と混ざらないよう、下に独立した
 * レーンとして配置する（レーン境界に薄い区切り線・ラベルを描画するための extent を返す）。
 *
 * 既存A案の computeDepths / mergeParallelFlows をそのまま再利用し、深度・エッジのマージ規則を
 * 統一する（同じグラフに対して両ビューが矛盾しないことを保証するため）。
 */

// ─── 定数 ──────────────────────────────────────────────

// バー幅は sankey ノード風にスリム化（app/sankey-svg の NODE_W=18 に準拠する太さ感）。
// 列の内容幅（バー + ラベル領域）と列間ギャップは分けて持つ。列ピッチ = COL_W + COL_GAP
// （sankey の colSpacing = NODE_W + labelSpace 相当の考え方）。
export const RIBBON_BAR_W = 20;
export const RIBBON_LABEL_W = 190;
export const RIBBON_COL_W = RIBBON_BAR_W + RIBBON_LABEL_W;
export const RIBBON_COL_GAP = 40;
export const RIBBON_ROW_GAP = 14;
// 直接系バンド群と別財源レーンの間の追加ギャップ（通常の兄弟間ギャップより大きく取り、
// 視覚的に「別レーン」であることを示す）
export const RIBBON_LANE_GAP = 56;
export const RIBBON_RIBBON_GAP = 2;
export const RIBBON_BAR_MIN_H = 28;
export const RIBBON_BAR_MAX_H = 160;
export const RIBBON_ROOT_H = 120;
// ルートバーの高さ = 直接系流出リボン太さの合計 + このパディング
export const RIBBON_ROOT_PADDING = 24;
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

/** 別財源レーンの縦方向の範囲（区切り線・ラベル描画用）。別財源ブロックが無ければ null */
export interface RibbonSeparateLane {
  top: number;
  bottom: number;
}

export interface SubcontractRibbonLayout {
  root: RibbonRoot;
  bars: RibbonBar[];
  flows: RibbonFlow[];
  backEdges: RibbonBackEdge[];
  separateLane: RibbonSeparateLane | null;
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

  // 「直接系(direct/subcontract)」か「別財源系」かの判定。別財源レーンを直接系バンド群の
  // 下に独立配置するための分類に使う（A案の originRank と同じ規則を踏襲）
  const isSeparateOriginKind = (k: BlockOriginKind): boolean =>
    k === 'separate-origin-strong' || k === 'separate-origin-broad';
  const originRank = (k: BlockOriginKind): number => (isSeparateOriginKind(k) ? 1 : 0);

  // depth1: 「direct/subcontract 群 → 別起点群」の順、各群内は金額降順（A案と同じ規則）
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

  // fan-in は最大金額の親に所属させ、子は親内で金額降順に並べる（A案と同じ規則）。
  // 順方向の親が特定できないノード（バックエッジ経由の到達等）は orphan として
  // 自分の originKind に応じたグループの末尾に独立バンドで置く
  const maxDepthVal = depthMap.size > 0 ? Math.max(...depthMap.values()) : 1;
  const childrenOf = new Map<string, BlockNode[]>();
  const directOrphans: BlockNode[] = [];
  const separateOrphans: BlockNode[] = [];
  for (let depth = 2; depth <= maxDepthVal; depth++) {
    for (const node of byDepth.get(depth) ?? []) {
      const parents = immediateParents.get(node.blockId) ?? [];
      if (parents.length === 0) {
        (isSeparateOriginKind(node.originKind) ? separateOrphans : directOrphans).push(node);
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

  // ─── 縦サブツリー帯（バンド）配置 ──────────────────────────────────
  // A案のサブツリー帯配置（subtreeW/placeSubtree）を縦方向に移植したもの。
  // 各トップレベルノード（depth1 または orphan）は、自分の子孫全体が専有する縦バンドを持つ。
  // 親は自分のバンドの中央に置かれる（単一子の連鎖は真横に一直線になる）。
  const maxAmount = Math.max(0, ...graph.blocks.map((b) => b.totalAmount));
  const barH = (node: BlockNode): number => ribbonAmountScale(node.totalAmount, maxAmount);

  const subtreeH = new Map<string, number>();
  const calcSubtreeH = (node: BlockNode): number => {
    const kids = childrenOf.get(node.blockId) ?? [];
    const h = kids.length === 0
      ? barH(node)
      : Math.max(barH(node), kids.reduce((sum, k) => sum + calcSubtreeH(k), 0) + RIBBON_ROW_GAP * (kids.length - 1));
    subtreeH.set(node.blockId, h);
    return h;
  };

  const nodeY = new Map<string, number>();
  const placeSubtree = (node: BlockNode, bandTop: number): void => {
    const h = subtreeH.get(node.blockId) ?? barH(node);
    nodeY.set(node.blockId, bandTop + (h - barH(node)) / 2);
    let cursor = bandTop;
    for (const kid of childrenOf.get(node.blockId) ?? []) {
      placeSubtree(kid, cursor);
      cursor += (subtreeH.get(kid.blockId) ?? barH(kid)) + RIBBON_ROW_GAP;
    }
  };

  // 直接系グループ（direct/subcontract の depth1 + orphan）を上から詰める
  const directTopLevel = [...depth1Nodes.filter((n) => !isSeparateOriginKind(n.originKind)), ...directOrphans];
  let bandCursor = RIBBON_MARGIN.top;
  for (const node of directTopLevel) {
    calcSubtreeH(node);
    placeSubtree(node, bandCursor);
    bandCursor += subtreeH.get(node.blockId)! + RIBBON_ROW_GAP;
  }
  const directBandTop = RIBBON_MARGIN.top;
  const directBandBottom = directTopLevel.length > 0 ? bandCursor - RIBBON_ROW_GAP : RIBBON_MARGIN.top;

  // ルート（col0）: 直接系バンド範囲の縦中央に配置。
  // 高さ = 直接系 depth-1 への流出リボン太さの合計（≒各直接系トップレベルノードの
  // バー高さの合計）+ パディング（sankey的な保存感。fan-inで複数本に分岐するケースの
  // 太さ配分は下の flows 計算で個別に扱うため、ここでは近似値でよい）。
  // 別財源レーンの位置決めより前に計算する必要がある（ルートのパディングにより、
  // ルート下端が直接系バンドの実バー範囲より下にはみ出すケースがあり、レーンの
  // ギャップはそのはみ出しも考慮しないと区切り線・ラベルがルートカードと重なる）
  const hasDirectBand = directTopLevel.length > 0;
  const directMidY = hasDirectBand ? (directBandTop + directBandBottom) / 2 : RIBBON_MARGIN.top + RIBBON_ROOT_H / 2;
  const rootH = hasDirectBand
    ? Math.max(
        RIBBON_BAR_MIN_H,
        directTopLevel.reduce((sum, n) => sum + barH(n), 0) + RIBBON_ROW_GAP * Math.max(0, directTopLevel.length - 1) + RIBBON_ROOT_PADDING,
      )
    : RIBBON_ROOT_H;
  const root: RibbonRoot = {
    label: graph.projectName,
    x: RIBBON_MARGIN.left,
    // ルート幅は列内容幅（バー+ラベル領域）と揃える。depth1バーとの間隔が
    // 通常の列間ギャップ(RIBBON_COL_GAP)と一致し、余計な重なり・空白が出ない
    w: RIBBON_COL_W,
    y: Math.max(RIBBON_MARGIN.top, directMidY - rootH / 2),
    h: rootH,
  };

  // 別財源グループ（separate-origin の depth1 + orphan）を、直接系グループ（バー・ルート
  // カードの両方）の下に追加ギャップを空けて独立レーンとして配置する
  const separateTopLevel = [...depth1Nodes.filter((n) => isSeparateOriginKind(n.originKind)), ...separateOrphans];
  let separateLane: RibbonSeparateLane | null = null;
  if (separateTopLevel.length > 0) {
    const directContentBottom = Math.max(directBandBottom, hasDirectBand ? root.y + root.h : RIBBON_MARGIN.top);
    bandCursor = directContentBottom + RIBBON_LANE_GAP;
    const laneTop = bandCursor;
    for (const node of separateTopLevel) {
      calcSubtreeH(node);
      placeSubtree(node, bandCursor);
      bandCursor += subtreeH.get(node.blockId)! + RIBBON_ROW_GAP;
    }
    separateLane = { top: laneTop - RIBBON_LANE_GAP / 2, bottom: bandCursor - RIBBON_ROW_GAP };
  }

  // 全ノード中の最大金額（バー高さ・リボン太さの共通スケール基準）は上で算出済み（maxAmount）

  // 列ごとに x 座標のみ決定（y は band 配置で決まっている）
  const bars: RibbonBar[] = [];
  const barByBlockId = new Map<string, RibbonBar>();
  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const colX = RIBBON_MARGIN.left + depth * (RIBBON_COL_W + RIBBON_COL_GAP);
    for (const node of nodes) {
      const h = barH(node);
      const y = nodeY.get(node.blockId) ?? RIBBON_MARGIN.top;
      const bar: RibbonBar = {
        blockId: node.blockId,
        blockName: node.blockName,
        totalAmount: node.totalAmount,
        originKind: node.originKind,
        isTerminal: node.isTerminal,
        isZeroAmount: node.totalAmount === 0 && node.recipientCount === 0,
        depth,
        x: colX,
        y,
        w: RIBBON_BAR_W,
        h,
        node,
      };
      bars.push(bar);
      barByBlockId.set(node.blockId, bar);
    }
  }

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

  // クロッシングを抑えるため、送出元の y → 送出先の y の順で安定ソートしてからカーソルを送る。
  // fan-in（合流）は「ターゲットの入口カーソルに source の y 順で積む」ことで実現される
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
    const sourceRightX = f.sourceBlock === null ? root.x + root.w : (barByBlockId.get(f.sourceBlock)?.x ?? root.x) + RIBBON_BAR_W;
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
      const x = targetBar.x + RIBBON_BAR_W;
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
    separateLane,
    svgWidth: Math.max(maxRight, RIBBON_MARGIN.left + RIBBON_COL_W + RIBBON_MARGIN.right),
    svgHeight: maxBottom,
    maxAmount,
  };
}
