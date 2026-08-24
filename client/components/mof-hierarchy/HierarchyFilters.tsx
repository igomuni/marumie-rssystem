'use client';

/**
 * 絞り込みパネル。
 *
 * /sankey-svg のフィルタパネル（会計・省庁・事業名/支出先名・予算額の範囲）と
 * 同じ発想の条件セットを、mof-hierarchy の列に合わせて置き換えている
 * （事業名→事項名、支出先名→項名、省庁→所管はそのまま）。
 *
 * 実際の絞り込みはサーバ側（filterMOFJikouItems）で行う。ここは状態の
 * 入力と、検索ボックスと同じ場所への表示だけを持つ。
 */

import { useEffect, useRef, useState } from 'react';
import type { MOFAccountType } from '@/types/mof-jikou';
import {
  MOF_HIERARCHY_FILTER_DEFAULT,
  hasActiveMOFHierarchyFilterState,
  type MOFHierarchyFilterState,
} from '@/types/mof-hierarchy';

const ACCOUNT_OPTIONS: Array<{ value: MOFAccountType; label: string }> = [
  { value: 'general', label: '一般会計' },
  { value: 'special', label: '特別会計' },
  { value: 'agency', label: '政府関係機関' },
];

const INPUT_CLASS =
  'h-7 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function HierarchyFilters({
  filter,
  onFilterChange,
  ministryOptions,
}: {
  filter: MOFHierarchyFilterState;
  onFilterChange: (next: MOFHierarchyFilterState) => void;
  /** 所管の選択肢。TopN前の全件（browse）から作るので、絞り込み中でも全省庁を出せる */
  ministryOptions: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = hasActiveMOFHierarchyFilterState(filter);

  // 外側を押したら閉じる。開いたままだと図のクリックを奪う
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = (patch: Partial<MOFHierarchyFilterState>) => onFilterChange({ ...filter, ...patch });
  const toggleAccount = (value: MOFAccountType) =>
    set({
      accountTypes: filter.accountTypes.includes(value)
        ? filter.accountTypes.filter(a => a !== value)
        : [...filter.accountTypes, value],
    });
  const toggleMinistry = (name: string) =>
    set({
      ministries: filter.ministries.includes(name)
        ? filter.ministries.filter(m => m !== name)
        : [...filter.ministries, name],
    });

  return (
    <div ref={rootRef} className="relative shrink-0" data-pan-disabled="true">
      <button
        type="button"
        title={open ? 'フィルタを隠す' : 'フィルタを表示'}
        aria-label={open ? 'フィルタを隠す' : 'フィルタを表示'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg border bg-white/90 shadow-md backdrop-blur hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          active ? 'border-blue-400 text-blue-600' : 'border-black/10 text-gray-500'
        }`}
      >
        {/* Material Icons: filter_alt */}
        <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 18h4v-2h-4v2ZM3 6v2h18V6H3Zm3 7h12v-2H6v2Z" />
        </svg>
        {active && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex flex-col gap-3 text-xs text-gray-600">
            {/* 会計区分 */}
            <div>
              <div className="mb-1 font-medium">会計</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {ACCOUNT_OPTIONS.map(({ value, label }) => (
                  <label key={value} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={filter.accountTypes.includes(value)}
                      onChange={() => toggleAccount(value)}
                      className="h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 所管（複数選択） */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">所管</span>
                {filter.ministries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => set({ ministries: [] })}
                    className="text-[11px] text-gray-400 hover:text-gray-600"
                  >
                    クリア
                  </button>
                )}
              </div>
              <div className="max-h-32 overflow-y-auto rounded border border-gray-200">
                {ministryOptions.map(name => (
                  <label
                    key={name}
                    className="flex cursor-pointer items-center gap-1.5 px-2 py-1 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={filter.ministries.includes(name)}
                      onChange={() => toggleMinistry(name)}
                      className="h-3.5 w-3.5 cursor-pointer"
                    />
                    <span className="truncate">{name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 項名・事項名 */}
            {(
              [
                { key: 'section', label: '項', query: filter.sectionQuery, regex: filter.sectionRegex },
                { key: 'item', label: '事項', query: filter.itemQuery, regex: filter.itemRegex },
              ] as const
            ).map(({ key, label, query, regex }) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">{label}名</span>
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-gray-400">
                    <input
                      type="checkbox"
                      checked={regex}
                      onChange={() =>
                        set(
                          key === 'section'
                            ? { sectionRegex: !filter.sectionRegex }
                            : { itemRegex: !filter.itemRegex }
                        )
                      }
                      className="h-3 w-3 cursor-pointer"
                    />
                    正規表現
                  </label>
                </div>
                <input
                  type="text"
                  value={query}
                  onChange={e =>
                    set(key === 'section' ? { sectionQuery: e.target.value } : { itemQuery: e.target.value })
                  }
                  placeholder={regex ? '正規表現' : '部分一致'}
                  className={INPUT_CLASS}
                />
              </div>
            ))}

            {/* 金額の範囲 */}
            <div>
              <div className="mb-1 font-medium">事項の金額</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={filter.minAmountText}
                  onChange={e => set({ minAmountText: e.target.value })}
                  placeholder="例: 100億"
                  className={INPUT_CLASS}
                />
                <span className="shrink-0 text-gray-400">〜</span>
                <input
                  type="text"
                  value={filter.maxAmountText}
                  onChange={e => set({ maxAmountText: e.target.value })}
                  placeholder="例: 1兆"
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            {active && (
              <button
                type="button"
                onClick={() => onFilterChange(MOF_HIERARCHY_FILTER_DEFAULT)}
                className="mt-1 self-start text-[11px] text-blue-600 hover:underline"
              >
                すべて解除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
