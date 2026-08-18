/**
 * 財務省 予算書「事項別内訳」データの型定義。
 *
 * 事項（じこう）は予算書の〔組織別事項別内訳〕（一般会計）／〔歳出 事項別内訳〕（特別会計）／
 * 〔支出 事項別内訳〕（政府関係機関）に現れる階層で、項の下に置かれた経費のまとまりを指す。
 * MOF 側で唯一「事業らしい」名前と説明文を持つ粒度。
 *
 * 詳細は docs/mof-budget-data-guide.md を参照。
 */

/** 会計区分 */
export type MOFAccountType = 'general' | 'special' | 'agency';

/** 予算の種別 */
export type MOFBudgetType = '当初予算' | '暫定予算' | '補正予算（第1号）';

/** 事項1件 */
export interface MOFJikouItem {
  /**
   * 掲載位置ベースの行ID: {会計区分}-{帳票ID}-{ページ}-{行}。
   * 同一年度の同一帳票内では一意だが、予算書が改版されるとページがずれる。
   * 年度をまたいで同じ事項を追跡する用途には key を使うこと。
   */
  id: string;
  /**
   * 内容ベースの合成キー。次の順に `|` で連結する:
   * 会計区分・予算種別・所管・組織・特別会計・勘定・機関・項コード・事項名。
   * MOF は事項に公式なIDを振っていないため、これが実質的な識別子になる。
   * 予算種別を含めないと当初・暫定・補正で同じ事項が衝突する。
   * 令和8年度の全2,685件で重複なし。
   */
  key: string;
  accountType: MOFAccountType;
  budgetType: MOFBudgetType;
  /** 帳票ID（例: 202611001 = 令和8年度一般会計当初予算） */
  documentId: string;
  /** 所管（一般会計は単独省庁、特別会計は共管グループ名。政府関係機関は空） */
  ministry: string;
  /** 組織（一般会計のみ。例: 内閣本府） */
  organization: string;
  /** 特別会計名（特別会計のみ。例: エネルギー対策特別会計） */
  specialAccount: string;
  /** 勘定名（特別会計）／業務区分（政府関係機関）。持たないものは空 */
  subAccount: string;
  /** 政府関係機関名（政府関係機関のみ。例: 沖縄振興開発金融公庫） */
  agency: string;
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
  /**
   * 本年度額（円）。補正予算では補正後（改）予算額。
   * 予算書の印字は千円単位だが、リポジトリ全体の金額規約（1円単位）に合わせて
   * 生成時に1000倍している。CSV と突き合わせるときは1000で割ること。
   */
  amount: number;
  /**
   * 比較対象額（円）。当初予算では前年度予算額、補正予算では補正前の成立予算額。
   * 暫定予算のように帳票に比較欄が無い場合は null。
   */
  previousAmount: number | null;
  /** 増減額（円。減額は負値）。比較欄が無い帳票では null */
  difference: number | null;
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
    /** 収録した予算種別 */
    budgetTypes: MOFBudgetType[];
    /** 取り込んだ帳票の一覧 */
    documents: Array<{
      documentId: string;
      accountType: MOFAccountType;
      budgetType: MOFBudgetType;
      title: string;
      url: string;
      pages: number;
      count: number;
    }>;
    /** 金額の単位。予算書は千円単位だが、生成時に円へ正規化している */
    unit: 'yen';
    /** 生成日時（ISO8601） */
    generatedAt: string;
    notes: string[];
  };
  summary: {
    count: number;
    /**
     * 総額は持たない。当初・暫定・補正は同じ予算の別断面であり、会計間の繰入も
     * 重複するため、全件を足した1つの数字は意味を持たない。内訳だけを提供する。
     */
    byAccountType: MOFJikouGroupSummary[];
    byBudgetType: MOFJikouGroupSummary[];
    byMinistry: MOFJikouGroupSummary[];
    byMajorExpense: MOFJikouGroupSummary[];
  };
  items: MOFJikouItem[];
}
