'use client';

/**
 * 目一覧の絞り込みを左サイドパネルにまとめたもの。`/mof-kou`（項一覧）・`/mof-jikou`
 * （事項一覧）の FilterSidebar と同じ構成・挙動に揃える。目だけが持つ「使途別分類」
 * （予定経費要求書の科目別内訳の各目に付したコード番号の1桁目。人件費・旅費・物件費・
 * 施設費・補助費及委託費・他会計へ繰入・その他）もここで絞り込める。
 */

import { useState } from 'react';
import type { MOFBudgetType } from '@/types/mof-jikou';
import { ACCOUNT_LABEL } from '@/client/components/mof-kou-moku/columns';
import { MultiSelectCombo } from '@/client/components/mof-kou/MultiSelectCombo';
import { RangeSlider } from '@/client/components/mof-kou/RangeSlider';
import { RegexTextFilter } from '@/client/components/mof-kou/RegexTextFilter';
import { formatYen } from '@/client/components/mof-jikou/format';

type ComboField = 'budgetType' | 'account' | 'ministry' | 'organization' | 'subAccount' | 'majorExpense' | 'purpose';

export type NumRange = [number | null, number | null];

const ACCOUNT_OPTIONS = [ACCOUNT_LABEL.general, ACCOUNT_LABEL.special, ACCOUNT_LABEL.agency];

export interface FilterSidebarState {
  account: string[];
  budgetType: string[];
  ministry: string[];
  organization: string[];
  subAccount: string[];
  majorExpense: string[];
  purpose: string[];
  nameQuery: string;
  nameRegex: boolean;
  amountRange: NumRange;
  previousAmountRange: NumRange;
  differenceRange: NumRange;
  rateRange: NumRange;
}

export interface FilterDomains {
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
  majorExpenses: string[];
  purposes: string[];
  domains: FilterDomains;
  activeCount: number;
  onReset: () => void;
  width: number;
}

function formatRate(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(0)}%`;
}

/** 上位の選択がまだ有効な選択肢だけに絞る（無効化されたものは黙って落とす） */
function pruneToOptions(selected: string[], options: string[]): string[] {
  if (selected.length === 0) return selected;
  const next = selected.filter(s => options.includes(s));
  return next.length === selected.length ? selected : next;
}

export function FilterSidebar({
  state,
  onChange,
  budgetTypes,
  ministries,
  organizations,
  subAccounts,
  majorExpenses,
  purposes,
  domains,
  activeCount,
  onReset,
  width,
}: FilterSidebarProps) {
  const [openField, setOpenField] = useState<ComboField | null>(null);
  const comboProps = (field: ComboField) => ({
    open: openField === field,
    onOpenChange: (v: boolean) => setOpenField(v ? field : null),
  });

  return (
    <div
      className="flex h-full shrink-0 flex-col overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950"
      style={{ width }}
    >
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
        <div className="block space-y-1">
          <span className="text-neutral-500">予算種別</span>
          <MultiSelectCombo
            label="予算種別"
            options={budgetTypes}
            selected={state.budgetType}
            onChange={v => onChange('budgetType', v)}
            {...comboProps('budgetType')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">会計区分</span>
          <MultiSelectCombo
            label="会計区分"
            options={ACCOUNT_OPTIONS}
            selected={state.account}
            onChange={v => {
              onChange('account', v);
              onChange('ministry', pruneToOptions(state.ministry, ministries));
              onChange('organization', pruneToOptions(state.organization, organizations));
              onChange('subAccount', pruneToOptions(state.subAccount, subAccounts));
              onChange('majorExpense', pruneToOptions(state.majorExpense, majorExpenses));
            }}
            {...comboProps('account')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">所管</span>
          <MultiSelectCombo
            label="所管"
            options={ministries}
            selected={state.ministry}
            onChange={v => {
              onChange('ministry', v);
              onChange('organization', pruneToOptions(state.organization, organizations));
              onChange('subAccount', pruneToOptions(state.subAccount, subAccounts));
              onChange('majorExpense', pruneToOptions(state.majorExpense, majorExpenses));
            }}
            {...comboProps('ministry')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">組織／特会／機関</span>
          <MultiSelectCombo
            label="組織／特会／機関"
            options={organizations}
            selected={state.organization}
            onChange={v => {
              onChange('organization', v);
              onChange('subAccount', pruneToOptions(state.subAccount, subAccounts));
              onChange('majorExpense', pruneToOptions(state.majorExpense, majorExpenses));
            }}
            {...comboProps('organization')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">勘定／業務</span>
          <MultiSelectCombo
            label="勘定／業務"
            options={subAccounts}
            selected={state.subAccount}
            onChange={v => {
              onChange('subAccount', v);
              onChange('majorExpense', pruneToOptions(state.majorExpense, majorExpenses));
            }}
            disabled={subAccounts.length === 0}
            {...comboProps('subAccount')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">主要経費</span>
          <MultiSelectCombo
            label="主要経費"
            options={majorExpenses}
            selected={state.majorExpense}
            onChange={v => onChange('majorExpense', v)}
            disabled={majorExpenses.length === 0}
            {...comboProps('majorExpense')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500" title="予定経費要求書の科目別内訳の各目に付したコード番号の読み方に基づく分類">
            使途別
          </span>
          <MultiSelectCombo
            label="使途別"
            options={purposes}
            selected={state.purpose}
            onChange={v => onChange('purpose', v)}
            disabled={purposes.length === 0}
            {...comboProps('purpose')}
          />
        </div>

        <hr className="border-neutral-200 dark:border-neutral-800" />

        <RegexTextFilter
          label="項名・目名"
          value={state.nameQuery}
          onChange={v => onChange('nameQuery', v)}
          useRegex={state.nameRegex}
          onToggleRegex={v => onChange('nameRegex', v)}
        />

        <hr className="border-neutral-200 dark:border-neutral-800" />

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
