'use client';

/**
 * 階層サンキーのコントロール。
 *
 * 年度とページ切替は全ページ共通で右上に置くので、ここには含めない。
 * データ取得はページ層の責務なので、ここでは選択の通知だけを行う。
 *
 * 常に出すのは予算種別だけで、残りは「表示設定」に畳む。
 * 横に並べ続けると、コントロールを1つ足すたびに右上の帯が左へ伸び、
 * 左上の検索ボックスを覆って「見えているのに押せない」状態になる
 * （実際に文字サイズとラベル表示を足した時点で起きた）。
 */

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TOP_N } from '@/app/lib/mof-hierarchy-sankey';
import type { LabelDensity, MOFHierarchyTopN } from '@/types/mof-hierarchy';
import type { MOFBudgetType } from '@/types/mof-jikou';

const SELECT_CLASS =
  'h-8 cursor-pointer rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** TopN の選択肢。多すぎるとラベルが潰れるので上限を設ける */
const TOP_N_OPTIONS = [5, 8, 12, 16, 20, 30, 40];

/** 文字サイズの選択肢（px）。大きくするとノード間隔も広がり、縦に長くなる */
const FONT_PX_OPTIONS = [9, 10, 11, 12, 14, 16, 18];

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
  fontPx,
  onFontPxChange,
  labelDensity,
  onLabelDensityChange,
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
  /** ラベルの文字サイズ（px） */
  fontPx: number;
  onFontPxChange: (value: number) => void;
  /** ラベルをどこまで出すか */
  labelDensity: LabelDensity;
  onLabelDensityChange: (value: LabelDensity) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className="font-medium">予算種別</span>
        <select
          aria-label="予算種別"
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

      <button
        type="button"
        aria-label="表示設定"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-8 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        表示設定
        <span aria-hidden="true" className="text-[10px] text-gray-400">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex flex-col gap-2 text-xs text-gray-600">
            <Row label="項の表示数">
              <select
                aria-label="項の表示数"
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
            </Row>

            <Row label="事項の表示数">
              <select
                aria-label="事項の表示数"
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
            </Row>

            <Row label="文字サイズ">
              <select
                aria-label="文字サイズ"
                value={fontPx}
                onChange={e => onFontPxChange(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {FONT_PX_OPTIONS.map(n => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </Row>

            <Row label="ラベル表示">
              <select
                aria-label="ラベル表示"
                value={labelDensity}
                onChange={e => onLabelDensityChange(e.target.value as LabelDensity)}
                className={SELECT_CLASS}
              >
                <option value="all">すべて</option>
                <option value="major">主要なノードのみ</option>
              </select>
            </Row>

            <label className="flex cursor-pointer items-center gap-1.5 pt-1">
              <input
                type="checkbox"
                checked={focusRelated}
                onChange={e => onFocusRelatedChange(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <span>選択時に関連のみ表示</span>
            </label>

            <p className="border-t border-gray-100 pt-2 text-[11px] text-gray-400">
              表示数を超えた分は「その他」にまとまります
            </p>
            {summary && <p className="text-[11px] text-gray-500">{summary}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}
