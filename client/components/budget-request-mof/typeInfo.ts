import type { BudgetRequestMofType } from '@/types/budget-request-mof';

/** 差の理由の型: バッジの色と説明（読み方の手がかり。理由を確定するものではない） */
export const TYPE_INFO: Record<BudgetRequestMofType, { color: string; text: string }> = {
  事項要求: { color: 'border-fuchsia-600 text-fuchsia-700 dark:text-fuchsia-400', text: '項の中に事項要求（金額を示さない要求）がある。要求額に、金額を示していない分が含まれない' },
  組織に事項要求: { color: 'border-neutral-300 text-neutral-500 dark:border-neutral-600', text: '組織として事項要求がある（どの項分かは記載なし）' },
  要求額0: { color: 'border-amber-600 text-amber-700 dark:text-amber-400', text: '前年度に額があり要求額が 0。終了・前年度限りの経費のほか、編成で額が付く場合がある' },
  一括計上: { color: 'border-violet-600 text-violet-700 dark:text-violet-400', text: '要求では推進費などに一括して計上し、編成で各項に配分する（予算書に同じ項がない）' },
  一括計上の配分先: { color: 'border-violet-600 text-violet-700 dark:text-violet-400', text: '要求額は 0 で、一括計上した推進費から編成で配分される' },
  編成で決まる: { color: 'border-sky-600 text-sky-700 dark:text-sky-400', text: '予備費・国債費・地方交付税交付金・地方特例交付金・繰入。要求の額は仮の値で、編成で地方財政対策・金利・受け側の会計などに合わせて決まる（差は査定の結果ではない）' },
  複数書: { color: 'border-neutral-300 text-neutral-500 dark:border-neutral-600', text: '同じ項が複数の府省の要求書に同じ額で載る' },
  持ち分: { color: 'border-neutral-300 text-neutral-500 dark:border-neutral-600', text: '各書が持ち分を載せる（復興特会など）。要求額は最も大きい額（合計書）' },
  名前が近い: { color: 'border-neutral-300 text-neutral-500 dark:border-neutral-600', text: '項名がわずかに違う MOF の項に対応（表記ゆれ）' },
  改称: { color: 'border-neutral-300 text-neutral-500 dark:border-neutral-600', text: '要求の項名が予算書で変わった（原文と予算書の目で確かめた対応表。例: FY2023 のこども家庭庁）' },
  統合: { color: 'border-neutral-300 text-neutral-500 dark:border-neutral-600', text: '複数の要求の項が、予算書で 1 つの項になった。要求額は足した額' },
};

export const TYPE_ORDER: BudgetRequestMofType[] = ['事項要求', '組織に事項要求', '要求額0', '一括計上', '一括計上の配分先', '編成で決まる', '複数書', '持ち分', '名前が近い', '改称', '統合'];
