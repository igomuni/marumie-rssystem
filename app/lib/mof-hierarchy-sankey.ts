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
import { MOF_HIERARCHY_AGGREGATE_UNITS } from '@/types/mof-hierarchy';
import type {
  MOFHierarchyAccountSummary,
  MOFHierarchyColumn,
  MOFHierarchyData,
  MOFHierarchyNode,
  MOFHierarchyNodeDetails,
  MOFHierarchyOffset,
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
 * TopN は列全体の表示件数の上限で、親ごとの件数ではない（/sankey-svg と同じ）。
 * 親ごとに N 件ずつ残すと、親の数だけ掛け算で増えて列の総数を抑えられず、
 * 実測で項730・事項1,184になり1ノードが1px未満になった。
 *
 * 40 は「ラベルが読める上限」として実測で決めた値。令和8年度・当初予算では
 * 所管25・勘定32 は全件が収まり、組織114・項1,104・事項1,712 が集約される。
 */
export const DEFAULT_TOP_N_VALUE = 40;

/**
 * 所管は省庁の数なので上限を掛けない（実測25件で、どの年度でも収まる）。
 * 常に全件が出る列にスライダーを置くと、動かしても何も起きない操作になる。
 */
export const DEFAULT_TOP_N: MOFHierarchyTopN = {
  organization: DEFAULT_TOP_N_VALUE,
  subAccount: DEFAULT_TOP_N_VALUE,
  section: DEFAULT_TOP_N_VALUE,
  item: DEFAULT_TOP_N_VALUE,
};

/** 集約ノードに載せる内訳の件数 */
const AGGREGATED_TOP_COUNT = 8;

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

/**
 * 事項別内訳から階層サンキーを組む。
 *
 * @param items その年度・予算種別の事項（絞り込みは呼び出し側で行わない）
 */
/** 6列の順序。予算合計は根なので含まない */
const HIERARCHY_COLUMNS_EXCEPT_TOTAL: Array<Exclude<MOFHierarchyColumn, 'total'>> = [
  'ministry',
  'organization',
  'subAccount',
  'section',
  'item',
];

/**
 * 事項別内訳から、階層をたどった全ノード（実ノードのみ・TopNで絞る前）を作る。
 *
 * buildMOFHierarchySankey（図の表示用、TopNで絞る）と
 * buildMOFHierarchyBrowseTree（サイドパネル用、絞らず全件）の両方が
 * この結果を土台にする。値の無い列は透明な通過ノードで場所だけ確保する
 * （描画では素通りさせ、帯の端点にはしない）。
 */
function buildFullNodeMap(target: MOFJikouItem[]): {
  nodes: Map<string, Building>;
  childrenOf: Map<string, Set<string>>;
  total: number;
} {
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

  for (const item of target) {
    const levels = levelsOf(item);
    let parentId = ROOT_ID;
    let path = ROOT_ID;
    for (const column of HIERARCHY_COLUMNS_EXCEPT_TOTAL) {
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

  return { nodes, childrenOf, total };
}

/**
 * 通過ノードを飛び越えて、実在する直近の祖先を返す（buildMOFHierarchySankey の
 * realAncestorId と同じ考え方。ノード集合を引数で受け取れるようにして両関数で共有する）。
 */
function skipPassThroughAncestors(
  nodeMap: Map<string, Building>,
  parentId: string
): string {
  let cur = nodeMap.get(parentId);
  while (cur && cur.details.passThrough && cur.parentId) {
    cur = nodeMap.get(cur.parentId);
  }
  return cur ? cur.id : parentId;
}

/**
 * サイドパネルの一覧・タブ用に、階層の全ノードを TopN で絞らずそのまま返す。
 *
 * /sankey-svg は常にフルデータ（graphData）をパネル用に保持し、図の集約とは
 * 独立して全件を辿れる。ここも同じにする。図の TopN は表示だけの都合なので、
 * それでパネルの情報まで削るべきではない。
 *
 * 通過ノードは出力しない。帯は実ノード同士を直結する
 * （buildMOFHierarchySankey が集約ノードの帯を実ノード直結にしているのと同じ理由）。
 */
function nodeMapToBrowseTree(
  nodes: Map<string, Building>
): { nodes: MOFHierarchyNode[]; links: SankeyLink[] } {
  const real = [...nodes.values()].filter(n => !n.details.passThrough);
  const sankeyNodes: MOFHierarchyNode[] = real.map(n => ({
    id: n.id,
    name: n.name,
    value: n.amount,
    type: n.column,
    details: n.details,
  }));
  const links: SankeyLink[] = real
    .filter(n => n.parentId !== null)
    .map(n => ({
      source: skipPassThroughAncestors(nodes, n.parentId as string),
      target: n.id,
      value: n.amount,
    }));

  return { nodes: sankeyNodes, links };
}

export function buildMOFHierarchyBrowseTree(
  items: MOFJikouItem[],
  budgetType: MOFBudgetType
): { nodes: MOFHierarchyNode[]; links: SankeyLink[] } {
  const target = items.filter(i => i.budgetType === budgetType);
  const { nodes } = buildFullNodeMap(target);
  return nodeMapToBrowseTree(nodes);
}

export function buildMOFHierarchySankey(
  items: MOFJikouItem[],
  options: {
    fiscalYear: number;
    eraLabel: string;
    budgetType: MOFBudgetType;
    budgetTypes: MOFBudgetType[];
    availableYears: number[];
    /** 列ごとの表示件数の上限。指定の無い列は既定値 */
    topN?: MOFHierarchyTopN;
    /** 列ごとの表示開始位置（0始まり）。範囲外は丸める */
    offset?: MOFHierarchyOffset;
  }
): MOFHierarchyData {
  const topN = { ...DEFAULT_TOP_N, ...options.topN };
  const offset: MOFHierarchyOffset = { ...options.offset };
  const target = items.filter(i => i.budgetType === options.budgetType);

  // --- 階層を辿ってノードを作る ---
  // ノードIDは根からのパス。事項名は項をまたいで重複するため、名前だけでは合流してしまう
  const { nodes, childrenOf, total } = buildFullNodeMap(target);
  const columns = HIERARCHY_COLUMNS_EXCEPT_TOTAL;

  // --- 残すノードを決める ---
  //
  // TopN は列全体の表示件数の上限として効かせる（/sankey-svg と同じ）。
  // 親ごとに N 件ずつ残すと親の数だけ掛け算で増え、列の総数を抑えられない。
  //
  // 左の列から順に決め、候補は「親が残っている枝」に限る。こうすると
  // 集約された所管の下から事項が単独で顔を出すことがなくなり、
  // 図の左から右へ辿れる形が保たれる。
  const kept = new Set<string>([ROOT_ID]);
  const columnCounts: Partial<Record<MOFHierarchyColumn, number>> = {};
  const appliedOffset: MOFHierarchyOffset = {};
  for (const column of columns) {
    const candidates = [...nodes.values()].filter(
      n => n.column === column && n.parentId !== null && kept.has(n.parentId)
    );
    // 通過ノードは枝の骨格なので順位付けの対象にしない（ラベルも箱も出ない）
    for (const node of candidates.filter(n => n.details.passThrough)) kept.add(node.id);
    const rankable = candidates
      .filter(n => !n.details.passThrough)
      .sort((a, b) => b.amount - a.amount);
    columnCounts[column] = rankable.length;

    const limit = topN[column];
    if (!limit) {
      appliedOffset[column] = 0;
      for (const node of rankable) kept.add(node.id);
      continue;
    }
    // 行き過ぎた指定は末尾に丸める。空の窓を返すと図が消えて操作不能になる
    const start = Math.max(0, Math.min(offset[column] ?? 0, Math.max(0, rankable.length - limit)));
    appliedOffset[column] = start;
    for (const node of rankable.slice(start, start + limit)) kept.add(node.id);
  }

  // --- 集約ノードは列ごとに1つ ---
  //
  // 親ごとに「その他」を作ると灰色の細い行が延々と並び、/sankey-svg のように
  // 1本の太い集約ノードにならない。列で1つにまとめ、集約どうしを繋いで流れを保つ。
  const othersId = (column: MOFHierarchyColumn) => `__others__${column}`;

  /**
   * 通過ノードを飛び越えて、実在する直近の祖先を返す。
   *
   * 通過ノードは箱もラベルも出ない透明な存在なので、帯の端点にすると
   * 「実在しない位置で収束・分岐している」ように見え、見た目に理由の
   * 分からないくびれになる。帯は実ノード同士を直結し、通過ノードは
   * 列の場所を確保するためだけに使う（ラベルの縦位置合わせに利く）
   */
  const realAncestorId = (parentId: string): string => skipPassThroughAncestors(nodes, parentId);
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
      existing.details.aggregatedTop?.push({ name: node.name, amount: node.amount });
    } else {
      others.set(node.column, {
        id: target,
        // 名前は出力時に件数から作る
        name: '',
        column: node.column,
        amount: node.amount,
        details: {
          column: node.column,
          aggregated: true,
          aggregatedCount: 1,
          aggregatedTop: [{ name: node.name, amount: node.amount }],
        },
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
    // 親が残っていても通過ノードなら、さらにその先の実ノードから流す
    const source = kept.has(parent.id)
      ? realAncestorId(parent.id)
      : othersId(parent.column);
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

  // 集約ノードの内訳は金額の大きい順に絞る。全件持つと応答が膨らむ
  for (const node of others.values()) {
    const top = node.details.aggregatedTop ?? [];
    top.sort((a, b) => b.amount - a.amount);
    node.details.aggregatedTop = top.slice(0, AGGREGATED_TOP_COUNT);
  }

  const sankeyNodes: MOFHierarchyNode[] = alive.map(n => ({
    id: n.id,
    // 集約ノードは件数を名前に出す（/sankey-svg の「5,744事業」と同じ考え方）。
    // 「その他」だと何件が図の外にあるのか読めない
    name: n.details.aggregated
      ? `${(n.details.aggregatedCount ?? 0).toLocaleString()}${
          MOF_HIERARCHY_AGGREGATE_UNITS[n.column]
        }`
      : n.name,
    value: n.amount,
    type: n.column,
    details: n.details,
  }));

  const links: SankeyLink[] = [
    ...alive
      .filter(n => n.parentId !== null && kept.has(n.parentId) && !n.details.passThrough)
      .map(n => ({ source: realAncestorId(n.parentId as string), target: n.id, value: n.amount })),
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
    browse: nodeMapToBrowseTree(nodes),
    metadata: {
      fiscalYear: options.fiscalYear,
      eraLabel: options.eraLabel,
      budgetType: options.budgetType,
      budgetTypes: options.budgetTypes,
      availableYears: options.availableYears,
      total,
      itemCount: target.length,
      topN,
      offset: appliedOffset,
      columnCounts,
      unit: 'yen',
      notes: [
        '会計区分をまたいだ単純合計です。会計間の繰入がある分は二重に数えられています',
        '収録されていない会計区分は図に現れません（決算の事項別内訳は一般会計にしかありません）',
        '補正予算の金額は改予算額です。号数をまたいで合算しないでください',
        '項コードは組織内の連番で、単独では一意になりません',
        '「41組織」のような灰色のノードは、表示の窓から外れた分をまとめたものです。金額は保たれています',
      '表示開始位置をずらすと、窓の外にあった下位の順位も辿れます',
      ],
    },
    accounts,
    sankey: { nodes: sankeyNodes, links },
  };
}
