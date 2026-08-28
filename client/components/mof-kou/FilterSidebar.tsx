'use client';

/**
 * 項一覧の絞り込みを左サイドパネルにまとめたもの。列の値のタイプごとに操作方法を変える:
 *   - 選択肢が有限な列（予算種別・会計区分・所管・組織/特会/機関・勘定/業務）→ コンボ（select）
 *   - 文字列の列（項名）と、一覧には出ない事項・目の名前 → 正規表現トグル付きテキスト検索
 *   - 数値の列（事項数・目数・RS事業数・本年度額・前年度額・増減額・増減率）→ 範囲スライダー
 *   - 項（コード）は絞り込み対象にしない
 */

import type { MOFBudgetType } from '@/types/mof-jikou';
import type { MOFKouMokuAccountType } from '@/types/mof-kou-moku';
import { ACCOUNT_LABEL } from '@/client/components/mof-kou/columns';
import { RangeSlider } from '@/client/components/mof-kou/RangeSlider';
import { RegexTextFilter } from '@/client/components/mof-kou/RegexTextFilter';
import { formatYen } from '@/client/components/mof-jikou/format';

export type NumRange = [number | null, number | null];

export interface FilterSidebarState {
  account: 'all' | MOFKouMokuAccountType;
  budgetType: string;
  ministry: string;
  organization: string;
  subAccount: string;
  sectionNameQuery: string;
  sectionNameRegex: boolean;
  detailQuery: string;
  detailRegex: boolean;
  jikouCountRange: NumRange;
  kouMokuCountRange: NumRange;
  rsProjectCountRange: NumRange;
  amountRange: NumRange;
  previousAmountRange: NumRange;
  differenceRange: NumRange;
  rateRange: NumRange;
}

export interface FilterDomains {
  jikouCount: [number, number];
  kouMokuCount: [number, number];
  rsProjectCount: [number, number];
  amount: [number, number];
  previousAmount: [number, number];
  difference: [number, number];
  rate: [number, number];
}

interface FilterSidebarProps {
  state: FilterSidebarState;
  onChange: <K extends keyof FilterSidebarState>(key: K, value: FilterSidebarState[K]) => void;
  budgetTypes: MOFBudgetType[];
  ministries: string[];
  organizations: string[];
  subAccounts: string[];
  domains: FilterDomains;
  activeCount: number;
  onReset: () => void;
}

const selectClass = 'w-full truncate rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900';

function formatRate(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(0)}%`;
}

function formatCount(v: number): string {
  return `${Math.round(v).toLocaleString()}件`;
}

export function FilterSidebar({
  state,
  onChange,
  budgetTypes,
  ministries,
  organizations,
  subAccounts,
  domains,
  activeCount,
  onReset,
}: FilterSidebarProps) {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-neutral-700 dark:text-neutral-300">フィルタ</h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            すべて解除（{activeCount}）
          </button>
        )}
      </div>

      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-neutral-500">予算種別</span>
          <select value={state.budgetType} onChange={e => onChange('budgetType', e.target.value)} className={selectClass}>
            <option value="">すべて</option>
            {budgetTypes.map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-500">会計区分</span>
          <select
            value={state.account}
            onChange={e => {
              onChange('account', e.target.value as 'all' | MOFKouMokuAccountType);
              onChange('ministry', '');
              onChange('organization', '');
              onChange('subAccount', '');
            }}
            className={selectClass}
          >
            <option value="all">すべて</option>
            {(['general', 'special', 'agency'] as const).map(a => (
              <option key={a} value={a}>
                {ACCOUNT_LABEL[a]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-500">所管</span>
          <select
            value={state.ministry}
            onChange={e => {
              onChange('ministry', e.target.value);
              onChange('organization', '');
              onChange('subAccount', '');
            }}
            className={selectClass}
          >
            <option value="">すべて（{ministries.length}）</option>
            {ministries.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-500">組織／特会／機関</span>
          <select
            value={state.organization}
            onChange={e => {
              onChange('organization', e.target.value);
              onChange('subAccount', '');
            }}
            className={selectClass}
          >
            <option value="">すべて（{organizations.length}）</option>
            {organizations.map(o => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-neutral-500">勘定／業務</span>
          <select
            value={state.subAccount}
            onChange={e => onChange('subAccount', e.target.value)}
            disabled={subAccounts.length === 0}
            className={`${selectClass} disabled:opacity-40`}
          >
            <option value="">すべて（{subAccounts.length}）</option>
            {subAccounts.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <hr className="border-neutral-200 dark:border-neutral-800" />

        <RegexTextFilter
          label="項名"
          value={state.sectionNameQuery}
          onChange={v => onChange('sectionNameQuery', v)}
          useRegex={state.sectionNameRegex}
          onToggleRegex={v => onChange('sectionNameRegex', v)}
          placeholder="項名で検索"
        />

        <RegexTextFilter
          label="事項・目名"
          note="一覧には出ない、この項に属する事項・目の名前も対象にします"
          value={state.detailQuery}
          onChange={v => onChange('detailQuery', v)}
          useRegex={state.detailRegex}
          onToggleRegex={v => onChange('detailRegex', v)}
          placeholder="事項名・目名で検索"
        />

        <hr className="border-neutral-200 dark:border-neutral-800" />

        <RangeSlider
          label="事項数"
          domainMin={domains.jikouCount[0]}
          domainMax={domains.jikouCount[1]}
          value={state.jikouCountRange}
          onChange={v => onChange('jikouCountRange', v)}
          formatValue={formatCount}
        />
        <RangeSlider
          label="目数"
          domainMin={domains.kouMokuCount[0]}
          domainMax={domains.kouMokuCount[1]}
          value={state.kouMokuCountRange}
          onChange={v => onChange('kouMokuCountRange', v)}
          formatValue={formatCount}
        />
        <RangeSlider
          label="RS事業数"
          domainMin={domains.rsProjectCount[0]}
          domainMax={domains.rsProjectCount[1]}
          value={state.rsProjectCountRange}
          onChange={v => onChange('rsProjectCountRange', v)}
          formatValue={formatCount}
        />
        <RangeSlider
          label="本年度額"
          domainMin={domains.amount[0]}
          domainMax={domains.amount[1]}
          value={state.amountRange}
          onChange={v => onChange('amountRange', v)}
          formatValue={formatYen}
          scale="log"
        />
        <RangeSlider
          label="前年度額"
          note="決算・暫定予算等、比較対象が無い行は範囲を絞ると除外されます"
          domainMin={domains.previousAmount[0]}
          domainMax={domains.previousAmount[1]}
          value={state.previousAmountRange}
          onChange={v => onChange('previousAmountRange', v)}
          formatValue={formatYen}
          scale="log"
        />
        <RangeSlider
          label="増減額"
          note="比較対象が無い行は範囲を絞ると除外されます"
          domainMin={domains.difference[0]}
          domainMax={domains.difference[1]}
          value={state.differenceRange}
          onChange={v => onChange('differenceRange', v)}
          formatValue={formatYen}
        />
        <RangeSlider
          label="増減率"
          note="比較対象が無い・新規計上の行は範囲を絞ると除外されます"
          domainMin={domains.rate[0]}
          domainMax={domains.rate[1]}
          value={state.rateRange}
          onChange={v => onChange('rateRange', v)}
          formatValue={formatRate}
        />
      </div>
    </div>
  );
}
