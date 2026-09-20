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

/** derive-mof.tsが生成するMOFの金額イベント（旧MofBudgetEventとは別系統。budget-items.jsonlのrecordId単位） */
export interface MofDerivedBudgetEvent {
  schemaVersion: number;
  recordType: 'budget_event';
  eventId: string;
  sourceSystem: 'mof';
  fiscalYear: number;
  eventType: string;
  amountYen: number;
  accountType: MofAccountType;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
  subItemName: string;
  sourceRecordIds: string[];
  source: SourceRef;
  budgetStatus?: MofBudgetStatus;
  revision?: number | null;
  baseAmountYen?: number;
  resultingAmountYen?: number;
  submittedAmountYen?: number;
  enactedAmountYen?: number;
  evidenceMethod?: string;
}

/**
 * 項（section）単位に金額イベントを集約したderived成果物。
 * `initialYen`は成立額があれば成立額、無ければ提出額（両方を足し合わせない＝別スナップショット）。
 * `unresolvedPreSettlementDeltaYen`は「補正後予算(initialYen+supplementDeltaYen)」と
 * 「決算書の歳出予算額(settlementBudgetYen)」の差。0でなければ実際に起きた変化のevidenceだが、
 * 移替・予備費等どの理由かは公式の対応表が無い限り断定しない（PID:4相当のFY2024
 * デジタル庁「情報通信技術調達等適正・効率化推進費」で-509,690,849,950円を再現することを
 * 実装のacceptanceにしている）。
 */
export interface MofDerivedSection {
  id: string;
  fiscalYear: number;
  accountType: MofAccountType;
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
  sectionCode: string;
  sectionName: string;
  itemCount: number;
  eventCount: number;
  stages: string[];
  initialSubmittedYen?: number;
  initialEnactedYen?: number;
  initialYen?: number;
  supplementDeltaYen?: number;
  settlementBudgetYen?: number;
  currentBudgetYen?: number;
  spentYen?: number;
  carryoverOutYen?: number;
  unusedYen?: number;
  unresolvedPreSettlementDeltaYen?: number;
}

export interface MofStageGap {
  sectionId: string;
  fiscalYear: number;
  sectionName: string;
  from: 'post_supplement_budget';
  to: 'settlement_budget_appropriation';
  deltaYen: number;
  classification: 'unresolved';
  note: string;
}

/** 段階間（提出→成立、当初→補正→決算）の項目同一性の根拠関係 */
export interface MofIdentityRelation {
  schemaVersion: number;
  recordType: 'budget_item_relation';
  relationId: string;
  sourceStage: string;
  targetStage: string;
  relationType: 'same_item' | 'code_changed';
  evidenceMethod: 'exact-key' | 'same-scope-same-name';
  sourceRecordIds: string[];
  targetRecordIds: string[];
}

// ─────────────────────────────────────────────────────────────
// 以下、RS全15CSV対応のsource-preserving normalize層（既存RsProject等の簡易版とは別系統）。
// 20260920_Pipeline_V2_MOF_RS統合_publicまで_最終仕様.md 6節。
// ─────────────────────────────────────────────────────────────

import type { RsBaseFields } from './lib/rs-common';

export interface RsOrganizationRelation extends RsBaseFields {
  recordType: 'rs_organization_relation';
  recordId: string;
  additionalOrganizationNo: string;
  additionalMinistry: string;
  additionalBureau: string;
  additionalDepartment: string;
  additionalDivision: string;
  additionalOffice: string;
  additionalTeam: string;
  additionalUnit: string;
  responsiblePerson: string;
  extraFields: Record<string, string>;
  source: SourceRef;
}

/** 1-2「実施方法」列（1-2 CSVは1固定 or 空欄のフラグ列）。将来別表記が来ても値を失わないよう
 *  boolean化できなければ原本文字列を保持する（boolOrRaw） */
export interface RsImplementationMethods {
  direct: boolean | string | null;
  subsidy: boolean | string | null;
  burden: boolean | string | null;
  grant: boolean | string | null;
  contribution: boolean | string | null;
  other: string | null;
}

export interface RsProjectSourceRow extends RsBaseFields {
  recordType: 'rs_project_source_row';
  recordId: string;
  purpose: string;
  currentIssues: string;
  overview: string;
  overviewUrl: string;
  projectCategory: string;
  startYear: number | null;
  startYearUnknown: boolean | null;
  endYear: number | null;
  endYearRaw: string;
  noPlannedEnd: boolean | null;
  majorExpense: string;
  note: string;
  implementationMethods: RsImplementationMethods;
  legacyProjectNumber: string;
  displayOrderRaw: string;
  extraFields: Record<string, string>;
  source: SourceRef;
}

/** 列単位の突合監査（source inventory）。将来の列追加・リネームをmanifestで検知できるようにする */
export interface SourceInventoryColumn {
  column: string;
  nonEmptyCount: number;
  status: 'mapped' | 'extra_preserved' | 'empty_unmapped';
}

export interface SourceInventory {
  datasetCode: string;
  datasetName: string;
  sourceYear: number;
  path: string;
  zipEntry: string;
  rowCount: number;
  columnCount: number;
  headerSha256: string;
  columns: SourceInventoryColumn[];
}

/** RS予算・執行の会計区分。原本値が空なら空文字のまま（決め打ちしない） */
export type RsAccountType = 'general' | 'special' | 'other' | '';

/** RS予算イベント種別。予備費等はneutralな'adjustment'とし、決算のreserveと混同しない
 *  （予備費「等」であり予算総則増額等も含みうるため。RS側に所管/組織/項/目が無く
 *  MOFの何に対応するか特定できないという事情もある） */
export type RsEventType = 'initial' | 'supplementary' | 'carryover_in' | 'adjustment' | 'current_budget' | 'execution' | 'carryover_out' | 'request' | 'request_preference';

export interface RsBudgetSummaryRecord extends RsBaseFields {
  recordType: 'rs_budget_summary';
  recordId: string;
  fiscalYear: number | null;
  scopeLevel: 'account' | 'project_total';
  accountType: RsAccountType;
  accountClass: string;
  account: string;
  subAccount: string;
  executionRateRaw: string;
  changeReason: string;
  specialNotes: string;
  note: string;
  amounts: Record<string, number | null>;
  extraFields: Record<string, string>;
  source: SourceRef;
}

export interface RsBudgetEventRecord extends RsBaseFields {
  recordType: 'rs_budget_event';
  eventId: string;
  sourceRecordId: string;
  fiscalYear: number | null;
  sourceFiscalYear: number | null;
  eventType: RsEventType;
  revision: number | null;
  amountYen: number;
  amountRaw: string;
  sourceAmountColumn: string;
  scopeLevel: 'account' | 'project_total';
  accountType: RsAccountType;
  accountClass: string;
  account: string;
  subAccount: string;
  /** 予備費等等、原典の性質上MOF側イベント種別に断定できないものは'source_neutral' */
  semanticStatus: 'source_neutral' | 'source_labeled';
  source: SourceRef;
}

export interface RsBudgetItemRecordV2 extends RsBaseFields {
  recordType: 'rs_budget_item';
  recordId: string;
  fiscalYear: number | null;
  accountType: RsAccountType;
  accountClass: string;
  account: string;
  subAccount: string;
  budgetType: string;
  /** 2-2 CSVの「所管」列。MOFの科目別内訳と同じ語彙で、MOF突合（mofNameNaturalKey）に使う。
   *  RsBaseFields.ministry（共通列「府省庁」）とは別物で、実データでは相当数の行が異なるため
   *  どちらも原本のまま保持する（source-preserving。2026-09-20: 所管による上書きを撤回） */
  budgetMinistry: string;
  organizationOrAccount: string;
  sectionName: string;
  subItemName: string;
  supplementalInfo: string;
  budgetAmountYen: number | null;
  budgetAmountRaw: string;
  nextYearRequestYen: number | null;
  nextYearRequestRaw: string;
  requestFiscalYear: number | null;
  note: string;
  /** MOFの科目別内訳と同じ語彙で作る識別子（accountType+ministry+組織/勘定+項+目）。MOF↔RSリンクに使う */
  mofNameNaturalKey: string;
  extraFields: Record<string, string>;
  source: SourceRef;
}

export interface RsSpendingBlockRecord extends RsBaseFields {
  recordType: 'rs_spending_block';
  nodeId: string;
  blockId: string;
  blockName: string;
  blockNames: string[];
  recipientCountValues: number[];
  roles: string[];
  totalAmountValuesYen: number[];
  evidenceRowIds: string[];
  sources: SourceRef[];
  summaryRowCount: number;
  /** 複数行にまたがるブロックのため、競合する値は配列でユニーク化して保持する（参照実装と同じ） */
  extraFields: Record<string, string[]>;
}

export interface RsRecipientRecord extends RsBaseFields {
  recordType: 'rs_recipient';
  recipientId: string;
  blockId: string;
  recipientName: string;
  corporateNumber: string;
  location: string;
  corporateType: string;
  otherRecipient: boolean | null;
  totalAmountValuesYen: number[];
  evidenceRowIds: string[];
  sources: SourceRef[];
  /** 参照実装と同じく、支出先行はマップ済み列で構成が完結するため常に空 */
  extraFields: Record<string, string>;
}

export interface RsContractRecord extends RsBaseFields {
  recordType: 'rs_contract';
  contractId: string;
  blockId: string;
  recipientId: string | null;
  recipientLinkMethod: 'same-row' | 'preceding-row' | null;
  recipientNameRaw: string;
  corporateNumberRaw: string;
  summary: string;
  amountYen: number | null;
  amountRaw: string;
  method: string;
  methodDetail: string;
  bidderCount: number | null;
  winningRate: number | null;
  singleBidReason: string;
  otherContract: boolean | null;
  sourceRowId: string;
  extraFields: Record<string, string>;
  source: SourceRef;
}

/**
 * RS5-2「支出ブロックのつながり」1行＝1辺。一般有向グラフとして扱う
 * （tree/DAG/single-rootを前提にしない。重複辺・循環・多始点・孤立ブロックをすべて許容し、
 * normalize層では何も削除・統合しない）。
 */
export interface RsFundingRelationRecord extends RsBaseFields {
  recordType: 'rs_funding_relation';
  relationId: string;
  sourceBlockId: string | null;
  sourceBlockName: string;
  /** 「担当組織からの支出」。事業を実施する組織自身からの支出かどうか（parse_bool、判定不能ならnull） */
  fromResponsibleOrganization: boolean | null;
  targetBlockId: string;
  targetBlockName: string;
  note: string;
  sourceRowId: string;
  extraFields: Record<string, string>;
  source: SourceRef;
}

export interface RsIndirectExpenseRecord extends RsBaseFields {
  recordType: 'rs_indirect_expense';
  expenseId: string;
  categoryRaw: string;
  item: string;
  amountYen: number | null;
  amountRaw: string;
  sourceRowId: string;
  extraFields: Record<string, string>;
  source: SourceRef;
}
