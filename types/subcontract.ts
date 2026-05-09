export interface RecipientExpense {
  category: string;
  purpose: string;
  amount: number;
}

export interface BlockRecipient {
  name: string;
  corporateNumber: string;
  amount: number;
  contractSummaries: string[];
  expenses: RecipientExpense[];
}

export type BlockOriginKind =
  | 'direct'
  | 'subcontract'
  | 'separate-origin-broad'
  | 'separate-origin-strong';

export interface BlockNode {
  blockId: string;
  blockName: string;
  totalAmount: number;
  /** 担当組織からの直接支出ブロックか（既存互換のため残す。`originKind === 'direct'` と等価） */
  isDirect: boolean;
  /** 起点種別（5-2 のグラフ構造から判定） */
  originKind: BlockOriginKind;
  /** 下流ブロックを持たないリーフ */
  isTerminal: boolean;
  recipientCount: number;
  hasExpenses: boolean;
  role?: string;
  recipients: BlockRecipient[];
}

export type FlowOrigin =
  | 'direct'
  | 'transfer'
  | 'separate-origin'
  | 'subcontract'
  | 'reference';

export interface BlockEdge {
  sourceBlock: string | null;
  targetBlock: string;
  note?: string;
  origin: FlowOrigin;
  /** `参考` を補足情報に含むフロー */
  isReference: boolean;
  /** target ブロックに流入する支出元ブロック数（合流の太さ） */
  targetIncomingBlockCount: number;
}

export interface IndirectCost {
  /** 旧 `支出元の支出先ブロック名` 等の参考表記 */
  blockHint: string;
  /** 「国自らが支出する間接経費」列の分類テキスト（`間接経費` `職員旅費` `事務費` など） */
  kind: string;
  /** 国自らが支出する間接経費の項目 */
  category: string;
  amount: number;
  note?: string;
}

export interface SubcontractGraph {
  projectId: number;
  projectName: string;
  ministry: string;
  budget: number;
  execution: number;
  blocks: BlockNode[];
  flows: BlockEdge[];
  maxDepth: number;
  directBlockCount: number;
  totalBlockCount: number;
  totalRecipientCount: number;
  indirectCosts: IndirectCost[];
  /** 別起点ブロック（広め）が1つ以上あるか */
  hasSeparateOrigin: boolean;
  separateOriginCount: number;
  strongSeparateOriginCount: number;
  separateOriginAmount: number;
  hasMerge: boolean;
  mergeTargetCount: number;
  maxMergeWidth: number;
  /** 1ブロックから複数下流ブロックを持つ「分岐元」の件数 */
  branchingBlockCount: number;
  /** 1ブロックから出る最大分岐幅 */
  maxBranchWidth: number;
  hasReferenceFlow: boolean;
  /** 全ブロックが totalAmount=0 かつ recipients=0 の制度フロー */
  isInstitutionalFlowOnly: boolean;
}

export type SubcontractIndex = Record<string, SubcontractGraph>;
