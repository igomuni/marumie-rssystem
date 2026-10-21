/** /budget-request-mof 用データ（scripts/pipeline-v2/build-budget-request-mof-ui.ts が出力）。仕様: docs/budget-request-mof-ui.md */

/** 行の種類: matched = MOF の項に概算要求が対応、mofOnly = MOF のみ、reqOnly = 概算要求のみ（名前が見つからない）、zero = 額0の項（前年度・要求とも 0） */
export type BudgetRequestMofKind = 'matched' | 'mofOnly' | 'reqOnly' | 'zero';

/** 差の理由の型（読み方の手がかり。理由を確定するものではない） */
export type BudgetRequestMofType = '事項要求' | '組織に事項要求' | '要求額0' | '一括計上' | '一括計上の配分先' | '編成で決まる' | '複数書' | '持ち分' | '名前が近い' | '改称' | '統合';

/** 1 行 = 年度 × MOF の項（MOF のみ・概算要求のみ・額0の項は、それぞれの側の項）。金額は千円 */
export interface BudgetRequestMofRow {
  /** 年度（西暦） */
  y: number;
  kind: BudgetRequestMofKind;
  /** 0 = 一般会計, 1 = 特別会計 */
  acct: 0 | 1;
  /** 予算書・要求書の所管（要求書の無い行の所管に使う）。特別会計の MOF のみの行は、共管所管名か、共管の会計なら「、」「及び」で列挙した所管 */
  grp: string;
  /** 一般会計は所管名、特別会計は特別会計名 */
  min: string;
  /** 勘定（特別会計のみ） */
  sub: string;
  /** 組織（一般会計のみ） */
  org: string;
  name: string;
  /** MOF の当初予算額（予算書の政府案）。MOF の項が無い行は null */
  mof: number | null;
  /** MOF の予算書の前年度予算額 */
  mofPrev: number | null;
  /** 概算要求額（同じ項が複数の書に載るときは最も大きい額＝合計書）。概算要求の行が無いときは null */
  req: number | null;
  /** 概算要求書の前年度予算額（req と同じ書） */
  reqPrev: number | null;
  /** 要求書ごと: [urls の添字, 目次の頁（紙面の印字）, PDF の通し頁（引けないときは空）, 要求額] */
  books: [number, string, string, number | null][];
  types: BudgetRequestMofType[];
  /** 項の中の事項要求の記載（最初の出現の行） */
  jikouText?: string;
  /** 組織の行の事項要求の備考 */
  orgJikouText?: string;
  /** MOF の名前（概算要求の名前と違うとき。NEAR_NAME） */
  mofName?: string;
}

export interface BudgetRequestMofData {
  years: number[];
  /** 年度 → MOF の版（例: 2025 → 2025_teishutsu。すべて国会への提出時の政府案） */
  versions: Record<string, string>;
  /** 元の PDF の URL */
  urls: string[];
  rows: BudgetRequestMofRow[];
}
