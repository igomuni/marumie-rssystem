/**
 * 会計間の繰入（内部振替）の詳細ビュー用の型定義。
 *
 * 会計名・宛先名は年度により増減するため、固定のフィールドではなく
 * 名前と金額の組の配列で持つ（新設・廃止された特別会計に型変更なしで追随するため）。
 * 捕捉ロジックは docs/mof-budget-data-guide.md 6節。
 */

import type { MOFAmountGroup } from './mof-budget-overview';

/** 繰入の1本 */
export interface MOFTransferFlow {
  /** 送り手の会計（`一般会計` または特別会計名） */
  from: string;
  /** 宛先。特別会計名を特定できたものはその名前、できないものは目名のまま */
  to: string;
  /** 予算書上の目名（`普通国債等償還財源等国債整理基金特別会計へ繰入` など） */
  label: string;
  /** 金額（円） */
  amount: number;
}

/** 特別会計1つぶんの財源内訳 */
export interface MOFAccountFunding {
  account: string;
  /** 歳入合計（円） */
  revenue: number;
  /** 他会計から受け入れた額（円） */
  transferIn: number;
  /** 自前財源（歳入 − 受入、円） */
  ownRevenue: number;
  /** 自前財源比率（0〜1） */
  ownRevenueRate: number;
  /** 款別の歳入内訳 */
  byCategory: MOFAmountGroup[];
}
