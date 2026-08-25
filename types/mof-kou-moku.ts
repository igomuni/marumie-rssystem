/**
 * 財務省 予算書「科目別内訳」（項・目）データの型定義。
 *
 * `/mof-jikou` が Web帳票の〔事項別内訳〕（項の下の「事項」）を扱うのに対し、
 * こちらは ZIP 同梱 CSV の科目別内訳（項の下の「目」）を扱う。
 * 目は「庁費」「職員基本給」のような支出の性質による分類で、事項（目的による分類）とは
 * 別の切り口の内訳（docs/mof-budget-data-guide.md 参照）。RS システムの
 * `2-2_予算・執行_予算種別・歳出予算項目` も 所管/組織・勘定/項/目 を同じ語彙で持つため、
 * 目レベルはMOFとRSを構造的に直接突き合わせられる。
 *
 * ZIP は当初予算のみをローカル保有（暫定・補正・決算のZIPは未取得）のため、
 * 現状は当初予算のみを収録する。
 */

/** 会計区分 */
export type MOFKouMokuAccountType = 'general' | 'special' | 'agency';

/** 目1件（科目別内訳の1行） */
export interface MOFKouMokuItem {
  /** 行ID。同一年度・会計区分内で一意（CSV内の出現順） */
  id: string;
  /**
   * 内容ベースの合成キー。会計区分・所管・組織／特別会計／機関・勘定・項コード・
   * 目分類コード・目名を `|` で連結したもの。MOFは目にも公式なIDを振っていないため、
   * これが実質的な識別子になる（年度をまたぐ追跡は事項以上に不安定なため現状は未対応）。
   */
  key: string;
  accountType: MOFKouMokuAccountType;
  /** 所管（一般会計は単独省庁、特別会計は共管グループ名。政府関係機関は空） */
  ministry: string;
  /** 組織（一般会計のみ。例: 内閣本府） */
  organization: string;
  /** 特別会計名（特別会計のみ） */
  specialAccount: string;
  /** 勘定名（特別会計のみ。空のことが多い） */
  subAccount: string;
  /** 政府関係機関名（政府関係機関のみ） */
  agency: string;
  /** 項コード（組織・勘定内での連番。単独では一意にならない） */
  sectionCode: string;
  /** 項名 */
  sectionName: string;
  /** 主要経費別分類コード（政府関係機関の帳票には無い） */
  majorExpenseCode: string;
  /** 主要経費別分類名（コード表から解決。未知コード・無い帳票は空文字） */
  majorExpenseName: string;
  /** 目別分類コード（政府関係機関は「目コード」列） */
  subItemCode: string;
  /** 目名 */
  subItemName: string;
  /** 使途別分類コード */
  purposeCode: string;
  /** 使途別分類名（コード表から解決。未知コードは空文字） */
  purposeName: string;
  /** 本年度額（円）。予算書の印字は千円単位だが、生成時に円へ揃えている */
  amount: number;
  /** 前年度予算額（円） */
  previousAmount: number;
  /** 増減額（円。減額は負値） */
  difference: number;
}

/** 集計の1要素 */
export interface MOFKouMokuGroupSummary {
  key: string;
  count: number;
  amount: number;
}

/** 出力 JSON 全体 */
export interface MOFKouMokuData {
  metadata: {
    /** 会計年度（西暦） */
    fiscalYear: number;
    /** 元号表記（例: 令和8年度） */
    eraLabel: string;
    /** 当初予算のみ収録（ZIPが当初予算しか無いため） */
    budgetType: '当初予算';
    /** 取り込んだ帳票の一覧 */
    documents: Array<{
      accountType: MOFKouMokuAccountType;
      title: string;
      count: number;
    }>;
    unit: 'yen';
    generatedAt: string;
    /** 収録済みの会計年度一覧（新しい順）。API が応答時に付与する */
    availableYears?: number[];
    notes: string[];
  };
  summary: {
    count: number;
    byAccountType: MOFKouMokuGroupSummary[];
    byMinistry: MOFKouMokuGroupSummary[];
    byMajorExpense: MOFKouMokuGroupSummary[];
    byPurpose: MOFKouMokuGroupSummary[];
  };
  items: MOFKouMokuItem[];
}
