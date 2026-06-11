/**
 * 企業中心Sankeyのデータ生成（Pure関数）。
 *
 * 視点を事業中心から支出先（企業）中心に反転させたサンキー:
 *   [府省庁] → [事業] → [対象企業] → [再委託先ブロック]
 *
 * 事業→企業リンクは originKind を保持し、直接受注と再委託受注を
 * 色分け表示できるようにする（金額の合算は二重計上のため行わない）。
 */
import type { RecipientEntry } from '@/types/recipient-index';

export interface RecipientSankeyNode {
  id: string;
  label: string;
  column: 0 | 1 | 2 | 3; // 0=府省庁, 1=事業, 2=対象企業, 3=再委託先
  value: number;
  /** 集約ノード（その他の発注元）か */
  isAggregate?: boolean;
  /** 事業ノードの遷移先（/subcontracts/[pid]） */
  pid?: number;
  /** 再委託先ノードの遷移先キー（/recipients/[key]） */
  recipientKey?: string;
}

export interface RecipientSankeyLink {
  source: string;
  target: string;
  value: number;
  /** 事業→企業リンクのみ: direct=直接受注, subcontract=再委託・別起点 */
  kind?: 'direct' | 'subcontract';
}

export interface RecipientSankeyData {
  nodes: RecipientSankeyNode[];
  links: RecipientSankeyLink[];
  /** 表示対象外となった事業数（その他の発注元に集約） */
  aggregatedProjectCount: number;
}

export interface RecipientSankeyOptions {
  /** 表示する事業数の上限（金額降順）。既定10 */
  topProjects?: number;
  /** 表示する再委託先ブロック数の上限。既定10 */
  topDownstream?: number;
}

export function buildRecipientSankey(
  entry: RecipientEntry,
  opts: RecipientSankeyOptions = {},
): RecipientSankeyData {
  const topProjects = opts.topProjects ?? 10;
  const topDownstream = opts.topDownstream ?? 10;

  const centerId = 'center';
  const nodes = new Map<string, RecipientSankeyNode>();
  const links: RecipientSankeyLink[] = [];

  nodes.set(centerId, { id: centerId, label: entry.name, column: 2, value: 0 });

  // 事業単位に集約（Multi-block: 同一事業の複数出現は合算。originKind は金額の大きい方を代表とせず、
  // direct/subcontract 別々にリンクを張って情報を保つ）
  const byProject = new Map<number, {
    projectName: string;
    ministry: string;
    direct: number;
    subcontract: number;
  }>();
  for (const a of entry.appearances) {
    let p = byProject.get(a.pid);
    if (!p) {
      p = { projectName: a.projectName, ministry: a.ministry, direct: 0, subcontract: 0 };
      byProject.set(a.pid, p);
    }
    if (a.originKind === 'direct') p.direct += a.amount;
    else p.subcontract += a.amount;
  }

  const ranked = [...byProject.entries()]
    .sort((a, b) => (b[1].direct + b[1].subcontract) - (a[1].direct + a[1].subcontract));
  const visible = ranked.slice(0, topProjects).filter(([, p]) => p.direct + p.subcontract > 0);
  const aggregated = ranked.slice(topProjects);

  for (const [pid, p] of visible) {
    const projectId = `p-${pid}`;
    const ministryId = `m-${p.ministry}`;
    const total = p.direct + p.subcontract;

    if (!nodes.has(ministryId)) {
      nodes.set(ministryId, { id: ministryId, label: p.ministry, column: 0, value: 0 });
    }
    nodes.set(projectId, { id: projectId, label: p.projectName, column: 1, value: total, pid });
    nodes.get(ministryId)!.value += total;

    links.push({ source: ministryId, target: projectId, value: total });
    if (p.direct > 0) links.push({ source: projectId, target: centerId, value: p.direct, kind: 'direct' });
    if (p.subcontract > 0) links.push({ source: projectId, target: centerId, value: p.subcontract, kind: 'subcontract' });
  }

  // 集約ノード（名称は「その他の支出先」(TopN集計)・支出先名「その他」と紛れない表記にする）
  if (aggregated.length > 0) {
    const aggTotal = aggregated.reduce((s, [, p]) => s + p.direct + p.subcontract, 0);
    if (aggTotal > 0) {
      const aggId = '__agg-projects';
      nodes.set(aggId, {
        id: aggId,
        label: `その他の発注元（${aggregated.length}事業）`,
        column: 1,
        value: aggTotal,
        isAggregate: true,
      });
      const aggDirect = aggregated.reduce((s, [, p]) => s + p.direct, 0);
      const aggSub = aggTotal - aggDirect;
      if (aggDirect > 0) links.push({ source: aggId, target: centerId, value: aggDirect, kind: 'direct' });
      if (aggSub > 0) links.push({ source: aggId, target: centerId, value: aggSub, kind: 'subcontract' });
    }
  }

  // 右側: 対象企業のブロックからの再委託先（appearances の downstream をブロック名で集約）
  const downstreamAgg = new Map<string, { amount: number; recipientKey?: string }>();
  for (const a of entry.appearances) {
    for (const d of a.downstream) {
      const cur = downstreamAgg.get(d.blockName) ?? {
        amount: 0,
        recipientKey: d.recipientKeys.length === 1 ? d.recipientKeys[0] : undefined,
      };
      cur.amount += d.amount;
      downstreamAgg.set(d.blockName, cur);
    }
  }
  const downstreamRanked = [...downstreamAgg.entries()]
    .filter(([, v]) => v.amount > 0)
    .sort((a, b) => b[1].amount - a[1].amount);
  const visibleDown = downstreamRanked.slice(0, topDownstream);
  const aggDown = downstreamRanked.slice(topDownstream);

  visibleDown.forEach(([blockName, v], i) => {
    const id = `d-${i}`;
    nodes.set(id, { id, label: blockName, column: 3, value: v.amount, recipientKey: v.recipientKey });
    // 中央→下流は対象企業からの再委託フロー
    links.push({ source: centerId, target: id, value: v.amount, kind: 'subcontract' });
  });
  if (aggDown.length > 0) {
    const aggDownTotal = aggDown.reduce((s, [, v]) => s + v.amount, 0);
    const id = '__agg-downstream';
    nodes.set(id, {
      id,
      label: `その他の再委託先（${aggDown.length}ブロック）`,
      column: 3,
      value: aggDownTotal,
      isAggregate: true,
    });
    links.push({ source: centerId, target: id, value: aggDownTotal, kind: 'subcontract' });
  }

  // 中央ノードの高さは入金側（受注額）合計。出金（再委託）は別資金次元のため
  // 高さに足さない（受注した資金の中から再委託される）
  const center = nodes.get(centerId)!;
  center.value = links
    .filter(l => l.target === centerId)
    .reduce((s, l) => s + l.value, 0);

  return {
    nodes: [...nodes.values()],
    links,
    aggregatedProjectCount: aggregated.length,
  };
}
