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
// /sankey-svg の computeLayout に合わせ、最低高さは「読みやすさのための下駄」ではなく
// 描画上のハード床（1px）とする。金額差はすべて線形スケールの高さ差として表現する。
export const RIBBON_BAR_MIN_H = 1;
export const RIBBON_MARGIN = { top: 28, right: 36, bottom: 40, left: 36 };
// 列（深度）ごとの合計金額のうち最大のものを、この高さ（px, ギャップ除く）に収める形で
// 線形スケール係数 k を決定する（/sankey-svg の ky 決定＝「最も厳しい列が innerH に収まる
// ky」という考え方を、固定描画キャンバスに単純化して移植したもの）。
export const RIBBON_TARGET_COL_H = 640;

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

/** 順方向フロー（col間を繋ぐ帯）。両端の太さは接続先バーの高さから配分され、異なる値を取り得る（テーパー付き） */
export interface RibbonFlow {
  sourceBlock: string | null;
  targetBlock: string;
  origin: FlowOrigin;
  isReference: boolean;
  note?: string;
  targetIncomingBlockCount: number;
  /** 推定流量（円）。target の totalAmount を親間分配した値 — targetThickness と同じ根拠（share）から
   *  ピクセルスケール(k)を介さずに直接算出するため、床(RIBBON_BAR_MIN_H)による丸め誤差を含まない */
  amount: number;
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
  /** Σ子への流出額推定が親バー高さを超えたため比例圧縮したブロック数（データ不整合の検知用。通常0） */
  sourceOverflowCount: number;
}

// ─── スケール関数 ──────────────────────────────────────────────

/**
 * 金額 → バー高さ / リボン太さ（線形スケール）。/sankey-svg の
 * `Math.max(1, node.value * ky)` と同じ考え方: 金額差はすべて高さの線形比に反映し、
 * 最低高さは「読みやすさの下駄」ではなくハード床（1px）に留める。
 */
export function ribbonAmountScale(amount: number, k: number): number {
  return Math.max(RIBBON_BAR_MIN_H, Math.max(0, amount) * k);
}

/**
 * 線形スケール係数 k の決定。「列（深度）ごとの合計金額が最大の列」が
 * RIBBON_TARGET_COL_H に収まるように k を選ぶ（/sankey-svg の ky 決定の簡略移植）。
 * 全ブロックが 0 円（制度フローのみ等）の場合は k=1 にフォールバックする
 * （その場合は全バーが RIBBON_BAR_MIN_H の床に張り付く）。
 */
export function computeRibbonK(byDepth: Map<number, BlockNode[]>): number {
  let maxColTotal = 0;
  for (const nodes of byDepth.values()) {
    const total = nodes.reduce((s, n) => s + Math.max(0, n.totalAmount), 0);
    if (total > maxColTotal) maxColTotal = total;
  }
  if (maxColTotal <= 0) return 1;
  return RIBBON_TARGET_COL_H / maxColTotal;
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

// ─── ラベル文字幅の概算・切り詰め ──────────────────────────────────────────────
// SVG <text> は実測なしに文字幅がわからないため、全角/半角の概算係数で近似する。
// 太字（選択・ホバー時）でも崩れないよう、両係数にわずかな安全マージンを乗せてある。
const LABEL_FULLWIDTH_COEF = 1.05;
const LABEL_HALFWIDTH_COEF = 0.58;

/** 文字幅の概算合計（px）。全角=fontSize×約1.0 / 半角=fontSize×約0.55 相当（太字向けに少し余裕を持たせた係数） */
export function estimateLabelWidth(text: string, fontSizePx: number): number {
  let width = 0;
  for (const ch of text) {
    const isFullWidth = ch.charCodeAt(0) > 0xff;
    width += fontSizePx * (isFullWidth ? LABEL_FULLWIDTH_COEF : LABEL_HALFWIDTH_COEF);
  }
  return width;
}

/**
 * 「名前 (金額)」形式のラベルで、金額部分（amountText、例: " (1,234億円)"）を必ず収めた上で
 * 名前部分だけを切り詰める。名前が収まらない場合は末尾を "…" にして詰める。
 * 金額側は呼び出し側でそのまま描画すること（この関数は名前部分のみ返す）。
 */
export function truncateRibbonLabelName(
  name: string,
  amountText: string,
  maxWidth: number,
  fontSizePx: number,
): string {
  const amountWidth = estimateLabelWidth(amountText, fontSizePx);
  const nameBudget = Math.max(0, maxWidth - amountWidth);
  if (estimateLabelWidth(name, fontSizePx) <= nameBudget) return name;
  const ellipsisWidth = estimateLabelWidth('…', fontSizePx);
  let acc = '';
  let w = 0;
  for (const ch of name) {
    const chWidth = estimateLabelWidth(ch, fontSizePx);
    if (w + chWidth + ellipsisWidth > nameBudget) break;
    acc += ch;
    w += chWidth;
  }
  return `${acc}…`;
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
  const k = computeRibbonK(byDepth);
  const barH = (node: BlockNode): number => ribbonAmountScale(node.totalAmount, k);

  // ─── フロー分類（順方向 / バックエッジ）とテーパー太さ配分 ──────────────────────
  // バー高さ（平方根スケール）とリボン太さを両端で厳密一致させるため、エッジ太さは
  // 「出口側は source バーの高さを子の totalAmount 比で配分」「入口側は target バーの
  // 高さを流入元の totalAmount 比で配分」の2パスで計算する（/sankey-svg の
  // computeLayout の sy/ty カーソル配分と同じ考え方: proportion = value/total,
  // nodeHeight * proportion をカーソルに積み上げる。ギャップは入れない）。
  // ルート（source===null）は自身の高さが未確定のため、出口側は入口側の配分値を
  // そのまま引き継ぐ（= ルートバー高さは「配分後の出口リボン太さ合計」として事後的に決まる）。
  const getDepth = (blockId: string | null) => (blockId === null ? 0 : depthMap.get(blockId) ?? -1);

  type FlowRef = (typeof mergedFlows)[number];
  type Classified = { flow: FlowRef; isSelfLoop: boolean; isBackEdge: boolean };
  const classified: Classified[] = mergedFlows
    // バーが必ず存在する対象のみ（bars は byDepth=depthMap∩blockById から構築される）。
    // source 側も同条件で守る: バー未生成の source を持つフローを通すと sd=-1 で順方向扱いになり、
    // ルート起点のリボンとして誤描画される（target 唯一の流入なら全高を占める）ため除外する
    .filter((f) =>
      depthMap.has(f.targetBlock) && blockById.has(f.targetBlock)
      && (f.sourceBlock === null || (depthMap.has(f.sourceBlock) && blockById.has(f.sourceBlock))))
    .map((f) => {
      const isSelfLoop = f.sourceBlock === f.targetBlock;
      const sd = getDepth(f.sourceBlock);
      const td = getDepth(f.targetBlock);
      const isBackEdge = isSelfLoop || (f.sourceBlock !== null && sd > td);
      return { flow: f, isSelfLoop, isBackEdge };
    });

  const forwardFlows = classified.filter((c) => !c.isBackEdge).map((c) => c.flow);
  const backFlowsClassified = classified.filter((c) => c.isBackEdge);

  const targetThickness = new Map<FlowRef, number>();
  const sourceThickness = new Map<FlowRef, number>();
  // 推定流量（円）。ピクセル太さ(targetThickness)と同じ share から直接算出（k を介さないため
  // RIBBON_BAR_MIN_H の床による丸め誤差を含まない、ツールチップ表示用の実額推定）
  const flowAmountEstimate = new Map<FlowRef, number>();

  // 入口側: target バーの高さを、流入元（source）の totalAmount 比で配分。
  // ルートが唯一の流入元の場合は target 自身の totalAmount を重みとして使う（配分比 1）
  const byTarget = new Map<string, FlowRef[]>();
  for (const f of forwardFlows) {
    if (!byTarget.has(f.targetBlock)) byTarget.set(f.targetBlock, []);
    byTarget.get(f.targetBlock)!.push(f);
  }
  for (const [targetId, fs] of byTarget) {
    const targetNode = blockById.get(targetId);
    if (!targetNode) continue;
    const targetH = barH(targetNode);
    const weights = fs.map((f) => (f.sourceBlock ? blockById.get(f.sourceBlock)?.totalAmount ?? 0 : targetNode.totalAmount));
    const totalWeight = weights.reduce((s, w) => s + Math.max(0, w), 0);
    fs.forEach((f, i) => {
      const w = Math.max(0, weights[i]);
      const share = totalWeight > 0 ? w / totalWeight : 1 / fs.length;
      targetThickness.set(f, targetH * share);
      flowAmountEstimate.set(f, targetNode.totalAmount * share);
    });
  }

  // 出口側: リボン太さは「流れる金額」の推定値（= 入口側で計算済みの targetThickness、
  // 線形スケール下では両端で同じ値になる）をそのまま使う。source バーの高さいっぱいに
  // 正規化して埋め尽くすことはしない — 直接委託の金額と再委託金額は一致するとは限らない
  // ため、Σ子への流出額 < 親バー高さのときは親バーの上部からのみリボンが出て、
  // 下部は空白（= 再委託していない直接執行分）として残るのが正しい表現。
  // 例外: Σ子への流出額推定 > 親バー高さ（データ不整合）の場合のみ、はみ出しではなく
  // 比例圧縮でフォールバックする（sourceOverflowCount で件数を計上）。
  const bySource = new Map<string, FlowRef[]>();
  for (const f of forwardFlows) {
    const key = f.sourceBlock ?? ROOT_KEY;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(f);
  }
  let sourceOverflowCount = 0;
  for (const [sourceKey, fs] of bySource) {
    if (sourceKey === ROOT_KEY) {
      for (const f of fs) sourceThickness.set(f, targetThickness.get(f) ?? 0);
      continue;
    }
    const sourceNode = blockById.get(sourceKey);
    if (!sourceNode) continue;
    const sourceH = barH(sourceNode);
    const rawThicknesses = fs.map((f) => Math.max(0, targetThickness.get(f) ?? 0));
    const sumRaw = rawThicknesses.reduce((s, v) => s + v, 0);
    if (sumRaw > sourceH && sumRaw > 0) {
      sourceOverflowCount++;
      const scale = sourceH / sumRaw;
      fs.forEach((f, i) => sourceThickness.set(f, rawThicknesses[i] * scale));
    } else {
      fs.forEach((f, i) => sourceThickness.set(f, rawThicknesses[i]));
    }
  }

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

  // ルート（col0）: 他ノードと同じスリムバー。高さ = 出口リボン太さの合計（テーパー配分の
  // パススルー値。上のフロー分類パスで計算済み）。直接系バンド範囲の縦中央に配置する。
  // 最小高さのみ RIBBON_BAR_MIN_H を確保する（通常は流出フローが必ず1本以上あるため未使用）
  const hasDirectBand = directTopLevel.length > 0;
  const directMidY = hasDirectBand ? (directBandTop + directBandBottom) / 2 : RIBBON_MARGIN.top + RIBBON_BAR_MIN_H / 2;
  const rootOutgoing = bySource.get(ROOT_KEY) ?? [];
  const rootH = Math.max(
    RIBBON_BAR_MIN_H,
    rootOutgoing.reduce((sum, f) => sum + (sourceThickness.get(f) ?? 0), 0),
  );
  const root: RibbonRoot = {
    label: graph.projectName,
    x: RIBBON_MARGIN.left,
    // バー幅は他ノードと同じスリム幅（sankeyノード風）。列内容幅(RIBBON_COL_W)は
    // ラベル領域込みでdepth1列との間隔に使われるため、xの起点は変えない
    w: RIBBON_BAR_W,
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

  // 線形スケール係数 k（バー高さ・リボン太さの共通スケール基準）は上で算出済み

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

  // ─── フロー（順方向・バックエッジ）の描画用データ組み立て ──────────────────────
  // 太さ配分（targetThickness/sourceThickness）は上のフロー分類パスで計算済み。
  // ここでは「各バーの入口・出口カーソルに、両端の配分値でテーパー付き帯を積む」だけを行う。
  const getBarTop = (blockId: string | null) => (blockId === null ? root.y : barByBlockId.get(blockId)?.y ?? 0);

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

    // テーパー: 出口側(y1)と入口側(y2)で別々の太さを使う。両端ともバー高さぴったりに
    // 積み上がるよう配分済み（ギャップなしでカーソルを積む。sankeyのリンク積み方と同じ）
    const srcThick = Math.max(0, sourceThickness.get(f) ?? 0);
    const tgtThick = Math.max(0, targetThickness.get(f) ?? 0);

    const y1Top = outCursor.get(sourceKey) ?? sourceTopDefault;
    const y1Bot = y1Top + srcThick;
    outCursor.set(sourceKey, y1Bot);

    const y2Top = inCursor.get(f.targetBlock) ?? targetBar.y;
    const y2Bot = y2Top + tgtThick;
    inCursor.set(f.targetBlock, y2Bot);

    flows.push({
      sourceBlock: f.sourceBlock,
      targetBlock: f.targetBlock,
      origin: f.origin,
      isReference: f.isReference,
      note: f.note,
      targetIncomingBlockCount: f.targetIncomingBlockCount,
      amount: flowAmountEstimate.get(f) ?? 0,
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
    sourceOverflowCount,
  };
}
