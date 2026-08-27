/**
 * MOF事項 ↔ RS事業 紐づけデータの型定義。
 *
 * 事項と事業を直結する公式キーは存在しない（MOFは事項にIDを振っていない）。
 * 紐づけは判定方法つきのレコードとして管理し、自動判定（生成スクリプト）と
 * 手動判定（public/data/dictionaries/mof-rs-linkage-overrides.csv）を分離する。
 * 生成: scripts/generate-mof-rs-linkage.ts
 */

/** 紐づけの確度 */
export type MofRsLinkageStatus = 'confirmed' | 'candidate';

/** 紐づけの判定方法 */
export type MofRsLinkageMethod =
  /** 手動確定（overrides.csv） */
  | 'manual'
  /** 構造キー（所管×組織×項）一致 かつ 事業名==事項名 */
  | 'exact-name'
  /**
   * 構造キー（所管×組織×項）内の事項が1件だけ。
   * MOFの一般会計歳出は100%が何らかの事項に属する（分割に漏れがない）ため、
   * 項に事項が1件しかなければ、その項に計上されたRS事業は名前の一致・不一致に関わらず
   * 構造的にその事項に属する。名前照合ではなく会計構造上の必然による確定。
   * 詳細: docs/tasks/20260826_0809_項の単独事項構造による紐づけ拡張の調査.md
   */
  | 'section-unique'
  /** 構造キー一致 かつ 事項名の語幹（「〜に必要な経費」除去）が事業名に包含 */
  | 'stem-in-name'
  /** 構造キー不一致だが同一所管内で事業名==事項名 */
  | 'exact-name-cross-section';

/** 紐づけ1件（事業×事項のペア。N対Nなので同じ事業・同じ事項が複数レコードに現れうる） */
export interface MofRsLinkageRecord {
  projectId: number;
  projectName: string;
  /** RS 1-1 の府省庁（外局は独立表記。MOF所管とは粒度が違う） */
  projectMinistry: string;
  /** 事項の年度横断識別子（予算種別を含まない8要素連結） */
  jikouIdentity: string;
  /** 事項の完全キー（予算種別込み。mof-jikou-{年度}.json の items[].key と同じ） */
  jikouKey: string;
  jikouName: string;
  mofMinistry: string;
  mofOrganization: string;
  sectionCode: string;
  sectionName: string;
  status: MofRsLinkageStatus;
  method: MofRsLinkageMethod;
  /** 構造キー（所管×組織×項）が一致したペアか */
  structMatched: boolean;
  /** 事項の当初予算額（円） */
  jikouAmount: number;
  /** 当該事業の一般会計・当初予算額（円）。構造キー一致の場合はそのキー内の合計 */
  rsAmount: number;
  /** 手動判定のメモ（自動判定では空） */
  note: string;
}

/** 出力 JSON 全体 */
export interface MofRsLinkageData {
  metadata: {
    /** 予算年度 = MOF会計年度（西暦） */
    budgetYear: number;
    /** RS事業年度（シート年度） */
    rsYear: number;
    mofEraLabel: string;
    /** 突合範囲（現状は一般会計・当初予算のみ） */
    scope: string;
    unit: 'yen';
    generatedAt: string;
    counts: {
      links: number;
      byStatus: Record<string, number>;
      byMethod: Record<string, number>;
      /** 突合範囲内のMOF事項総数 */
      jikouTotal: number;
      /** 1件以上の事業に紐づいた事項数 */
      jikouLinked: number;
      /** 突合範囲内のRS事業総数 */
      projectTotal: number;
      /** 1件以上の事項に紐づいた事業数 */
      projectLinked: number;
      /** confirmed の紐づけを持つ事業数 */
      projectConfirmed: number;
    };
    coverage: {
      /** 突合範囲内のRS予算総額（円） */
      rsAmountTotal: number;
      /** 紐づいた事業の予算額合計（円） */
      rsAmountLinked: number;
      /** confirmed の紐づけを持つ事業の予算額合計（円） */
      rsAmountConfirmed: number;
    };
    notes: string[];
  };
  links: MofRsLinkageRecord[];
}
