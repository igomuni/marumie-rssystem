/**
 * 政策評価スクリーニングの共有コントラクト。
 *
 * `PolicyQualityInput` は API 層（品質スコアJSON）→ ドメインロジック（app/lib）を、
 * `PolicyEvaluation` はドメインロジック → /api/policy-summary・project-map パイプライン →
 * UI をまたぐ。層をまたぐ型は types/ に置く（CLAUDE.md の Layer Design Rules）。
 *
 * 各軸の意味と設計上の約束は app/lib/policy-evaluation.ts の冒頭に書いてある。
 */

export type PolicyRecommendationTone = 'green' | 'blue' | 'amber' | 'red';

/** 品質スコア側の入力（全事業）。AI採点の結果は同じJSONに同居している */
export interface PolicyQualityInput {
  pid: string;
  budgetAmount: number;
  execAmount: number;
  axisIdentify?: number | null;
  axisPurpose?: number | null;
  axisBudget?: number | null;
  redelegationDepth?: number;
  orphanBlockCount?: number;
  /** 不透明キーワードにマッチする支出先への支出比率 0-1 */
  opaqueRatio?: number | null;
  /** 前年度の執行率。無い事業は null＝判定不能。欠測は不利に扱わない */
  priorExecutionRate?: number | null;

  // ── AI段階採点（0-10） ──
  /** 成果設計の明確さ */
  designClarity?: number | null;
  /** 成果の検証可能性 */
  evidenceReadiness?: number | null;
  /** 費用対内容（金額の見合い＋支出先の妥当性） */
  budgetProportionality?: number | null;
  /** 必要性（廃止したら誰が困るか） */
  necessity?: number | null;
  /** 政策類型の id */
  policyCategory?: string | null;
  /** 軸ごとの判定理由 */
  policyFindings?: { design?: string; evidence?: string; proportionality?: string; necessity?: string } | null;
}

/**
 * 不用の傾向。単年度の不用率だけでは「入札差金でたまたま余った年」と
 * 「毎年構造的に余っている事業」が区別できないため、前年度と突き合わせて分類する。
 */
export type UnusedTrend = 'persistent' | 'single' | 'unknown' | 'normal';

/** 事業1件の政策評価結果 */
export interface PolicyEvaluation {
  pid: string;
  /** 政策類型の id。未分類は null */
  policyCategory: string | null;
  /** 政策類型の表示名 */
  policyCategoryLabel: string | null;

  // ── 5軸（0-100に正規化） ──
  designClarityScore: number | null;
  evidenceScore: number | null;
  executionTransparency: number | null;
  proportionalityScore: number | null;
  necessityScore: number | null;

  // ── AI の生値（0-10）。詳細表示と閾値判定に使う ──
  designClarity: number | null;
  evidenceReadiness: number | null;
  budgetProportionality: number | null;
  necessity: number | null;

  /** 総合点（0-100） */
  overallScore: number | null;
  /** 総合点の母集団内パーセンタイル（0=最下位）。スクリーニングの帯はこれで切る */
  overallPercentile: number | null;

  // ── 予算と執行（総合点に不算入・縮小判定にのみ使う） ──
  unusedRatio: number | null;
  unusedAmount: number | null;
  executionRate: number | null;
  /** 前年度の執行率。実績が無い事業は null＝判定不能 */
  priorExecutionRate: number | null;
  priorUnusedRatio: number | null;
  unusedTrend: UnusedTrend;
  /** 予算をほぼ使い切っているが支出先が不透明＝消化的執行の疑い */
  spendDownRisk: boolean;

  recommendation: string | null;
  recommendationTone: PolicyRecommendationTone | null;
  recommendationReason: string | null;
  improvementAction: string | null;

  /** 軸ごとの判定理由 */
  findings: { design: string; evidence: string; proportionality: string; necessity: string };
  identifiability: number | null;
  purposeExplainability: number | null;
  budgetConsistency: number | null;
  provisionalReason: string;
}
