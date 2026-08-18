/**
 * 財務省 予算書「事項別内訳」データの型定義。
 *
 * 事項（じこう）は予算書の〔組織別事項別内訳〕（一般会計）／〔歳出 事項別内訳〕（特別会計）
 * に現れる階層で、項と目の間ではなく「項の下に置かれた、経費のまとまり」を指す。
 * MOF 側で唯一「事業らしい」名前と説明文を持つ粒度。
 *
 * 詳細は docs/mof-budget-data-guide.md を参照。
 */

/** 会計区分 */
export type MOFAccountType = 'general' | 'special';

/** 事項1件 */
export interface MOFJikouItem {
  /** 安定ID: {general|special}-{ページ}-{行} */
  id: string;
  accountType: MOFAccountType;
  /** 所管（一般会計は単独省庁、特別会計は共管グループ名） */
  ministry: string;
  /** 組織（一般会計のみ。例: 内閣本府） */
  organization: string;
  /** 特別会計名（特別会計のみ。例: エネルギー対策特別会計） */
  specialAccount: string;
  /** 勘定名（特別会計で勘定を持つもののみ。例: エネルギー需給勘定） */
  subAccount: string;
  /** 項コード（組織・勘定内での連番。単独では一意にならない） */
  sectionCode: string;
  /** 項名 */
  sectionName: string;
  /** 主要経費別分類コード */
  majorExpenseCode: string;
  /** 主要経費別分類名（コード表から解決。未知コードは空文字） */
  majorExpenseName: string;
  /** 事項名 */
  name: string;
  /** 本年度額（千円） */
  amount: number;
  /** 前年度予算額（千円） */
  previousAmount: number;
  /** 比較増△減額（千円。減額は負値） */
  difference: number;
  /** 説明（所掌事務・根拠法等。予算書の「説明」欄の全文） */
  description: string;
  /** 予算書のページ番号 */
  page: number;
  /** 出典 XML の URL */
  sourceUrl: string;
}

/** 集計の1要素 */
export interface MOFJikouGroupSummary {
  key: string;
  count: number;
  amount: number;
}

/** 出力 JSON 全体 */
export interface MOFJikouData {
  metadata: {
    /** 会計年度（西暦） */
    fiscalYear: number;
    /** 元号表記（例: 令和8年度） */
    eraLabel: string;
    /** 予算の種別（当初予算） */
    budgetType: string;
    /** 金額の単位 */
    unit: 'thousand_yen';
    /** 生成日時（ISO8601） */
    generatedAt: string;
    /** 取得元 */
    source: {
      generalAccount: string;
      specialAccount: string;
    };
    notes: string[];
  };
  summary: {
    count: number;
    amount: number;
    byAccountType: MOFJikouGroupSummary[];
    byMinistry: MOFJikouGroupSummary[];
    byMajorExpense: MOFJikouGroupSummary[];
  };
  items: MOFJikouItem[];
}
