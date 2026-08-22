/**
 * MOF 予算全体ビューのサンキー配置計算。
 *
 * `/sankey-svg` と同じく自前 SVG で描くため、座標をここで決める。純粋関数で
 * React にも DOM にも依存しない（描画は `client/components/mof-budget/SankeyChart.tsx`）。
 *
 * 対象のグラフは「財源 → 会計 → 使途」の小さな DAG（ノード30本程度）なので、
 * 列は最長経路で決め、列内は生成順に積むだけで足りる。生成順は
 * `mof-sankey-generator.ts` が意図した並び（税目 → その他歳入 → 特会財源…）なので、
 * 値で並べ替えるとかえって読みにくくなる。
 */

import type { MOFBudgetNodeDetails } from '@/types/mof-budget-overview';
import type { SankeyNode, SankeyLink } from '@/types/sankey';

export interface MOFLayoutNode {
  id: string;
  name: string;
  value: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  details?: MOFBudgetNodeDetails;
}

export interface MOFLayoutLink {
  source: MOFLayoutNode;
  target: MOFLayoutNode;
  value: number;
  /** 送り手側の帯の上端 */
  y0: number;
  /** 受け手側の帯の上端 */
  y1: number;
  width: number;
}

export interface MOFSankeyLayout {
  nodes: MOFLayoutNode[];
  links: MOFLayoutLink[];
  width: number;
  height: number;
  columnCount: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  nodeWidth: number;
  /** ノード間の最小の空き（px） */
  nodePadding: number;
}

type InputNode = SankeyNode & { name?: string; details?: MOFBudgetNodeDetails };

/**
 * 列を決める。入力の無いノードを 0 とし、辺をたどって最長経路で後ろへ送る。
 * 一般会計 → 特別会計 のように会計どうしを結ぶ辺があるため、
 * 単純な「種別ごとに固定の列」では表せない。
 */
function assignColumns(
  nodes: InputNode[],
  links: SankeyLink[]
): Map<string, number> {
  const column = new Map<string, number>(nodes.map(n => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    const list = outgoing.get(link.source) ?? [];
    list.push(link.target);
    outgoing.set(link.source, list);
  }
  // ノード数が少ないので、変化が無くなるまで回す素朴な緩和で足りる
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const link of links) {
      const next = (column.get(link.source) ?? 0) + 1;
      if (next > (column.get(link.target) ?? 0)) {
        column.set(link.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 出口の無いノードは最終列に寄せる（実支出などが中途半端な列に残らないように）
  const maxColumn = Math.max(...column.values());
  for (const node of nodes) {
    if (!outgoing.has(node.id)) column.set(node.id, maxColumn);
  }

  // 会計ノードは、他の会計へ繰り入れるものを除いて同じ列に揃える。
  // 最長経路のままだと 一般会計＝1列目・特別会計＝2列目・政府関係機関＝1列目 となり、
  // 関係の無い政府関係機関が一般会計の隣に並んでラベルが競合する。
  const accounts = nodes.filter(n => n.details?.nodeType === 'account');
  const feedsAccount = new Set(
    links
      .filter(l => {
        const target = nodes.find(n => n.id === l.target);
        return target?.details?.nodeType === 'account';
      })
      .map(l => l.source)
  );
  const accountColumn = Math.max(
    ...accounts.filter(a => !feedsAccount.has(a.id)).map(a => column.get(a.id) ?? 0)
  );
  for (const account of accounts) {
    if (!feedsAccount.has(account.id)) column.set(account.id, accountColumn);
  }

  return column;
}

/** サンキーの座標を計算する */
export function computeMOFSankeyLayout(
  input: { nodes: InputNode[]; links: SankeyLink[] },
  options: LayoutOptions
): MOFSankeyLayout {
  const { width, height, margin, nodeWidth, nodePadding } = options;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const column = assignColumns(input.nodes, input.links);
  const columnCount = Math.max(...column.values()) + 1;

  // 値 → 高さの倍率。いちばん詰まっている列に合わせる
  const byColumn = new Map<number, InputNode[]>();
  for (const node of input.nodes) {
    const col = column.get(node.id) ?? 0;
    const list = byColumn.get(col) ?? [];
    list.push(node);
    byColumn.set(col, list);
  }
  let scale = Infinity;
  for (const [, list] of byColumn) {
    const total = list.reduce((s, n) => s + (n.value ?? 0), 0);
    const available = innerH - nodePadding * Math.max(list.length - 1, 0);
    if (total > 0 && available > 0) scale = Math.min(scale, available / total);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const gap = columnCount > 1 ? (innerW - nodeWidth) / (columnCount - 1) : 0;

  const nodes: MOFLayoutNode[] = [];
  const byId = new Map<string, MOFLayoutNode>();
  for (const [col, list] of [...byColumn].sort((a, b) => a[0] - b[0])) {
    // 列の中身を上下中央に寄せる。列ごとに合計が違うので、揃えないと図が傾いて見える
    const used =
      list.reduce((s, n) => s + (n.value ?? 0) * scale, 0) +
      nodePadding * Math.max(list.length - 1, 0);
    let y = margin.top + Math.max((innerH - used) / 2, 0);
    for (const node of list) {
      const h = Math.max((node.value ?? 0) * scale, 1);
      const placed: MOFLayoutNode = {
        id: node.id,
        name: node.name ?? node.id,
        value: node.value ?? 0,
        column: col,
        x: margin.left + col * gap,
        y,
        width: nodeWidth,
        height: h,
        details: node.details,
      };
      nodes.push(placed);
      byId.set(placed.id, placed);
      y += h + nodePadding;
    }
  }

  // 帯の位置。ノードの上端から順に積む
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const links: MOFLayoutLink[] = [];
  for (const link of input.links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;
    const w = Math.max(link.value * scale, 1);
    const y0 = source.y + (outOffset.get(source.id) ?? 0);
    const y1 = target.y + (inOffset.get(target.id) ?? 0);
    outOffset.set(source.id, (outOffset.get(source.id) ?? 0) + w);
    inOffset.set(target.id, (inOffset.get(target.id) ?? 0) + w);
    links.push({ source, target, value: link.value, y0, y1, width: w });
  }

  return { nodes, links, width, height, columnCount };
}

/** 帯のパス。両端をノードの縁に付け、中間で滑らかに繋ぐ */
export function mofRibbonPath(link: MOFLayoutLink): string {
  const sx = link.source.x + link.source.width;
  const tx = link.target.x;
  const sTop = link.y0;
  const sBot = sTop + link.width;
  const tTop = link.y1;
  const tBot = tTop + link.width;
  const mx = (sx + tx) / 2;
  return (
    `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}` +
    `L${tx},${tBot}` +
    `C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`
  );
}
