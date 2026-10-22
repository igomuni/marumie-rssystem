/** /budget-request-trend 用データ（scripts/pipeline-v2/build-budget-request-trend-csv.ts が出力）。仕様: docs/budget-request-trend-csv.md */

/** 1 年度の値。金額は千円。 */
export interface BudgetRequestTrendYear {
  /** その年度の表紙の所管コード（年度で変わることがある。例: 年金特会 9207 → 2507） */
  code: string;
  /** 前年度予算額（その年度の要求書が載せる値） */
  prev: number | null;
  /** 概算要求額 */
  req: number | null;
  /** 載っている要求書: [urls の添字, 目次の頁（紙面の印字）, PDF の通し頁（引けないときは空）, 頁の状態（'e' = 前後の頁ラベルから推定、'i' = 推定した頁が画像で文字層なし、空 = 明細表から引けた）] */
  src: [number, string, string, string?][];
  /** 要求書ごとの [前年度予算額, 概算要求額]（src と同じ並び。mismatch のときだけ）。prev / req は最も大きい額の書（合計書）の値 */
  srcAmt?: [number | null, number | null][];
  /** 項の下の目に「繰入」を含むときの繰入先（目名。例: 国債整理基金特別会計へ繰入）。会計をまたぐ合計では二重になりうる */
  xfer?: string[];
  /** 同じキーが複数の要求書にあり、金額が一致しない */
  mismatch: boolean;
  /** 前の項をこの項につないだ（移管元が特定できた）。kind: 移管 = 新設の会計・勘定へ、改称 = 同じ所管・勘定で組織か項名が変わった。from = 前の項（所管 › 勘定 › 組織「項名」） */
  moved?: { kind: '移管' | '改称'; from: string };
  /** 所管コードが前の年度から変わった */
  codeChanged?: boolean;
  /** 特別会計 + 勘定がこの年度に新設された（前年度に無い） */
  newAcct?: boolean;
  /** 紐づけの候補: この項は前年度に無く、rows の添字の項（前年度に在り、この年度に無い）が同じ項かもしれない */
  from?: number;
  /** 紐づけの候補: この項はこの年度の翌年度に無く、rows の添字の項（翌年度に新規）が同じ項かもしれない */
  to?: number;
  /** MOF 突合の状態（参考。MOF の版が無い年度は空） */
  mof: string;
  /** 備考に事項要求（金額を示さない要求）の記載がある。jikou.json.gz からページで合流する。仕様: docs/budget-request-jikou-youkyu.md */
  jikou?: BudgetRequestJikou;
  /** この項の組織の行の備考に事項要求の記載がある（組織全体の事項要求。どの項に含まれるかは要求書に書かれていない）。値は備考の本文 */
  orgJikou?: string;
  /** 事項・目の数（detail.json.gz からページで合流する。目は事項をまたいで目名 + 目別で数える） */
  nJikou?: number;
  nMoku?: number;
}

/** 事項要求の記載の形（印 = 「（事項要求）」 / 文 = 文中の言及）と、最初の出現の行 */
export interface BudgetRequestJikou {
  forms: string[];
  text: string;
}

/** 項 1 件（年度をまたぐキー: 会計区分 + 所管（一般会計のみ）+ 特別会計 + 勘定 + 組織 + 項名） */
export interface BudgetRequestTrendRow {
  /** 0 = 一般会計, 1 = 特別会計 */
  acct: 0 | 1;
  /** 最新年度の表紙の所管コード */
  code: string;
  /** 一般会計は所管名、特別会計は特別会計名 */
  min: string;
  /** 勘定（特別会計のみ） */
  sub: string;
  org: string;
  /** 組織の出所: 目次 / 総表 / 表紙括弧 / 他の書 / なし */
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

/** /budget-request-trend 用の事項要求の記載（scripts/pipeline-v2/build-budget-request-jikou-youkyu.ts が出力）。年度（西暦の文字列）→ [行のキー（jikouKeyOf）, 形, 根拠の行] */
export interface BudgetRequestJikouData {
  years: Record<string, [string, string[], string][]>;
  /** 組織の行の事項要求: 年度 → [組織のキー（jikouOrgKeyOf）, 備考の本文] */
  orgs?: Record<string, [string, string][]>;
}

/** 項の事項・目の内訳（1 年度・1 項）。金額は千円。仕様: docs/budget-request-trend-detail-csv.md */
export interface BudgetRequestTrendDetailKou {
  /** 事項: [要求番号, 事項名, 前年度予算額（総表）, 要求額（総表）, 目の要求額の合計（目が無ければ null）, 検算（一致 / 不一致 / 額の空きあり / 目なし / 画像の頁 / 事項の額なし）] */
  j: [string, string, number | null, number | null, number | null, string][];
  /** 目: [事項の添字（j の並び。事項の行より前の目は -1）, 目名, 目別 2 桁, 前年度予算額, 要求額, 細分の合計を使った行の数, 額の無い行の数] */
  m: [number, string, string, number | null, number | null, number, number][];
}

/** /budget-request-trend の事項・目の内訳（scripts/pipeline-v2/build-budget-request-trend-detail-csv.ts が出力）。年度（西暦の文字列）→ 行のキー（jikouKeyOf）→ 内訳 */
export interface BudgetRequestTrendDetailData {
  years: Record<string, Record<string, BudgetRequestTrendDetailKou>>;
}
