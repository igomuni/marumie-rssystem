/** /budget-request-trend 用データ（scripts/pipeline-v2/build-budget-request-trend-csv.ts が出力）。仕様: docs/budget-request-trend-csv.md */

/** 1 年度の値。金額は千円。 */
export interface BudgetRequestTrendYear {
  /** 前年度予算額（その年度の要求書が載せる値） */
  prev: number | null;
  /** 概算要求額 */
  req: number | null;
  /** 載っている要求書: [urls の添字, 要求書内の頁] */
  src: [number, string][];
  /** 要求書ごとの [前年度予算額, 概算要求額]（src と同じ並び。mismatch のときだけ）。prev / req は最も大きい額の書（合計書）の値 */
  srcAmt?: [number | null, number | null][];
  /** 同じキーが複数の要求書にあり、金額が一致しない */
  mismatch: boolean;
  /** MOF 突合の状態（参考。MOF の版が無い年度は空） */
  mof: string;
}

/** 項 1 件（年度をまたぐキー: 会計区分 + 所管コード + 特別会計 + 勘定 + 組織 + 項名） */
export interface BudgetRequestTrendRow {
  /** 0 = 一般会計, 1 = 特別会計 */
  acct: 0 | 1;
  /** 表紙の所管コード */
  code: string;
  /** 一般会計は所管名、特別会計は特別会計名 */
  min: string;
  /** 勘定（特別会計のみ） */
  sub: string;
  org: string;
  /** 組織の出所: 目次 / 総表 / 表紙括弧 / なし */
  orgSrc: string;
  name: string;
  /** 項コード（同じ要求書に同名の別の項があるときだけ。キーに含める） */
  kou?: string;
  /** 西暦（文字列）→ その年度の値。載っていない年度は無い */
  y: Record<string, BudgetRequestTrendYear>;
}

export interface BudgetRequestTrendData {
  years: number[];
  /** 元の PDF の URL */
  urls: string[];
  rows: BudgetRequestTrendRow[];
}
