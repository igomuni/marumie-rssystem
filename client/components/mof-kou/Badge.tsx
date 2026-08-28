/**
 * 予算種別・会計区分の表示バッジ。`/sankey-svg` の会計区分バッジ（app/lib/account-badge.ts）
 * と同じ見た目（小さな色付きピル・白文字）に揃える。会計区分は同じヘルパーをそのまま使い、
 * 予算種別（当初/暫定/補正N号/決算）はMOF予算書ページ固有のため、ここで色分けを定義する。
 *
 * 予算種別の配色はGitHub Primerの状態色（bgColor-*-emphasis, light theme。
 * 当初=open/success #1f883d、暫定=attention #9a6700、補正=severe #bc4c00、決算=done #8250df。
 * https://unpkg.com/@primer/primitives/dist/css/functional/themes/light.css）の色相を保ったまま、
 * バッジが小さく彩度が強く出過ぎるため、会計区分バッジ（彩度55〜75%・明度58〜64%）に
 * 合わせて彩度・明度を落としている。
 */

import { getAccountBadgeStyle } from '@/app/lib/account-badge';
import type { MOFBudgetType } from '@/types/mof-jikou';
import type { MOFKouMokuAccountType } from '@/types/mof-kou-moku';

export function Badge({ label, background }: { label: string; background: string }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-snug text-white"
      style={{ background }}
    >
      {label}
    </span>
  );
}

/** 会計区分バッジ（一般/特別/機関）。sankey-svg・subcontractsと同じ配色 */
export function AccountBadge({ accountType }: { accountType: MOFKouMokuAccountType }) {
  const style = getAccountBadgeStyle(accountType);
  if (!style) return null;
  return <Badge label={style.label} background={style.background} />;
}

/** 補正予算（第N号）→「補正N」の短縮ラベル。それ以外はそのまま */
function budgetTypeLabel(budgetType: MOFBudgetType): string {
  const revised = /^補正予算（第(\d+)号）$/.exec(budgetType);
  return revised ? `補正${revised[1]}` : budgetType.replace(/予算$/, '');
}

const BUDGET_TYPE_COLOR: Record<string, string> = {
  当初: '#2ba14c',
  暫定: '#b48822',
  決算: '#7b4bd2',
};
const REVISED_COLOR = '#c15e25';

/** 予算種別バッジ（当初/暫定/補正N/決算）。補正は号数に関わらず同色 */
export function BudgetTypeBadge({ budgetType }: { budgetType: MOFBudgetType }) {
  const label = budgetTypeLabel(budgetType);
  const background = BUDGET_TYPE_COLOR[label] ?? (label.startsWith('補正') ? REVISED_COLOR : BUDGET_TYPE_COLOR.当初);
  return <Badge label={label} background={background} />;
}
