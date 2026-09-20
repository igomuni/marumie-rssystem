/**
 * Pipeline V2 共通型定義。normalized・derived層で共有する。
 * 仕様: docs/tasks/20260919_0900_marumie-rssystem × ChatGPT 分析プラクティス/
 *       20260919_Pipeline_V2基盤整備_実装タスク_v2.md
 */

/** 金額イベントの種別。今回のPoCで実際に生成するのは initial/supplementary/settlement系（reserve/transfer/carryover/execution/unused）とrequestのみ */
export type EventType =
  | 'request'
  | 'government_draft'
  | 'initial'
  | 'supplementary'
  | 'reserve'
  | 'transfer'
  | 'carryover_in'
  | 'execution'
  | 'carryover_out'
  | 'settlement'
  | 'unused';

/** normalizedデータの出自。どのraw原本のどのファイルに由来するかを追跡する */
export interface Provenance {
  domain: 'mof.go.jp' | 'rssystem.go.jp';
  dataset: string;
  year: number;
  file: string;
}

/** MOFの予算・決算イベント。項・目コードは原典表記のまま保持し、canonical化はderived層で行う */
export interface MofBudgetEvent {
  fiscalYear: number;
  eventType: EventType;
  /** 所管（一般会計・特別会計）または政府関係機関名 */
  account: string;
  /** 組織（一般会計）・特別会計名（特別会計）・業務（政府関係機関） */
  organization: string;
  /** 勘定。特別会計のみ存在（所管・特別会計名だけでは一意にならないため必須の識別要素） */
  subAccount?: string;
  sectionCode: string;
  sectionName: string;
  itemName: string;
  amount: number;
  provenance: Provenance;
}

/** RS事業（1-2 CSV由来）。sourceYearはRS公開年度、事業自体に固有のfiscalYearは無い */
export interface RsProject {
  projectId: string;
  projectName: string;
  sourceYear: number;
  ministry: string;
  bureau: string;
  purpose: string;
  provenance: Provenance;
}

/** RSの予算・執行イベント（2-1 CSV由来）。1事業が複数の予算年度行を持ちうるため、
 *  sourceYear（RS提出年度）とfiscalYear（その行が指す予算年度）を必ず区別する */
export interface RsBudgetEvent {
  projectId: string;
  sourceYear: number;
  fiscalYear: number;
  eventType: EventType;
  amount: number;
  provenance: Provenance;
}

/**
 * RSの歳出予算科目（2-2 CSV由来）。MOFの科目別内訳と同じ語彙（所管・組織/特別会計・勘定・項・目）
 * を持つため、derived層でMOF BudgetEntityとの完全一致キー結合に使う
 * （V1のgenerate-mof-rs-kou-moku-linkage.tsと同じ方式）。
 */
export interface RsBudgetItem {
  projectId: string;
  sourceYear: number;
  fiscalYear: number;
  /** '一般会計' | '特別会計'。政府関係機関はこのCSVに現れない */
  accountCategory: string;
  /** RS表記の予算種別（'当初予算' | '第N次補正予算' | '前年度から繰越し' | '予備費等N' 等） */
  budgetTypeRaw: string;
  ministry: string;
  /** 一般会計は「組織・勘定」、特別会計は「会計」（特別会計名） */
  organization: string;
  /** 特別会計のみ。一般会計は空文字 */
  subAccount: string;
  sectionName: string;
  itemName: string;
  amount: number;
  provenance: Provenance;
}

/** RS支出先（5-1 CSV由来） */
export interface RsExpenditure {
  projectId: string;
  sourceYear: number;
  blockId: string;
  blockName: string;
  recipientName: string;
  corporateNumber: string;
  amount: number;
  provenance: Provenance;
}

// ─────────────────────────────────────────────────────────────
// 以下、20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md に基づく
// source-preserving normalize層の型（MofBudgetEvent等の旧イベント集約型とは別系統）。
// ─────────────────────────────────────────────────────────────

/** raw原本の由来。どのZIP・どのCSVエントリ・何行目かまで追跡できる */
export interface SourceRef {
  domain: 'mof.go.jp' | 'rssystem.go.jp';
  /** raw_rootからの相対パス */
  path: string;
  file: string;
  dataset?: string;
  year?: number;
  zipEntry?: string;
  rowNumber?: number;
  sourceUrl?: string;
}

export type MofAccountType = 'general' | 'special' | 'agency';
export type MofPhase = 'initial' | 'supplement' | 'provisional' | 'settlement';
export type MofBudgetStatus = 'submitted' | 'enacted' | 'settled' | 'published';

/**
 * MOF予算・決算CSVの1行をそのまま保持するsource-preservingなレコード。
 * 金額の集約・イベント化はderived層で行う（normalized層では行わない）。
 * sectionNaturalKey（項名を含む識別子）とlegacySectionKey（項コードのみ、項名を含まない
 * 識別子。同一コードが複数の項名で再利用される場合に意図的に潰れる）を両方持ち、
 * どちらの同一性判定を使ったか比較できるようにする（仕様書8節）。
 */
export interface MofBudgetItemRecord {
  schemaVersion: number;
  recordType: 'mof_budget_item';
  recordId: string;
  fiscalYear: number;
  phase: MofPhase;
  budgetStatus: MofBudgetStatus;
  /** 補正号数。補正以外はnull */
  revision: number | null;
  accountType: MofAccountType;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
  subItemCode: string;
  subItemName: string;
  /** account系+sectionCode+sectionNameで作る識別子（項名を含む） */
  sectionNaturalKey: string;
  /** account系+sectionCodeのみで作る識別子（項名を含まない。同名衝突を意図的に許す比較用） */
  legacySectionKey: string;
  /** sectionNaturalKey + subItemCode + subItemName */
  itemNaturalKey: string;
  /** account系+sectionName+subItemName（コードを含まない）。RS側にコードが無いためlink用に使う */
  scopeNameItemKey: string;
  source: SourceRef;

  // phase別のフィールド。該当しないphaseではundefined
  /** initial/provisional: 本年度額 */
  amountYen?: number | null;
  previousAmountYen?: number | null;
  differenceYen?: number | null;
  sourceAmountColumn?: string | null;

  /** supplement */
  baseAmountYen?: number | null;
  supplementAdditionYen?: number | null;
  supplementReductionYen?: number | null;
  supplementDeltaYen?: number | null;
  revisedAmountYen?: number | null;
  /** どの列から補正の各金額を読んだか（列名は年度で揺れるため。参照実装と同じくprovenanceとして残す） */
  sourceAmountColumns?: {
    base: string | null;
    addition: string | null;
    reduction: string | null;
    delta: string | null;
    revised: string | null;
  };

  /** settlement */
  budgetAmountYen?: number | null;
  carryoverInYen?: number | null;
  reserveUseYen?: number | null;
  budgetRuleIncreaseYen?: number | null;
  reallocationYen?: number | null;
  transferAdjustmentYen?: number | null;
  currentBudgetYen?: number | null;
  spentYen?: number | null;
  carryoverOutYen?: number | null;
  unusedYen?: number | null;
}
