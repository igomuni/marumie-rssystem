/**
 * MOF 事項別内訳の階層サンキーを組み立てる。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 の6列。
 * 事項別内訳（`MOFJikouItem`）から直接組むので専用の生成物は要らない。
 * 純粋関数で、HTTP もファイル読み込みもしない（読み込みは API 層の責務）。
 *
 * 設計の根拠は docs/tasks/20260822_2133_MOF事項別内訳の階層サンキー実装案.md。
 */

import type { MOFAccountType, MOFBudgetType, MOFJikouItem } from '@/types/mof-jikou';
import type {
  MOFHierarchyAccountSummary,
  MOFHierarchyColumn,
  MOFHierarchyData,
  MOFHierarchyNode,
  MOFHierarchyNodeDetails,
  MOFHierarchyTopN,
} from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';

/** 根ノードのID */
const ROOT_ID = 'total';

/** 会計区分の表示名 */
const ACCOUNT_LABELS: Record<MOFAccountType, string> = {
  general: '一般会計',
  special: '特別会計',
  agency: '政府関係機関',
};

/**
 * 列ごとの TopN の既定値。
 *
 * 所管25・組織114・勘定32 に対して項1,104・事項1,712 と後ろ2列だけ桁が違うので、
 * 集約するのはその2列だけでよい（令和8年度・当初予算での実測）。
 */
export const DEFAULT_TOP_N: MOFHierarchyTopN = {
  section: 12,
  item: 12,
};

/**
 * 列ごとのノード数の上限。
 *
 * 親ごとの TopN だけでは列の総数を抑えられない。組織114 × 項の TopN のように
 * 掛け算で増えるため、実測で項730・事項1,184になり1ノードが1px未満になる。
 * 上限を超えた分は、それぞれの親の「その他」に畳んで列の本数を抑える。
 */
export const DEFAULT_MAX_PER_COLUMN = 40;

/** 集約ノードの名前 */
const OTHERS_NAME = 'その他';

/**
 * 事項1件が通る階層のラベル。
 *
 * 会計区分でフィールドが入れ替わる（一般会計は組織、特会は特会名＋勘定、
 * 政府関係機関は機関名＋業務）。空文字はその列を持たないことを表し、
 * 呼び出し側で列を素通りさせる。
 */
function levelsOf(item: MOFJikouItem): Record<Exclude<MOFHierarchyColumn, 'total'>, string> {
  return {
    // 政府関係機関は所管が空なので会計区分名を置く
    ministry: item.ministry || ACCOUNT_LABELS[item.accountType],
    organization: item.organization || item.specialAccount || item.agency,
    subAccount: item.subAccount,
    // 項コードは組織内の連番で単独では一意にならないため、表示は項名にコードを添える
    section: item.sectionName ? `${item.sectionCode} ${item.sectionName}` : '',
    item: item.name,
  };
}

/** 組み立て中のノード。座標は持たない（配置は layout の責務） */
interface Building {
  id: string;
  name: string;
  column: MOFHierarchyColumn;
  amount: number;
  details: MOFHierarchyNodeDetails;
  /** 親ノードのID。根は null */
  parentId: string | null;
}

/** 親ごとに子を TopN に絞り、溢れた分を「その他」にまとめる */
function applyTopN(
  children: Building[],
  limit: number | undefined,
  parentId: string,
  column: MOFHierarchyColumn,
  accountType: MOFAccountType | undefined
): { kept: Building[]; aggregated: Building | null; droppedIds: Set<string> } {
  const sorted = [...children].sort((a, b) => b.amount - a.amount);
  if (!limit || sorted.length <= limit) {
    return { kept: sorted, aggregated: null, droppedIds: new Set() };
  }
  const kept = sorted.slice(0, limit);
  const dropped = sorted.slice(limit);
  const aggregated: Building = {
    id: `${parentId}>__others__`,
    name: OTHERS_NAME,
    column,
    amount: dropped.reduce((s, n) => s + n.amount, 0),
    details: {
      column,
      aggregated: true,
      aggregatedCount: dropped.length,
      accountType,
    },
    parentId,
  };
  return {
    kept,
    aggregated,
    droppedIds: new Set(dropped.map(n => n.id)),
  };
}

/**
 * 事項別内訳から階層サンキーを組む。
 *
 * @param items その年度・予算種別の事項（絞り込みは呼び出し側で行わない）
 */
export function buildMOFHierarchySankey(
  items: MOFJikouItem[],
  options: {
    fiscalYear: number;
    eraLabel: string;
    budgetType: MOFBudgetType;
    budgetTypes: MOFBudgetType[];
    availableYears: number[];
    topN?: MOFHierarchyTopN;
    /** 列ごとのノード数の上限 */
    maxPerColumn?: number;
  }
): MOFHierarchyData {
  const topN = { ...DEFAULT_TOP_N, ...options.topN };
  const target = items.filter(i => i.budgetType === options.budgetType);

  // --- 階層を辿ってノードを作る ---
  // ノードIDは根からのパス。事項名は項をまたいで重複するため、名前だけでは合流してしまう
  const nodes = new Map<string, Building>();
  const childrenOf = new Map<string, Set<string>>();

  const total = target.reduce((s, i) => s + i.amount, 0);
  nodes.set(ROOT_ID, {
    id: ROOT_ID,
    name: '予算合計',
    column: 'total',
    amount: total,
    details: { column: 'total' },
    parentId: null,
  });

  const columns: Array<Exclude<MOFHierarchyColumn, 'total'>> = [
    'ministry',
    'organization',
    'subAccount',
    'section',
    'item',
  ];

  for (const item of target) {
    const levels = levelsOf(item);
    let parentId = ROOT_ID;
    let path = ROOT_ID;
    for (const column of columns) {
      const label = levels[column];
      // 値の無い列は素通りさせる（勘定を持たない特別会計・一般会計など）。
      // ただし何も置かないと帯がその列の実ノードを横切って重なるので、
      // 場所だけ確保する透明な通過ノードを挟む
      if (!label) {
        const passId = `${path}>__pass__${column}`;
        const pass = nodes.get(passId);
        if (pass) {
          pass.amount += item.amount;
        } else {
          nodes.set(passId, {
            id: passId,
            name: '',
            column,
            amount: item.amount,
            details: { column, passThrough: true, accountType: item.accountType },
            parentId,
          });
        }
        const passSiblings = childrenOf.get(parentId) ?? new Set<string>();
        passSiblings.add(passId);
        childrenOf.set(parentId, passSiblings);
        parentId = passId;
        path = passId;
        continue;
      }
      path = `${path}>${label}`;
      const existing = nodes.get(path);
      if (existing) {
        existing.amount += item.amount;
      } else {
        nodes.set(path, {
          id: path,
          name: label,
          column,
          amount: item.amount,
          details: {
            column,
            accountType: item.accountType,
            ...(column === 'section' ? { sectionCode: item.sectionCode } : {}),
            ...(column === 'item'
              ? {
                  description: item.description,
                  majorExpenseName: item.majorExpenseName,
                }
              : {}),
          },
          parentId,
        });
      }
      const siblings = childrenOf.get(parentId) ?? new Set<string>();
      siblings.add(path);
      childrenOf.set(parentId, siblings);
      parentId = path;
    }
  }

  // --- TopN と列上限で残すノードを決める ---
  //
  // 親ごとの TopN だけでは列の総数を抑えられない（組織114 × 項12 のように掛け算で増える）。
  // 実測で項730・事項1,184になり1ノードが1px未満になった。列単位の上限も併せて掛ける。
  const maxPerColumn = options.maxPerColumn ?? DEFAULT_MAX_PER_COLUMN;
  const kept = new Set<string>([ROOT_ID]);
  const queue: string[] = [ROOT_ID];
  while (queue.length > 0) {
    const parentId = queue.shift() as string;
    const children = [...(childrenOf.get(parentId) ?? [])]
      .map(id => nodes.get(id))
      .filter((n): n is Building => Boolean(n))
      .sort((a, b) => b.amount - a.amount);
    if (children.length === 0) continue;
    // 通過ノードは枝の骨格なので TopN の対象にしない
    const structural = children.filter(c => c.details.passThrough);
    const rankable = children.filter(c => !c.details.passThrough);
    const limit = topN[rankable[0]?.column ?? children[0].column];
    for (const child of [
      ...structural,
      ...(limit ? rankable.slice(0, limit) : rankable),
    ]) {
      kept.add(child.id);
      queue.push(child.id);
    }
  }
  // 列単位の上限。残った中から金額の大きい順に切る
  for (const column of columns) {
    const inColumn = [...nodes.values()]
      .filter(n => n.column === column && kept.has(n.id) && !n.details.passThrough)
      .sort((a, b) => b.amount - a.amount);
    for (const node of inColumn.slice(maxPerColumn)) {
      // 子孫ごと外す
      const stack = [node.id];
      while (stack.length > 0) {
        const id = stack.pop() as string;
        kept.delete(id);
        for (const child of childrenOf.get(id) ?? []) stack.push(child);
      }
    }
  }

  // --- 集約ノードは列ごとに1つ ---
  //
  // 親ごとに「その他」を作ると灰色の細い行が延々と並び、/sankey-svg のように
  // 1本の太い集約ノードにならない。列で1つにまとめ、集約どうしを繋いで流れを保つ。
  const othersId = (column: MOFHierarchyColumn) => `__others__${column}`;
  const others = new Map<MOFHierarchyColumn, Building>();
  const othersLinks = new Map<string, number>();

  for (const node of nodes.values()) {
    if (node.id === ROOT_ID || kept.has(node.id)) continue;
    // 通過ノードは実体が無いので件数に数えない。金額は子孫側で拾われる
    if (node.details.passThrough) continue;
    const target = othersId(node.column);
    const existing = others.get(node.column);
    if (existing) {
      existing.amount += node.amount;
      existing.details.aggregatedCount = (existing.details.aggregatedCount ?? 0) + 1;
    } else {
      others.set(node.column, {
        id: target,
        name: OTHERS_NAME,
        column: node.column,
        amount: node.amount,
        details: { column: node.column, aggregated: true, aggregatedCount: 1 },
        parentId: null,
      });
    }
    // 親が残っていればそこから、外れていれば親の列の集約から流す。
    // ただし通過ノードの列には集約を作らないので、その場合はさらに上へ遡る。
    // 遡らないと、存在しないノードを指すリンクができる
    let parent = node.parentId ? nodes.get(node.parentId) : null;
    while (parent && !kept.has(parent.id) && parent.details.passThrough) {
      parent = parent.parentId ? nodes.get(parent.parentId) : null;
    }
    if (!parent) continue;
    const source = kept.has(parent.id) ? parent.id : othersId(parent.column);
    const key = `${source}\u0000${target}`;
    othersLinks.set(key, (othersLinks.get(key) ?? 0) + node.amount);
  }

  // --- 出力 ---
  const alive: Building[] = [
    ...[...nodes.values()].filter(n => kept.has(n.id)),
    ...others.values(),
  ];
  // 列順・列内は金額の大きい順。集約ノードは列の末尾に置く（/sankey-svg の作法）
  const columnOrder = new Map<MOFHierarchyColumn, number>(
    (['total', 'ministry', 'organization', 'subAccount', 'section', 'item'] as const).map(
      (c, i) => [c, i]
    )
  );
  alive.sort((a, b) => {
    const byColumn = (columnOrder.get(a.column) ?? 0) - (columnOrder.get(b.column) ?? 0);
    if (byColumn !== 0) return byColumn;
    const byAggregated = (a.details.aggregated ? 1 : 0) - (b.details.aggregated ? 1 : 0);
    if (byAggregated !== 0) return byAggregated;
    return b.amount - a.amount;
  });

  const sankeyNodes: MOFHierarchyNode[] = alive.map(n => ({
    id: n.id,
    // 集約ノードは件数を名前に出す（/sankey-svg の「5,744事業」と同じ考え方）
    name: n.details.aggregated
      ? `${OTHERS_NAME} ${(n.details.aggregatedCount ?? 0).toLocaleString()}件`
      : n.name,
    value: n.amount,
    type: n.column,
    details: n.details,
  }));

  const links: SankeyLink[] = [
    ...alive
      .filter(n => n.parentId !== null && kept.has(n.parentId))
      .map(n => ({ source: n.parentId as string, target: n.id, value: n.amount })),
    ...[...othersLinks.entries()].map(([key, value]) => {
      const [source, target] = key.split('\u0000');
      return { source, target, value };
    }),
  ];

  const accounts: MOFHierarchyAccountSummary[] = (
    ['general', 'special', 'agency'] as const
  )
    .map(accountType => {
      const rows = target.filter(i => i.accountType === accountType);
      return {
        accountType,
        label: ACCOUNT_LABELS[accountType],
        count: rows.length,
        amount: rows.reduce((s, i) => s + i.amount, 0),
      };
    })
    // 収録されていない会計区分は出さない（決算は一般会計にしか帳票が無い等）
    .filter(a => a.count > 0)
    .sort((a, b) => b.amount - a.amount);

  return {
    metadata: {
      fiscalYear: options.fiscalYear,
      eraLabel: options.eraLabel,
      budgetType: options.budgetType,
      budgetTypes: options.budgetTypes,
      availableYears: options.availableYears,
      total,
      itemCount: target.length,
      topN,
      maxPerColumn,
      unit: 'yen',
      notes: [
        '会計区分をまたいだ単純合計です。会計間の繰入がある分は二重に数えられています',
        '収録されていない会計区分は図に現れません（決算の事項別内訳は一般会計にしかありません）',
        '補正予算の金額は改予算額です。号数をまたいで合算しないでください',
        '項コードは組織内の連番で、単独では一意になりません',
        '「その他」は表示数の上限から溢れた分をまとめたものです。金額は保たれています',
      ],
    },
    accounts,
    sankey: { nodes: sankeyNodes, links },
  };
}
