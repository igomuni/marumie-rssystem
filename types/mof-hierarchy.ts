/**
 * MOF 事項別内訳の階層サンキーの型定義。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 の6列で、
 * 「国の予算がどの省庁のどの事業まで下りるか」を1枚で追えるようにする。
 *
 * データ源は `public/data/mof-jikou-{YEAR}.json`（事項別内訳）。専用の生成物は持たない。
 */

import type { MOFAccountType, MOFBudgetType, MOFJikouItem } from './mof-jikou';
import type { SankeyLink, SankeyNode } from './sankey';

/** 列。左から右へ並ぶ順に番号を振る */
export const MOF_HIERARCHY_COLUMNS = [
  'total',
  'ministry',
  'organization',
  'subAccount',
  'section',
  'item',
] as const;

export type MOFHierarchyColumn = (typeof MOF_HIERARCHY_COLUMNS)[number];

export const MOF_HIERARCHY_COLUMN_LABELS: Record<MOFHierarchyColumn, string> = {
  total: '予算合計',
  ministry: '所管',
  organization: '組織/特会',
  subAccount: '勘定/業務',
  section: '項',
  item: '事項',
};

/** ノードに添える詳細 */
export interface MOFHierarchyNodeDetails {
  column: MOFHierarchyColumn;
  /** TopN から溢れた分をまとめたノードか */
  aggregated?: boolean;
  /**
   * その列に値を持たない枝の通過点か。
   * 一般会計や勘定を持たない特別会計は勘定列を素通りするが、
   * 何も置かないと帯がその列の実ノードを横切って重なる。
   * 場所だけ確保する透明なノードとして置き、描画では箱もラベルも出さない。
   */
  passThrough?: boolean;
  /** まとめた元の件数（集約ノードのみ） */
  aggregatedCount?: number;
  /** 会計区分。所管より下の列では枝ごとに1つに定まる */
  accountType?: MOFAccountType;
  /** 事項ノードの説明（所掌事務・根拠法）。予算書の「説明」欄 */
  description?: string;
  /** 項ノードの項コード */
  sectionCode?: string;
  /** 事項ノードの主要経費別分類名 */
  majorExpenseName?: string;
}

export type MOFHierarchyNode = SankeyNode & {
  name: string;
  details: MOFHierarchyNodeDetails;
};

/** 列ごとの TopN。指定の無い列は集約しない */
export type MOFHierarchyTopN = Partial<Record<MOFHierarchyColumn, number>>;

/** 会計区分ごとの内訳。何が収録されているかを見出しに出すために持つ */
export interface MOFHierarchyAccountSummary {
  accountType: MOFAccountType;
  label: string;
  count: number;
  amount: number;
}

export interface MOFHierarchyData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    /** 選択中の予算種別 */
    budgetType: MOFBudgetType;
    /** その年度に収録されている予算種別 */
    budgetTypes: MOFBudgetType[];
    /** 収録済みの会計年度（新しい順） */
    availableYears: number[];
    /** 図に出ている事項の合計（円）。会計区分をまたぐ単純合計 */
    total: number;
    /** 図に出ている事項の件数 */
    itemCount: number;
    /** 適用した TopN */
    topN: MOFHierarchyTopN;
    /** 適用した列ごとのノード数上限 */
    maxPerColumn: number;
    unit: 'yen';
    notes: string[];
  };
  /** 会計区分ごとの内訳（金額の大きい順） */
  accounts: MOFHierarchyAccountSummary[];
  sankey: {
    nodes: MOFHierarchyNode[];
    links: SankeyLink[];
  };
}

/** 組み立てに使う入力。ローダから渡す */
export type MOFHierarchyInput = Pick<MOFJikouItem, never> & MOFJikouItem;
