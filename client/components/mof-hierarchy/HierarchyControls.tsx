'use client';

/**
 * 階層サンキーのコントロール（予算種別・TopN）。
 *
 * 年度とページ切替は全ページ共通で右上に置くので、ここには含めない。
 * データ取得はページ層の責務なので、ここでは選択の通知だけを行う。
 */

import { DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';
import type { MOFHierarchyTopN } from '@/types/mof-hierarchy';
import type { MOFBudgetType } from '@/types/mof-jikou';

const SELECT_CLASS =
  'h-8 cursor-pointer rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** TopN の選択肢。多すぎるとラベルが潰れるので上限を設ける */
const TOP_N_OPTIONS = [5, 8, 12, 16, 20, 30, 40];

export function HierarchyControls({
  budgetType,
  budgetTypes,
  topN,
  disabled,
  onBudgetTypeChange,
  onTopNChange,
  summary,
  focusRelated,
  onFocusRelatedChange,
}: {
  budgetType: MOFBudgetType;
  budgetTypes: MOFBudgetType[];
  topN: MOFHierarchyTopN;
  disabled?: boolean;
  onBudgetTypeChange: (value: MOFBudgetType) => void;
  onTopNChange: (next: MOFHierarchyTopN) => void;
  /** 図の外に出す補足（事項数・会計区分の内訳） */
  summary?: string;
  focusRelated: boolean;
  onFocusRelatedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-600">
      <label className="flex items-center gap-2">
        <span className="font-medium">予算種別</span>
        <select
          value={budgetType}
          disabled={disabled}
          onChange={e => onBudgetTypeChange(e.target.value as MOFBudgetType)}
          className={SELECT_CLASS}
        >
          {budgetTypes.map(type => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="font-medium">項の表示数</span>
        <select
          value={topN.section ?? DEFAULT_TOP_N.section}
          disabled={disabled}
          onChange={e => onTopNChange({ ...topN, section: Number(e.target.value) })}
          className={SELECT_CLASS}
        >
          {TOP_N_OPTIONS.map(n => (
            <option key={n} value={n}>
              上位{n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="font-medium">事項の表示数</span>
        <select
          value={topN.item ?? DEFAULT_TOP_N.item}
          disabled={disabled}
          onChange={e => onTopNChange({ ...topN, item: Number(e.target.value) })}
          className={SELECT_CLASS}
        >
          {TOP_N_OPTIONS.map(n => (
            <option key={n} value={n}>
              上位{n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={focusRelated}
          onChange={e => onFocusRelatedChange(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer"
        />
        <span>選択時に関連のみ表示</span>
      </label>

      <span className="text-gray-400">溢れた分は「その他」にまとまります</span>
      {summary && <span className="w-full text-[11px] text-gray-500">{summary}</span>}
    </div>
  );
}
