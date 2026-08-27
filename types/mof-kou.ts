/**
 * 財務省 予算書「項」一覧の型定義。
 *
 * `/mof-jikou`（事項＝目的別内訳）と `/mof-kou-moku`（目＝性質別内訳）は、共通の親である
 * 「項」の下に並列にぶら下がる別系統の内訳（対応表はない）。このページはさらに一段引いて、
 * 項ごとに「事項が何件、目が何件あり、そのうち目の完全一致でRS事業に何件紐づいているか」
 * という関係性だけを見る。
 *
 * 集計は app/lib/api/mof-kou-loader.ts が、既存の mof-jikou・mof-kou-moku・
 * mof-rs-kou-moku-linkage の読み込み結果からリクエスト時に組み立てる
 * （このページ専用の生成JSONファイルは持たない）。
 */

import type { MOFBudgetType } from './mof-jikou';
import type { MOFKouMokuAccountType, MOFKouMokuGroupSummary } from './mof-kou-moku';
import type { MOFJikouItem } from './mof-jikou';
import type { MOFKouMokuItem } from './mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from './mof-rs-kou-moku-linkage';

/** 項1件ぶんの集計行（一覧表示用。詳細な内訳は含まない） */
export interface MOFKouSectionSummary {
  /** 会計区分・予算種別・所管・組織/特会/機関・勘定・項コードを連結した合成キー */
  id: string;
  accountType: MOFKouMokuAccountType;
  budgetType: MOFBudgetType;
  ministry: string;
  /** 一般会計のみ（特別会計・政府関係機関は空） */
  organization: string;
  /** 特別会計のみ（他は空） */
  specialAccount: string;
  subAccount: string;
  /** 政府関係機関のみ（他は空） */
  agency: string;
  sectionCode: string;
  sectionName: string;
  /**
   * 主要経費（金額最大のもの）。項と主要経費は1対1ではなく、複数の主要経費が
   * 混在する項が実際にある（2024年度実測: kou-mokuで3,321項中302項）。
   * `majorExpenseMixed` が true のときは、この項内で最大シェアの主要経費を代表値として示す。
   */
  majorExpenseName: string;
  /** true のときこの項には2種類以上の主要経費が混在する（金額最大のものを majorExpenseName に採用） */
  majorExpenseMixed: boolean;
  /** この項に属する事項（目的別内訳）の件数 */
  jikouCount: number;
  /** この項に属する目（性質別内訳）の件数 */
  kouMokuCount: number;
  /** 目の完全一致で紐づいたRS事業の実数（重複除き） */
  rsProjectCount: number;
  /** 項の本年度額（円）。目（kou-moku）側の合計 */
  amount: number;
  /** 前年度額（円）。項内のいずれかの目で比較対象額が無ければ null */
  previousAmount: number | null;
  difference: number | null;
}

/** 1項ぶんの詳細（行を展開したときに取得） */
export interface MOFKouSectionDetail {
  id: string;
  jikouItems: MOFJikouItem[];
  kouMokuItems: MOFKouMokuItem[];
  rsLinks: MofRsKouMokuLinkageRecord[];
}

/** 出力（一覧API）全体 */
export interface MOFKouData {
  metadata: {
    fiscalYear: number;
    eraLabel: string;
    budgetTypes: MOFBudgetType[];
    unit: 'yen';
    generatedAt: string;
    /** 収録済みの会計年度一覧（新しい順）。API が応答時に付与する */
    availableYears?: number[];
    /** その年度のRS紐づけ状況（mof-rs-kou-moku-linkage-loader.resolveLinks と同じ意味） */
    linkage: {
      available: boolean;
      isCarriedOver: boolean;
      sourceBudgetYear: number | null;
      rsYear: number | null;
    };
    notes: string[];
  };
  summary: {
    count: number;
    byAccountType: MOFKouMokuGroupSummary[];
    byBudgetType: MOFKouMokuGroupSummary[];
  };
  sections: MOFKouSectionSummary[];
}
